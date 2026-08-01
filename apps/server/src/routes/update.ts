import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { Router } from "express";
import { repoRoot } from "../config.js";
import * as db from "../db.js";
import { nowIso } from "../util.js";

const execFileAsync = promisify(execFile);

/** Trạng thái cập nhật so với origin/main trên GitHub. */
export interface UpdateStatus {
  /** Short hash của HEAD hiện tại ("" nếu git lỗi). */
  current: string;
  /** Số commit HEAD đang thua origin/main. */
  behind: number;
  upToDate: boolean;
  /** Message commit mới nhất trên origin/main (null khi đã mới nhất). */
  latestMessage: string | null;
  checkedAt: string;
  /** false khi `git fetch origin` thất bại (offline…) - behind tính theo refs cũ. */
  fetchOk: boolean;
  /** Lỗi ngắn khi check thất bại (offline, không có git…) - không bao giờ 500. */
  error?: string;
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    timeout: 20_000,
    windowsHide: true,
  });
  return stdout.trim();
}

function shortError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.split("\n")[0].slice(0, 200);
}

async function checkUpdate(): Promise<UpdateStatus> {
  const checkedAt = nowIso();

  // Fetch best-effort: offline thì vẫn so được với refs origin/main đã biết
  // từ lần fetch trước - máy mất mạng vẫn báo đúng "có bản mới" nếu đã biết.
  let fetchOk = true;
  let error: string | undefined;
  try {
    await git(["fetch", "origin"]);
  } catch (err) {
    fetchOk = false;
    error = shortError(err);
  }

  // current độc lập với fetch - luôn cố lấy.
  let current = "";
  try {
    current = await git(["rev-parse", "--short", "HEAD"]);
  } catch (err) {
    error = error ?? shortError(err);
  }

  try {
    await git(["rev-parse", "--verify", "origin/main"]);
    const behind =
      Number(await git(["rev-list", "HEAD..origin/main", "--count"])) || 0;
    const latestMessage =
      behind > 0 ? await git(["log", "origin/main", "-1", "--format=%s"]) : null;
    return {
      current,
      behind,
      upToDate: behind === 0,
      latestMessage,
      checkedAt,
      fetchOk,
      ...(error ? { error } : {}),
    };
  } catch (err) {
    // rev-parse/rev-list cũng fail (không có git, chưa từng fetch…) → báo lỗi thật
    return {
      current,
      behind: 0,
      upToDate: true,
      latestMessage: null,
      checkedAt,
      fetchOk,
      error: error ?? shortError(err),
    };
  }
}

const CACHE_MS = 3 * 60 * 1000;
let cached: { at: number; status: UpdateStatus } | null = null;

const router = Router();

// GET /api/update/check - cache 3 phút, ?force=1 bỏ cache
router.get("/check", async (req, res) => {
  const force = req.query.force === "1";
  if (!force && cached && Date.now() - cached.at < CACHE_MS) {
    res.json(cached.status);
    return;
  }
  const status = await checkUpdate();
  cached = { at: Date.now(), status };
  res.json(status);
});

// POST /api/update/apply - spawn script update DETACHED rồi trả 202 ngay.
// Script sẽ kill server này, nên process con phải sống độc lập (detached + unref).
router.post("/apply", (_req, res) => {
  if (db.getRunningJob()) {
    res.status(409).json({
      error: {
        code: "JOB_RUNNING",
        message: "Đang có job render chạy - chờ xong rồi cập nhật.",
      },
    });
    return;
  }
  // Script update tự ghi toàn bộ output vào start/update.log - soi khi lỗi.
  res.status(202).json({ ok: true, logHint: "start/update.log" });
  const child =
    process.platform === "win32"
      ? spawn(
          "cmd.exe",
          ["/c", "start", "AI Edit Video - UPDATE", "cmd", "/c", "update\\update.bat"],
          { cwd: repoRoot, detached: true, stdio: "ignore" },
        )
      : spawn("bash", ["update/update.sh"], {
          cwd: repoRoot,
          detached: true,
          stdio: "ignore",
        });
  child.unref();
});

export default router;
