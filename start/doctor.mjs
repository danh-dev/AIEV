#!/usr/bin/env node
/**
 * Kiểm tra môi trường AIEV - NGUỒN SỰ THẬT DUY NHẤT.
 *
 * Dùng chung cho ba nơi, để danh sách kiểm tra không bao giờ lệch nhau nữa:
 *   1. start.ps1  (Windows)   -> node start/doctor.mjs --fix
 *   2. start.sh   (macOS/Linux) -> node start/doctor.mjs --fix
 *   3. Web UI     -> GET /api/doctor  (backend spawn `--json`, xem routes/doctor.ts)
 * Trước đây mỗi script tự kiểm tra bằng ngôn ngữ của nó nên đã trôi mất đồng bộ:
 * start.sh bắt buộc có ffmpeg còn start.ps1 không kiểm tra ffmpeg dòng nào.
 *
 * RÀNG BUỘC: file này chạy TRƯỚC `npm install` (start script gọi nó ở bước đầu)
 * nên KHÔNG được import bất cứ dependency nào - chỉ module built-in của Node.
 *
 * Cách chạy tay:
 *   node start/doctor.mjs            # in bảng kiểm tra
 *   node start/doctor.mjs --fix      # thiếu gì hỏi cài nấy
 *   node start/doctor.mjs --fix --yes # cài luôn, không hỏi
 *   node start/doctor.mjs --json     # cho máy đọc
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
/** npm/claude trên Windows là file .cmd - spawn không shell thì phải gọi đúng tên */
const NPM = IS_WIN ? "npm.cmd" : "npm";

/** Node tối thiểu - phải khớp README và package.json */
export const MIN_NODE_MAJOR = 20;

// ===================== tiện ích =====================

/** Chạy lệnh, KHÔNG bao giờ ném - thiếu lệnh trả về { ok: false } */
function run(file, args, timeout = 10_000) {
  try {
    const r = spawnSync(file, args, { encoding: "utf8", timeout, windowsHide: true });
    if (r.error) return { ok: false, out: "" };
    return {
      ok: r.status === 0,
      out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(),
      status: r.status,
    };
  } catch {
    return { ok: false, out: "" };
  }
}

/** Dòng đầu của output - phần lớn lệnh --version in version ở dòng này */
function firstLine(s) {
  return (s || "").split(/\r?\n/)[0].trim();
}

let envCache = null;
/** Đọc .env thủ công (dotenv chưa cài được ở lần chạy đầu) */
function envFileVars() {
  if (envCache) return envCache;
  const out = {};
  const file = path.join(ROOT, ".env");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      const eq = s.indexOf("=");
      if (eq < 0) continue;
      out[s.slice(0, eq).trim()] = s
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  }
  envCache = out;
  return out;
}

function envVar(name) {
  return (process.env[name] || envFileVars()[name] || "").trim();
}

function hasBrew() {
  return run("brew", ["--version"], 5000).ok;
}

/**
 * Windows: winget vừa cài xong thì PATH của tiến trình HIỆN TẠI vẫn là bản cũ,
 * nên kiểm tra lại ngay sau khi cài sẽ báo "vẫn thiếu". Đọc lại PATH từ registry
 * để lệnh mới cài thấy được luôn, khỏi bắt người dùng mở lại cửa sổ.
 *
 * Lưu ý: giá trị REG_EXPAND_SZ có thể còn %SystemRoot% chưa nở - chấp nhận được
 * vì ta chỉ NỐI THÊM vào PATH sẵn có, các mục cũ vẫn nguyên.
 */
function refreshWindowsPath() {
  if (!IS_WIN) return;
  const readPath = (root) => {
    const r = run("reg", ["query", root, "/v", "Path"], 5000);
    if (!r.ok) return "";
    const m = r.out.match(/Path\s+REG(?:_EXPAND)?_SZ\s+(.*)/i);
    return m ? m[1].trim() : "";
  };
  const machine = readPath(
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
  );
  const user = readPath("HKCU\\Environment");
  const merged = [process.env.PATH || "", machine, user].filter(Boolean).join(";");
  process.env.PATH = merged;
  process.env.Path = merged;
}

// ===================== các phép dò =====================

/** Chrome/Chromium - HyperFrames và Remotion đều render qua headless Chrome */
function findChrome() {
  const fromEnv = (
    process.env.CHROME_PATH ||
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    ""
  ).trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const candidates = [];
  if (IS_WIN) {
    const bases = [
      process.env["ProgramFiles"],
      process.env["ProgramFiles(x86)"],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    for (const b of bases) {
      candidates.push(path.join(b, "Google", "Chrome", "Application", "chrome.exe"));
      candidates.push(path.join(b, "Chromium", "Application", "chrome.exe"));
    }
  } else if (IS_MAC) {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    candidates.push(
      path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    );
    candidates.push("/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else {
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
      const r = run("which", [name], 4000);
      if (r.ok && r.out) candidates.push(firstLine(r.out));
    }
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Python có sẵn module faster_whisper (phụ đề). Thứ tự dò khớp transcribe.ts:
 * Windows hay chỉ có `py` (launcher), macOS/Linux là `python3`.
 */
const PY_CANDIDATES = IS_WIN ? ["py", "python", "python3"] : ["python3", "python"];

function findPython() {
  for (const exe of PY_CANDIDATES) {
    const r = run(exe, ["-c", "import sys; print(sys.version.split()[0])"], 8000);
    if (r.ok && r.out) return { exe, version: firstLine(r.out) };
  }
  return null;
}

/** Đăng nhập Claude - phải khớp hasClaudeAuth() trong apps/server/src/config.ts */
function claudeAuthed() {
  if (envVar("ANTHROPIC_API_KEY") || envVar("CLAUDE_CODE_OAUTH_TOKEN") || envVar("ANTHROPIC_AUTH_TOKEN")) {
    return true;
  }
  const configDir =
    process.env.CLAUDE_CONFIG_DIR ||
    path.join(process.env.USERPROFILE || process.env.HOME || "", ".claude");
  if (fs.existsSync(path.join(configDir, ".credentials.json"))) return true;
  // macOS: Claude Code cất OAuth trong Keychain, không có file .credentials.json
  if (IS_MAC) {
    return run("security", ["find-generic-password", "-s", "Claude Code-credentials"], 4000).ok;
  }
  return false;
}

/** cloudflared có thể nằm trong PATH hệ thống hoặc bản tải riêng ở start/bin/ */
const LOCAL_CLOUDFLARED = path.join(ROOT, "start", "bin", IS_WIN ? "cloudflared.exe" : "cloudflared");

function findCloudflared() {
  if (fs.existsSync(LOCAL_CLOUDFLARED)) return LOCAL_CLOUDFLARED;
  return run("cloudflared", ["--version"], 5000).ok ? "cloudflared" : null;
}

// ===================== danh sách kiểm tra =====================

/**
 * level:
 *   required - thiếu là pipeline render KHÔNG chạy được
 *   optional - thiếu thì mất một tính năng, phần còn lại vẫn chạy
 *   info     - chỉ để biết (GPU), không bao giờ là lỗi
 *
 * fix.auto = true nghĩa là cài được không cần người gõ gì thêm; web UI chỉ cho
 * bấm nút "Cài tự động" với đúng những mục này.
 */
export function runDoctor() {
  const checks = [];

  // --- Node.js ---
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    id: "node",
    label: "Node.js",
    level: "required",
    status: nodeMajor >= MIN_NODE_MAJOR ? "ok" : "missing",
    detail: `v${process.versions.node}`,
    // Không tự cài Node được: chính script này đang chạy bằng Node, và trên
    // Windows thì PATH mới chỉ có hiệu lực ở cửa sổ sau.
    fix: { auto: false, manual: `https://nodejs.org (v${MIN_NODE_MAJOR}+)`, url: "https://nodejs.org" },
  });

  // --- FFmpeg (kèm ffprobe) ---
  const ff = run("ffmpeg", ["-version"], 8000);
  const fp = run("ffprobe", ["-version"], 8000);
  const ffOk = ff.ok && fp.ok;
  checks.push({
    id: "ffmpeg",
    label: "FFmpeg",
    level: "required",
    status: ffOk ? "ok" : "missing",
    detail: ffOk ? firstLine(ff.out).split(" ").slice(0, 3).join(" ") : "",
    note: ff.ok && !fp.ok ? "ffprobe-missing" : null,
    fix: IS_WIN
      ? {
          auto: true,
          size: "~150 MB",
          cmd: ["winget", ["install", "--id", "Gyan.FFmpeg", "-e", "--silent",
            "--accept-source-agreements", "--accept-package-agreements"]],
          manual: "winget install --id Gyan.FFmpeg -e",
          command: "winget install --id Gyan.FFmpeg -e",
        }
      : IS_MAC
        ? hasBrew()
          ? { auto: true, size: "~120 MB", cmd: ["brew", ["install", "ffmpeg"]], manual: "brew install ffmpeg", command: "brew install ffmpeg" }
          : { auto: false, manual: "brew install ffmpeg (cài Homebrew trước: brew.sh)", command: "brew install ffmpeg", url: "https://brew.sh" }
        : { auto: false, manual: "sudo apt install ffmpeg", command: "sudo apt install ffmpeg" },
  });

  // --- Google Chrome ---
  const chrome = findChrome();
  checks.push({
    id: "chrome",
    label: "Google Chrome",
    level: "required",
    status: chrome ? "ok" : "missing",
    detail: chrome ?? "",
    fix: IS_WIN
      ? {
          auto: true,
          size: "~120 MB",
          cmd: ["winget", ["install", "--id", "Google.Chrome", "-e", "--silent",
            "--accept-source-agreements", "--accept-package-agreements"]],
          manual: "winget install --id Google.Chrome -e",
          command: "winget install --id Google.Chrome -e",
        }
      : IS_MAC
        ? hasBrew()
          ? {
              auto: true,
              size: "~250 MB",
              cmd: ["brew", ["install", "--cask", "google-chrome"]],
              manual: "brew install --cask google-chrome",
              command: "brew install --cask google-chrome",
            }
          : { auto: false, manual: "https://google.com/chrome", url: "https://www.google.com/chrome/" }
        : { auto: false, manual: "https://google.com/chrome", url: "https://www.google.com/chrome/" },
  });

  // --- Claude Code CLI ---
  // KHÔNG bắt buộc: backend gọi Claude qua @anthropic-ai/claude-agent-sdk trong
  // node_modules (SDK tự mang CLI riêng). CLI toàn cục chỉ là MỘT trong hai cách
  // lấy được xác thực (`claude` -> /login), cách kia là ANTHROPIC_API_KEY.
  // Đã đăng nhập rồi thì nó thành thừa -> hạ xuống "info" để không báo động giả.
  const authed = claudeAuthed();
  const claudeCli = run(IS_WIN ? "claude.cmd" : "claude", ["--version"], 15_000);
  checks.push({
    id: "claude-cli",
    label: "Claude Code",
    level: authed ? "info" : "optional",
    status: claudeCli.ok ? "ok" : "missing",
    detail: claudeCli.ok ? firstLine(claudeCli.out) : "",
    note: !claudeCli.ok && authed ? "not-needed" : null,
    fix: {
      auto: true,
      size: "~40 MB",
      cmd: [NPM, ["install", "-g", "@anthropic-ai/claude-code", "--no-audit", "--no-fund"]],
      manual: "npm install -g @anthropic-ai/claude-code",
      command: "npm install -g @anthropic-ai/claude-code",
    },
  });

  // --- Đăng nhập Claude ---
  checks.push({
    id: "claude-auth",
    label: "Claude login",
    level: "required",
    status: authed ? "ok" : "missing",
    detail: authed ? (envVar("ANTHROPIC_API_KEY") ? "API key" : "subscription") : "",
    // Đăng nhập là việc tương tác (mở trình duyệt, nhập mã) - không tự làm thay được
    fix: { auto: false, manual: "claude -> /login", link: "/connections" },
  });

  // --- Python + faster-whisper (phụ đề) ---
  const py = findPython();
  const whisper = py ? run(py.exe, ["-c", "import faster_whisper"], 30_000).ok : false;
  checks.push({
    id: "whisper",
    label: "faster-whisper",
    level: "optional",
    status: whisper ? "ok" : "missing",
    detail: py ? `Python ${py.version}` : "",
    // Có Python nhưng thiếu module là ca sửa được bằng một lệnh pip - phân biệt
    // rõ với ca chưa có Python (phải cài Python trước)
    note: !whisper ? (py ? "module-missing" : "python-missing") : null,
    fix: py
      ? {
          auto: true,
          size: "~300 MB",
          cmd: [py.exe, ["-m", "pip", "install", "faster-whisper"]],
          manual: `${py.exe} -m pip install faster-whisper`,
          command: `${py.exe} -m pip install faster-whisper`,
        }
      : {
          auto: false,
          manual: "pip install faster-whisper (cài Python 3.10+ trước)",
          url: "https://www.python.org/downloads/",
        },
  });

  // --- Gemini API key (tạo ảnh) ---
  const gemini = !!envVar("GEMINI_API_KEY");
  checks.push({
    id: "gemini",
    label: "Gemini API key",
    level: "optional",
    status: gemini ? "ok" : "missing",
    detail: "",
    // Dán key ngay trong trang Kết nối - không cần mở file .env
    fix: {
      auto: false,
      manual: "GEMINI_API_KEY (aistudio.google.com/apikey)",
      link: "/connections",
      url: "https://aistudio.google.com/apikey",
    },
  });

  // --- cloudflared (tunnel) ---
  const cf = findCloudflared();
  checks.push({
    id: "cloudflared",
    label: "cloudflared",
    level: "optional",
    status: cf ? "ok" : "missing",
    detail: cf === LOCAL_CLOUDFLARED ? "start/bin/" : cf ? "PATH" : "",
    fix: IS_WIN
      ? {
          auto: true,
          size: "~20 MB",
          cmd: ["winget", ["install", "--id", "Cloudflare.cloudflared", "--silent",
            "--accept-source-agreements", "--accept-package-agreements"]],
          manual: "winget install --id Cloudflare.cloudflared",
          command: "winget install --id Cloudflare.cloudflared",
        }
      : IS_MAC
        ? { auto: true, size: "~20 MB", kind: "cloudflared-mac", manual: "brew install cloudflared", command: "brew install cloudflared" }
        : { auto: false, manual: "https://github.com/cloudflare/cloudflared/releases" },
  });

  // --- GPU (chỉ để biết, không phải lỗi) ---
  const nv = run("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], 8000);
  const gpuName = nv.ok ? firstLine(nv.out) : null;
  checks.push({
    id: "gpu",
    label: "GPU",
    level: "info",
    status: "ok",
    detail: gpuName ? `${gpuName} (NVENC)` : IS_MAC ? "VideoToolbox (macOS)" : "",
    note: gpuName || IS_MAC ? null : "cpu-only",
    fix: null,
  });

  const missingRequired = checks.filter((c) => c.level === "required" && c.status === "missing");
  return {
    platform: process.platform,
    ok: missingRequired.length === 0,
    missingRequired: missingRequired.map((c) => c.id),
    checks,
  };
}

// ===================== cài phần còn thiếu =====================

function spawnLogged(file, args, log) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd: ROOT, windowsHide: true });
    const onData = (buf) => {
      for (const line of buf.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) log(line.trim());
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      log(err.message);
      resolve(false);
    });
    child.on("close", (code) => resolve(code === 0));
  });
}

/** macOS không có brew: tải thẳng binary chính thức về start/bin/ */
async function installCloudflaredMac(log) {
  if (hasBrew()) return spawnLogged("brew", ["install", "cloudflared"], log);
  const pkg = os.arch() === "arm64" ? "cloudflared-darwin-arm64.tgz" : "cloudflared-darwin-amd64.tgz";
  const binDir = path.join(ROOT, "start", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const tgz = path.join(binDir, pkg);
  log(`Tải ${pkg} từ Cloudflare...`);
  const okDl = await spawnLogged("curl", [
    "-fsSL", "-o", tgz,
    `https://github.com/cloudflare/cloudflared/releases/latest/download/${pkg}`,
  ], log);
  if (!okDl) return false;
  const okTar = await spawnLogged("tar", ["-xzf", tgz, "-C", binDir], log);
  fs.rmSync(tgz, { force: true });
  if (!okTar) return false;
  fs.chmodSync(path.join(binDir, "cloudflared"), 0o755);
  return true;
}

/**
 * Cài một mục. Trả về true nếu lệnh cài chạy thành công (chưa chắc đã dò lại
 * thấy - gọi runDoctor() sau để xác nhận).
 */
export async function applyFix(id, { log = () => {} } = {}) {
  const check = runDoctor().checks.find((c) => c.id === id);
  if (!check) throw new Error(`Không có mục kiểm tra "${id}"`);
  if (check.status === "ok") return true;
  const fix = check.fix;
  if (!fix?.auto) throw new Error(`Mục "${id}" phải cài tay: ${fix?.manual ?? "-"}`);

  let ok;
  if (fix.kind === "cloudflared-mac") {
    ok = await installCloudflaredMac(log);
  } else {
    ok = await spawnLogged(fix.cmd[0], fix.cmd[1], log);
  }
  // winget ghi PATH vào registry chứ không vào tiến trình đang chạy
  if (ok) refreshWindowsPath();
  return ok;
}

// ===================== CLI =====================

const TEXT = {
  vi: {
    title: "Kiểm tra môi trường",
    ok: "OK",
    missing: "THIẾU",
    allGood: "Môi trường đầy đủ.",
    someMissing: "Thiếu {n} thứ bắt buộc - render sẽ lỗi nếu không cài.",
    optionalMissing: "{n} tính năng phụ chưa dùng được (không ảnh hưởng phần còn lại).",
    installing: "Đang cài {label}...",
    installed: "Đã cài {label}.",
    installFailed: "Không cài được {label} - cài tay: {manual}",
    askOne: "Cài {label} ({size}) ngay? [Y/n] ",
    manualHint: "Cài tay: {manual}",
    fixInUi: "Mở dashboard rồi vào Cấu hình để cài bằng một nút bấm.",
    why: {
      node: "nền tảng chạy toàn hệ thống",
      ffmpeg: "cắt, ghép, encode video",
      chrome: "HyperFrames và Remotion render qua Chrome ẩn",
      "claude-cli": "một cách đăng nhập subscription (cách kia là API key)",
      "claude-auth": "chưa đăng nhập thì không edit bằng AI được",
      whisper: "tạo phụ đề tự động",
      gemini: "tạo ảnh nền và ảnh minh họa",
      cloudflared: "mở dashboard qua 4G/5G",
      gpu: "render nhanh hơn",
    },
    note: {
      "ffprobe-missing": "có ffmpeg nhưng thiếu ffprobe",
      "not-needed": "không cần - đã có xác thực",
      "module-missing": "có Python nhưng thiếu module",
      "python-missing": "chưa có Python",
      "cpu-only": "không có GPU tăng tốc - render bằng CPU",
    },
  },
  en: {
    title: "Environment check",
    ok: "OK",
    missing: "MISSING",
    allGood: "Environment is complete.",
    someMissing: "{n} required item(s) missing - rendering will fail without them.",
    optionalMissing: "{n} optional feature(s) unavailable (everything else still works).",
    installing: "Installing {label}...",
    installed: "{label} installed.",
    installFailed: "Could not install {label} - do it manually: {manual}",
    askOne: "Install {label} ({size}) now? [Y/n] ",
    manualHint: "Manual: {manual}",
    fixInUi: "Open the dashboard and go to Settings to install with one click.",
    why: {
      node: "runtime for the whole system",
      ffmpeg: "cut, concat and encode video",
      chrome: "HyperFrames and Remotion render through headless Chrome",
      "claude-cli": "one way to sign in with a subscription (the other is an API key)",
      "claude-auth": "without a login, AI editing is unavailable",
      whisper: "automatic subtitles",
      gemini: "background and illustration images",
      cloudflared: "reach the dashboard over 4G/5G",
      gpu: "faster rendering",
    },
    note: {
      "ffprobe-missing": "ffmpeg found but ffprobe is missing",
      "not-needed": "not needed - already authenticated",
      "module-missing": "Python found but the module is missing",
      "python-missing": "Python not installed",
      "cpu-only": "no hardware acceleration - rendering on CPU",
    },
  },
};

function fmt(s, vars) {
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** Hỏi Y/n trên terminal - không có stdin tương tác thì coi như "có" */
function askYesNo(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(true);
      return;
    }
    process.stdout.write(question);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", (data) => {
      process.stdin.pause();
      const a = String(data).trim().toLowerCase();
      resolve(a !== "n" && a !== "no");
    });
  });
}

/**
 * Chỉ tô màu khi thật sự in ra terminal. Output bị pipe (start script gom vào
 * file log, hoặc console Windows cũ chưa bật VT) mà vẫn chèn mã ANSI thì người
 * dùng đọc phải toàn ký tự rác kiểu "<-[32m".
 */
const USE_COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (USE_COLOR ? `\u001b[${code}m` : "");
const C = {
  reset: paint(0),
  dim: paint(90),
  green: paint(32),
  red: paint(31),
  yellow: paint(33),
  cyan: paint(36),
};

async function main() {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes("--json");
  const wantFix = argv.includes("--fix");
  const assumeYes = argv.includes("--yes");
  const langArg = argv.indexOf("--lang");
  const lang =
    (langArg >= 0 ? argv[langArg + 1] : process.env.AIEV_LANG) === "en" ? "en" : "vi";
  const T = TEXT[lang];

  /**
   * --fix-one <id>: cài ĐÚNG một mục rồi thoát, log chảy thẳng ra stdout.
   * Backend dùng đường này (spawn tiến trình con) thay vì import file này: mọi
   * phép dò ở đây là spawnSync, chạy trong tiến trình server sẽ chặn event loop
   * ~6s - đủ để nghẽn SSE và cả vòng lặp hàng đợi render.
   */
  const fixOneAt = argv.indexOf("--fix-one");
  if (fixOneAt >= 0) {
    const id = argv[fixOneAt + 1];
    try {
      const ok = await applyFix(id, { log: (l) => process.stdout.write(`${l}\n`) });
      return ok ? 0 : 1;
    } catch (err) {
      process.stdout.write(`${err?.message ?? err}\n`);
      return 1;
    }
  }

  let report = runDoctor();

  if (wantJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return 0;
  }

  const print = (r) => {
    console.log("");
    console.log(`  ${T.title}`);
    console.log(`  ${"=".repeat(T.title.length + 2)}`);
    for (const c of r.checks) {
      const isInfo = c.level === "info";
      const good = c.status === "ok";
      const mark = isInfo ? `${C.dim}[..]` : good ? `${C.green}[OK]` : `${C.red}[!!]`;
      // detail = dữ liệu máy dò được (version, đường dẫn); note = lời giải thích đã dịch
      const tail = [c.detail, c.note ? T.note[c.note] : ""].filter(Boolean).join(" - ");
      console.log(`  ${mark}${C.reset} ${c.label.padEnd(16)}${tail ? `${C.dim} ${tail}${C.reset}` : ""}`);
      if (!good && !isInfo) {
        console.log(`       ${C.dim}${T.why[c.id] ?? ""}${C.reset}`);
      }
    }
    console.log("");
  };

  print(report);

  if (wantFix) {
    // Bỏ qua mục "info" - chúng không phải vấn đề, hỏi cài chỉ làm phiền
    const fixable = report.checks.filter(
      (c) => c.status === "missing" && c.level !== "info" && c.fix?.auto,
    );
    for (const c of fixable) {
      const ask = fmt(T.askOne, { label: c.label, size: c.fix.size ?? "" });
      if (!assumeYes && !(await askYesNo(`  ${ask}`))) continue;
      console.log(`  ${C.cyan}-> ${fmt(T.installing, { label: c.label })}${C.reset}`);
      let ok = false;
      try {
        ok = await applyFix(c.id, { log: (l) => console.log(`     ${C.dim}${l}${C.reset}`) });
      } catch {
        ok = false;
      }
      if (ok) console.log(`  ${C.green}[OK] ${fmt(T.installed, { label: c.label })}${C.reset}`);
      else {
        console.log(
          `  ${C.yellow}[!] ${fmt(T.installFailed, { label: c.label, manual: c.fix.manual })}${C.reset}`,
        );
      }
    }
    if (fixable.length > 0) report = runDoctor();
  }

  const missReq = report.checks.filter((c) => c.level === "required" && c.status === "missing");
  const missOpt = report.checks.filter((c) => c.level === "optional" && c.status === "missing");

  if (missReq.length === 0 && missOpt.length === 0) {
    console.log(`  ${C.green}${T.allGood}${C.reset}`);
  } else {
    if (missReq.length > 0) {
      console.log(`  ${C.red}${fmt(T.someMissing, { n: missReq.length })}${C.reset}`);
      for (const c of missReq) {
        console.log(`     ${C.dim}${c.label}: ${fmt(T.manualHint, { manual: c.fix?.manual ?? "-" })}${C.reset}`);
      }
    }
    if (missOpt.length > 0) {
      console.log(`  ${C.yellow}${fmt(T.optionalMissing, { n: missOpt.length })}${C.reset}`);
    }
    console.log(`  ${C.dim}${T.fixInUi}${C.reset}`);
  }
  console.log("");
  return 0;
}

// Chỉ chạy CLI khi gọi trực tiếp (import từ nơi khác thì bỏ qua đoạn trên)
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code ?? 0),
    (err) => {
      console.error(err?.message ?? err);
      // Lỗi của CHÍNH doctor không được chặn start script - trừ --fix-one, nơi
      // backend cần biết lệnh cài đã hỏng
      process.exit(process.argv.includes("--fix-one") ? 1 : 0);
    },
  );
}
