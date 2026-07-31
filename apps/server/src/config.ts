import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/**
 * Tìm repo root bằng cách đi ngược lên đến khi gặp file CLAUDE.md.
 * Thử từ vị trí file này (chạy được cả src/ lẫn dist/) rồi tới cwd.
 */
function findRepoRoot(): string {
  const starts = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (;;) {
      if (fs.existsSync(path.join(dir, "CLAUDE.md"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(
    "Không tìm thấy repo root (file CLAUDE.md). Hãy chạy server bên trong repo Edit-Video-AI.",
  );
}

export const repoRoot = findRepoRoot();

// Nạp .env từ repo root (ANTHROPIC_API_KEY, SERVER_PORT, ...)
dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

export const SERVER_PORT = Number(process.env.SERVER_PORT || 6869);

/**
 * Có xác thực Claude cho Agent SDK không — theo thứ tự SDK tự nhận:
 * env key (API key / OAuth token / gateway token) hoặc đăng nhập subscription
 * của Claude Code trên máy (~/.claude/.credentials.json, hoặc CLAUDE_CONFIG_DIR).
 */
export function hasClaudeAuth(): boolean {
  if (
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    process.env.ANTHROPIC_AUTH_TOKEN
  ) {
    return true;
  }
  const configDir =
    process.env.CLAUDE_CONFIG_DIR ||
    path.join(process.env.USERPROFILE || process.env.HOME || "", ".claude");
  if (fs.existsSync(path.join(configDir, ".credentials.json"))) return true;
  // macOS: Claude Code lưu OAuth trong Keychain, KHÔNG có .credentials.json
  return darwinKeychainHasClaudeCreds();
}

// Cache kết quả tra Keychain 60s — health poll mỗi 30s, không spawn security liên tục
let keychainCache: { at: number; ok: boolean } | null = null;
function darwinKeychainHasClaudeCreds(): boolean {
  if (process.platform !== "darwin") return false;
  if (keychainCache && Date.now() - keychainCache.at < 60_000) return keychainCache.ok;
  let ok = false;
  try {
    execFileSync("security", ["find-generic-password", "-s", "Claude Code-credentials"], {
      stdio: "ignore",
      timeout: 3000,
    });
    ok = true;
  } catch {
    /* không có item trong Keychain */
  }
  keychainCache = { at: Date.now(), ok };
  return ok;
}

/** Origin của web UI được phép gọi trực tiếp (Next.js dev có thể bỏ rewrite) */
export const WEB_ORIGINS = [
  "http://localhost:6868",
  "http://127.0.0.1:6868",
];

/**
 * Web UI mở qua LAN (điện thoại/tablet vào http://<ip-máy-chủ>:6868) — upload
 * file lớn gọi THẲNG backend 6869 nên origin dạng IP private :6868 phải được
 * phép CORS. Chỉ chấp nhận dải IP private (RFC 1918), không mở cho IP công cộng.
 */
// Kèm dải CGNAT 100.64.0.0/10 — IP của Tailscale (điện thoại dùng 4G/5G vẫn upload được qua tailnet)
const LAN_WEB_ORIGIN_RE =
  /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+):6868$/;

/** Origin có được phép gọi trực tiếp backend không (localhost + LAN private) */
export function isAllowedWebOrigin(origin: string): boolean {
  return WEB_ORIGINS.includes(origin) || LAN_WEB_ORIGIN_RE.test(origin);
}

const serverDir = path.join(repoRoot, "apps", "server");

export const paths = {
  serverDir,
  dataDir: path.join(serverDir, "data"),
  /** Thư mục tạm cho multer trước khi move về đích (cùng ổ đĩa để rename được) */
  uploadTmpDir: path.join(serverDir, "data", "tmp-uploads"),
  videoProjectsDir: path.join(repoRoot, "video-projects"),
  /** Image projects (tạo ảnh AI — Gemini nền + Remotion hoàn thiện) */
  imageProjectsDir: path.join(repoRoot, "image-projects"),
  assetsDir: path.join(repoRoot, "assets"),
  /** Brand assets: logo + design-system.json cũ (nguồn migration sang Style Design) */
  brandDir: path.join(repoRoot, "assets", "brand"),
  /** Style Design: styles.json (nhiều bộ nhận diện) */
  stylesDir: path.join(repoRoot, "assets", "styles"),
  /** File upload của style (logo, font) — serve qua /media/assets/styles/files/ */
  stylesFilesDir: path.join(repoRoot, "assets", "styles", "files"),
  sfxDir: path.join(repoRoot, "assets", "sound-effects"),
  /** Thư viện nhạc nền dùng chung (library.json + file nhạc) */
  musicDir: path.join(repoRoot, "assets", "music"),
  outputsDir: path.join(repoRoot, "outputs"),
  importsDir: path.join(repoRoot, "imports"),
  skillsDir: path.join(repoRoot, ".claude", "skills"),
  remotionDir: path.join(repoRoot, "engines", "remotion"),
  /** Nơi stage asset bằng hardlink cho Remotion staticFile() */
  stagingDir: path.join(repoRoot, "engines", "remotion", "public", "staging"),
} as const;

/** Tạo trước các thư mục nền tảng để route không phải lo dir chưa tồn tại */
export function ensureBaseDirs(): void {
  const dirs = [
    paths.dataDir,
    paths.uploadTmpDir,
    paths.videoProjectsDir,
    paths.imageProjectsDir,
    paths.stylesDir,
    paths.stylesFilesDir,
    paths.sfxDir,
    paths.musicDir,
    paths.outputsDir,
    paths.importsDir,
  ];
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
}
