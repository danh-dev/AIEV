import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { repoRoot } from "./config.js";

/** Lỗi HTTP có mã — error handler ở index.ts sẽ trả { error: { code, message } } */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isKebabCase(s: string): boolean {
  return KEBAB_RE.test(s);
}

/** Ép chuỗi (tên file, id) về ASCII kebab-case — bỏ dấu tiếng Việt, đ→d */
export function toKebabAscii(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // bỏ dấu (combining marks sau NFD)
    .replace(/đ/g, "d") // đ
    .replace(/Đ/g, "d") // Đ
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Ép tên file về ASCII kebab-case, giữ phần mở rộng */
export function sanitizeFileName(original: string): string {
  const ext = path.extname(original).toLowerCase().replace(/[^a-z0-9.]/g, "");
  const base = toKebabAscii(path.basename(original, path.extname(original)));
  return `${base || "file"}${ext}`;
}

export type FileKind = "video" | "audio" | "image" | "other";

export interface FileInfo {
  name: string;
  relPath: string;
  size: number;
  mtime: string;
  kind: FileKind;
}

const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]);

export function fileKind(name: string): FileKind {
  const ext = path.extname(name).toLowerCase();
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (IMAGE_EXT.has(ext)) return "image";
  return "other";
}

/** relPath luôn tính từ repo root, dấu / — dùng thẳng cho /media/<relPath> */
export function toRepoRel(absPath: string): string {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

export function fileInfoOf(absPath: string): FileInfo {
  const st = fs.statSync(absPath);
  return {
    name: path.basename(absPath),
    relPath: toRepoRel(absPath),
    size: st.size,
    mtime: st.mtime.toISOString(),
    kind: fileKind(absPath),
  };
}

/** Liệt kê file (đệ quy) trong một thư mục; thư mục không tồn tại → [] */
export function listFilesRecursive(absDir: string): FileInfo[] {
  if (!fs.existsSync(absDir)) return [];
  const out: FileInfo[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(fileInfoOf(abs));
    }
  };
  walk(absDir);
  out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return out;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Move file, fallback copy+unlink nếu rename qua ổ đĩa khác thất bại */
export function moveFile(src: string, dst: string): void {
  ensureDir(path.dirname(dst));
  try {
    fs.renameSync(src, dst);
  } catch {
    fs.copyFileSync(src, dst);
    fs.unlinkSync(src);
  }
}

/** Kill cả cây process (Windows: taskkill /t — npx/shell spawn con như node/chromium/ffprobe) */
export function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      shell: true,
      windowsHide: true,
    });
  } else {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

/** Chạy một lệnh (shell) lấy stdout; reject nếu exit != 0 hoặc quá timeout */
export function execCapture(
  command: string,
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: opts.cwd ?? repoRoot,
      shell: true,
      windowsHide: true,
    });
    let out = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // shell:true → child là shell; kill cả cây để không rò ffprobe/npx mồ côi trên Windows
      killTree(child);
      reject(new Error(`Lệnh quá thời gian: ${command}`));
    }, opts.timeoutMs ?? 10_000);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", () => {
      /* bỏ qua stderr */
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`Lệnh thoát mã ${code}: ${command}`));
    });
  });
}

/** Đo thời lượng file media bằng ffprobe → ms, null nếu ffprobe fail */
export async function ffprobeDurationMs(absFile: string): Promise<number | null> {
  try {
    const out = await execCapture(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${absFile}"`,
      { timeoutMs: 15_000 },
    );
    const sec = parseFloat(out.trim());
    if (!Number.isFinite(sec)) return null;
    return Math.round(sec * 1000);
  } catch {
    return null;
  }
}
