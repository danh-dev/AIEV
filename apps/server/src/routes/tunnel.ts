import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repoRoot, upsertEnvVar } from "../config.js";
import { Router } from "express";
import { HttpError, killTree } from "../util.js";

/**
 * Quản lý Cloudflare Tunnel ngay trên web UI (trang Kết nối).
 * - Có TUNNEL_DOMAIN trong .env → named tunnel (cloudflared tunnel run <nhãn đầu domain>).
 * - Chưa có domain → Quick Tunnel (URL ngẫu nhiên *.trycloudflare.com, parse từ log).
 * Child cloudflared giữ ở module level - server tắt là tunnel tắt theo.
 */

type TunnelMode = "named" | "quick";

let child: ChildProcess | null = null;
let mode: TunnelMode | null = null;
/** URL Quick Tunnel parse được từ log (https://xxx.trycloudflare.com) */
let quickUrl: string | null = null;
/** Ring buffer log cloudflared - giữ tối đa 20 dòng cuối */
const lastLog: string[] = [];
const LOG_MAX = 20;

const QUICK_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
// Hostname hợp lệ: các nhãn a-z0-9- (không bắt đầu/kết thúc bằng -), ít nhất 2 nhãn
const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function pushLog(chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    lastLog.push(s);
    if (lastLog.length > LOG_MAX) lastLog.splice(0, lastLog.length - LOG_MAX);
    // Quick Tunnel in URL ra log lúc khởi động - bắt lấy làm url hiện hành
    if (mode === "quick" && !quickUrl) {
      const m = QUICK_URL_RE.exec(s);
      if (m) quickUrl = m[0];
    }
  }
}

/**
 * Đường dẫn cloudflared: PATH (where/which) trước, rồi các vị trí cài chuẩn -
 * server chạy từ .command trên macOS có PATH tối giản KHÔNG chứa /opt/homebrew/bin.
 */
const CLOUDFLARED_KNOWN_PATHS =
  process.platform === "win32"
    ? [
        "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
        "C:\\Program Files\\cloudflared\\cloudflared.exe",
      ]
    : [
        path.join(repoRoot, "start", "bin", "cloudflared"), // start.sh tự tải về đây khi máy không có brew
        "/opt/homebrew/bin/cloudflared",
        "/usr/local/bin/cloudflared",
        "/usr/bin/cloudflared",
      ];

export function cloudflaredBin(): string | null {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    if (
      spawnSync(cmd, ["cloudflared"], { windowsHide: true, shell: true }).status === 0
    ) {
      return "cloudflared";
    }
  } catch {
    /* rơi xuống check đường dẫn cứng */
  }
  for (const p of CLOUDFLARED_KNOWN_PATHS) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* thôi */
    }
  }
  return null;
}

function cloudflaredInstalled(): boolean {
  return cloudflaredBin() !== null;
}

/** Chuẩn hóa input người dùng thành hostname: bỏ protocol/path/khoảng trắng, lowercase */
function normalizeDomain(input: string): string {
  return input
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/[/?#].*$/, "")
    .trim()
    .toLowerCase();
}

/** TUNNEL_DOMAIN hiện hành từ env (đã chuẩn hóa) - null nếu chưa cấu hình */
function envDomain(): string | null {
  const d = normalizeDomain(process.env.TUNNEL_DOMAIN ?? "");
  return d || null;
}

/**
 * Hostname Quick Tunnel đang chạy - /api/lan-info ưu tiên cái này hơn
 * TUNNEL_DOMAIN trong .env để QR "Kết nối điện thoại" tự dùng URL đang sống.
 */
export function quickTunnelHostname(): string | null {
  if (child && mode === "quick" && quickUrl) {
    try {
      return new URL(quickUrl).hostname;
    } catch {
      return null;
    }
  }
  return null;
}

function statusPayload() {
  const domain = envDomain();
  return {
    installed: cloudflaredInstalled(),
    running: !!child,
    mode: child ? mode : null,
    url: child
      ? mode === "named"
        ? domain
          ? `https://${domain}`
          : null
        : quickUrl
      : null,
    domain,
    lastLog: [...lastLog],
  };
}

const router = Router();

// GET /api/tunnel - trạng thái cài đặt + tunnel đang chạy
router.get("/", (_req, res) => {
  res.json(statusPayload());
});

// PUT /api/tunnel/domain - { domain } (rỗng/null = xóa TUNNEL_DOMAIN)
router.put("/domain", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = body.domain;
  if (raw !== null && raw !== undefined && typeof raw !== "string") {
    throw new HttpError(400, "INVALID_DOMAIN", "domain phải là string hoặc null");
  }
  const domain = typeof raw === "string" ? normalizeDomain(raw) : "";
  if (domain && !HOSTNAME_RE.test(domain)) {
    throw new HttpError(
      400,
      "INVALID_DOMAIN",
      `"${domain}" không phải hostname hợp lệ - ví dụ đúng: aiev.noti.vn`,
    );
  }
  upsertEnvVar("TUNNEL_DOMAIN", domain || null);
  if (domain) process.env.TUNNEL_DOMAIN = domain;
  else delete process.env.TUNNEL_DOMAIN;
  res.json(statusPayload());
});

// POST /api/tunnel/start - spawn cloudflared (named nếu có domain, không thì quick)
router.post("/start", (req, res) => {
  if (!cloudflaredInstalled()) {
    throw new HttpError(
      409,
      "NOT_INSTALLED",
      `Chưa cài cloudflared. Cài bằng: ${
        process.platform === "darwin"
          ? "brew install cloudflared"
          : "winget install --id Cloudflare.cloudflared"
      } - hoặc tải tại https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`,
    );
  }
  if (child) {
    throw new HttpError(409, "ALREADY_RUNNING", "Tunnel đang chạy rồi - tắt trước nếu muốn khởi động lại.");
  }

  const webPort = Number(process.env.WEB_PORT || 6868);
  const localUrl = `http://localhost:${webPort}`;
  const domain = envDomain();
  let args: string[];
  if (domain) {
    // Named tunnel - tên tunnel = nhãn đầu của domain (aiev.noti.vn → aiev),
    // giống start/tunnel.bat. Yêu cầu đã: cloudflared tunnel login/create/route dns.
    const name = domain.split(".")[0];
    mode = "named";
    args = ["tunnel", "run", "--url", localUrl, name];
  } else {
    mode = "quick";
    args = ["tunnel", "--url", localUrl];
  }

  quickUrl = null;
  lastLog.length = 0;
  pushLog(`$ cloudflared ${args.join(" ")}`);

  const proc = spawn(cloudflaredBin() ?? "cloudflared", args, { windowsHide: true });
  child = proc;
  proc.stdout?.on("data", (c: Buffer) => pushLog(c.toString("utf8")));
  proc.stderr?.on("data", (c: Buffer) => pushLog(c.toString("utf8")));
  proc.on("error", (err) => {
    pushLog(`[tunnel] không chạy được cloudflared: ${err.message}`);
    if (child === proc) {
      child = null;
      mode = null;
      quickUrl = null;
    }
  });
  proc.on("close", (code) => {
    pushLog(`[tunnel] cloudflared đã thoát (mã ${code ?? "?"})`);
    if (child === proc) {
      child = null;
      mode = null;
      quickUrl = null;
    }
  });

  res.status(202).json({ mode });
});

// POST /api/tunnel/stop - kill cả cây process cloudflared
router.post("/stop", (_req, res) => {
  if (child) {
    killTree(child);
    child = null;
    mode = null;
    quickUrl = null;
  }
  res.status(204).end();
});

export default router;
