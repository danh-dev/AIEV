import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { hasClaudeAuth, repoRoot } from "../config.js";
import { execCapture } from "../util.js";

export interface HealthChecks {
  ffmpeg: boolean;
  node: string;
  /** Có xác thực Claude (subscription OAuth của Claude Code hoặc API key trong .env) */
  claudeAuth: boolean;
  hyperframes: boolean;
}

export interface HealthResult {
  ok: true;
  checks: HealthChecks;
}

async function checkFfmpeg(): Promise<boolean> {
  try {
    await execCapture("ffmpeg -version", { timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function checkHyperframes(): Promise<boolean> {
  // Nhanh nhất: package đã cài ở root workspace
  if (fs.existsSync(path.join(repoRoot, "node_modules", "hyperframes"))) return true;
  try {
    await execCapture("npx --no-install hyperframes --version", {
      cwd: repoRoot,
      timeoutMs: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function getHealth(): Promise<HealthResult> {
  const [ffmpeg, hyperframes] = await Promise.all([checkFfmpeg(), checkHyperframes()]);
  return {
    ok: true,
    checks: {
      ffmpeg,
      node: process.version,
      claudeAuth: hasClaudeAuth(),
      hyperframes,
    },
  };
}

const router = Router();

// GET /api/health
router.get("/", async (_req, res) => {
  res.json(await getHealth());
});

export default router;
