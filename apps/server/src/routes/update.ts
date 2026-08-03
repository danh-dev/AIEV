import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { Router } from "express";
import { repoRoot } from "../config.js";
import * as db from "../db.js";
import { nowIso } from "../util.js";

const execFileAsync = promisify(execFile);

/** Một commit sắp được kéo về - hiện trong popup "Có gì mới". */
export interface UpdateCommit {
  hash: string;
  message: string;
}

/** Trạng thái cập nhật so với origin/main trên GitHub. */
export interface UpdateStatus {
  /** Short hash của HEAD hiện tại ("" nếu git lỗi). */
  current: string;
  /** Số commit HEAD đang thua origin/main. */
  behind: number;
  upToDate: boolean;
  /** Message commit mới nhất trên origin/main (null khi đã mới nhất). */
  latestMessage: string | null;
  /** Danh sách commit sắp về, mới nhất trước (tối đa 10) - rỗng khi đã mới nhất. */
  commits: UpdateCommit[];
  checkedAt: string;
  /** false khi `git fetch origin` thất bại (offline…) - behind tính theo refs cũ. */
  fetchOk: boolean;
  /** Lỗi ngắn khi check thất bại (offline, không có git…) - không bao giờ 500. */
  error?: string;
}

/** Các bước script update phát ra qua mốc `[STEP] <tên>` trong start/update.log */
export const UPDATE_STEPS = ["pull", "stop", "install", "restart"] as const;
export type UpdateStep = (typeof UPDATE_STEPS)[number];

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
    // Danh sách commit sắp về để popup nói rõ "có gì mới" thay vì chỉ một con số
    let commits: UpdateCommit[] = [];
    if (behind > 0) {
      const raw = await git([
        "log",
        "HEAD..origin/main",
        "-10",
        "--format=%h\x1f%s",
      ]);
      commits = raw
        .split("\n")
        .map((l) => l.split("\x1f"))
        .filter((p) => p.length === 2 && p[0])
        .map(([hash, message]) => ({ hash, message }));
    }
    return {
      current,
      behind,
      upToDate: behind === 0,
      latestMessage,
      commits,
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
      commits: [],
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

/**
 * GET /api/update/log?tail=200 - đuôi start/update.log + bước đang chạy.
 *
 * VÌ SAO cần: script update chạy DETACHED và tự kill server này, nên không thể
 * đẩy tiến trình qua SSE. Script ghi mốc `[STEP] <tên>` vào log; UI poll endpoint
 * này lúc server còn sống (bước pull), và gọi lại sau khi server hồi sinh để hiện
 * kết quả thật của cả quãng server đã tắt.
 */
router.get("/log", (req, res) => {
  const tail = Math.min(Math.max(Number(req.query.tail) || 200, 1), 2000);
  const file = path.join(repoRoot, "start", "update.log");
  if (!fs.existsSync(file)) {
    res.json({ exists: false, lines: [], step: null, startedAt: null });
    return;
  }
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    res.json({ exists: true, lines: [], step: null, startedAt: null, error: shortError(err) });
    return;
  }

  // Log là file CỘNG DỒN qua nhiều lần update - chỉ lấy từ dấu mốc lần chạy CUỐI,
  // nếu không UI sẽ hiện lẫn output của lần cập nhật trước.
  const all = text.split(/\r?\n/);
  // Duyệt ngược tay thay vì findLastIndex - lib TS của server chưa bật ES2023
  let startIdx = -1;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].includes("bắt đầu cập nhật")) {
      startIdx = i;
      break;
    }
  }
  const run = startIdx >= 0 ? all.slice(startIdx) : all;

  const stepLine = [...run].reverse().find((l) => l.includes("[STEP] "));
  const raw = stepLine?.split("[STEP] ")[1]?.trim() ?? "";
  const step = (UPDATE_STEPS as readonly string[]).includes(raw)
    ? (raw as UpdateStep)
    : null;

  res.json({
    exists: true,
    // Bỏ dòng trống ở đuôi cho UI khỏi hiện khoảng trắng thừa
    lines: run.slice(-tail).filter((l, i, a) => l.trim() !== "" || i < a.length - 1),
    step,
    startedAt: startIdx >= 0 ? (all[startIdx] ?? null) : null,
  });
});

// POST /api/update/apply - spawn script update DETACHED rồi trả 202 ngay.
// Script sẽ kill server này, nên process con phải sống độc lập (detached + unref).
router.post("/apply", (_req, res) => {
  // Job queued cũng phải chặn - nó có thể bắt đầu chạy đúng lúc script update kill server
  if (db.getRunningJob() || db.countQueuedJobs() > 0) {
    res.status(409).json({
      error: {
        code: "JOB_RUNNING",
        message: "Đang có job render chạy/chờ trong hàng đợi - chờ xong rồi cập nhật.",
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
