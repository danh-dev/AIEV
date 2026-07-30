import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { hasClaudeAuth } from "../config.js";
import { geminiApiKey } from "../gemini.js";
import { HttpError } from "../util.js";

/**
 * GET /api/providers — trạng thái kết nối + model khả dụng của từng AI provider.
 * Xem docs/API.md mục "AI Providers & chọn model".
 */

export const CLAUDE_MODELS = [
  { id: "claude-fable-5", label: "Fable 5 (mạnh nhất)" },
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5 (cân bằng)" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5 (nhanh)" },
];

export const CLAUDE_MODEL_IDS: string[] = CLAUDE_MODELS.map((m) => m.id);

/** Mức effort của Agent SDK — expose thành "mode" trên UI: Nhanh/Chuẩn/Sâu */
export const EFFORT_LEVELS = ["low", "medium", "high"];

// Danh sách model tạo ảnh — nguồn sự thật là IMAGE_MODELS trong gemini.ts
import { IMAGE_MODELS } from "../gemini.js";
export const GEMINI_MODELS: Array<{ id: string; label: string }> = IMAGE_MODELS.map((m) => ({
  id: m.id,
  label: m.label,
}));

// Cache danh sách model ảnh live từ Google — 1 giờ
let liveImageModelsCache: { at: number; list: Array<{ id: string; label: string }> } | null = null;

/**
 * Lấy danh sách model ảnh MỚI NHẤT trực tiếp từ Google (lọc model có "image" trong tên,
 * hỗ trợ generateContent). Không có key / lỗi → fallback danh sách tĩnh IMAGE_MODELS.
 */
async function fetchLiveImageModels(): Promise<{
  source: "google" | "static";
  models: Array<{ id: string; label: string }>;
}> {
  const key = geminiApiKey();
  if (!key) return { source: "static", models: GEMINI_MODELS };
  if (liveImageModelsCache && Date.now() - liveImageModelsCache.at < 60 * 60 * 1000) {
    return { source: "google", models: liveImageModelsCache.list };
  }
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1/models?pageSize=1000",
      { headers: { "x-goog-api-key": key } },
    );
    if (!r.ok) return { source: "static", models: GEMINI_MODELS };
    const data = (await r.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };
    const staticLabels = new Map<string, string>(IMAGE_MODELS.map((m) => [m.id, m.label]));
    const list = (data.models ?? [])
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter((id, i, arr) => id.includes("image") && arr.indexOf(id) === i)
      .filter((id) => {
        const raw = data.models?.find((m) => (m.name ?? "").endsWith(id));
        const methods = raw?.supportedGenerationMethods ?? [];
        return methods.length === 0 || methods.includes("generateContent");
      })
      .sort()
      // Hiện id thô cho dễ dùng; model đã biết thì kèm tên thân thiện
      .map((id) => ({
        id,
        label: staticLabels.has(id) ? `${id} — ${staticLabels.get(id)}` : id,
      }));
    if (list.length > 0) {
      liveImageModelsCache = { at: Date.now(), list };
      return { source: "google", models: list };
    }
    return { source: "static", models: GEMINI_MODELS };
  } catch {
    return { source: "static", models: GEMINI_MODELS };
  }
}

/**
 * Parse + validate `model`/`effort` từ body của POST /api/chat và POST /api/projects/:id/edit.
 * undefined = không gửi (giữ nguyên lựa chọn cũ của session / mặc định SDK).
 */
export function parseModelEffort(body: Record<string, unknown>): {
  model?: string;
  effort?: string;
} {
  const out: { model?: string; effort?: string } = {};
  if ("model" in body && body.model !== undefined && body.model !== null && body.model !== "") {
    if (typeof body.model !== "string" || !CLAUDE_MODEL_IDS.includes(body.model)) {
      throw new HttpError(
        400,
        "INVALID_MODEL",
        `model phải là một trong: ${CLAUDE_MODEL_IDS.join(", ")}`,
      );
    }
    out.model = body.model;
  }
  if ("effort" in body && body.effort !== undefined && body.effort !== null && body.effort !== "") {
    if (typeof body.effort !== "string" || !EFFORT_LEVELS.includes(body.effort)) {
      throw new HttpError(
        400,
        "INVALID_EFFORT",
        `effort phải là một trong: ${EFFORT_LEVELS.join(", ")}`,
      );
    }
    out.effort = body.effort;
  }
  return out;
}

interface Provider {
  id: "claude" | "gemini";
  label: string;
  connected: boolean;
  source: "oauth" | "api-key" | null;
  note?: string;
  roles: Array<"edit" | "chat" | "image">;
  models: Array<{ id: string; label: string }>;
}

function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || "";
}

/** "oauth" nếu có ~/.claude/.credentials.json (subscription Claude Code), "api-key" nếu chỉ có key env */
function claudeSource(): "oauth" | "api-key" | null {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir(), ".claude");
  if (fs.existsSync(path.join(configDir, ".credentials.json"))) return "oauth";
  if (hasClaudeAuth()) return "api-key";
  return null;
}

/** Có cài Antigravity/gemini-cli trên máy không — auth IDE không dùng được cho API tạo ảnh */
function hasAntigravityInstall(): boolean {
  const home = homeDir();
  const localAppData = process.env.LOCALAPPDATA || "";
  const candidates = [
    home && path.join(home, ".gemini"),
    home && path.join(home, ".antigravity"),
    localAppData && path.join(localAppData, "Programs", "Antigravity"),
  ].filter((p): p is string => Boolean(p));
  return candidates.some((p) => fs.existsSync(p));
}

const router = Router();

// GET /api/providers → { providers: Provider[] }
router.get("/", (_req, res) => {
  const claude: Provider = {
    id: "claude",
    label: "Claude (Anthropic)",
    connected: hasClaudeAuth(),
    source: claudeSource(),
    roles: ["edit", "chat"],
    models: CLAUDE_MODELS,
  };

  const gKey = geminiApiKey();
  const gemini: Provider = {
    id: "gemini",
    label: "Gemini (Google)",
    connected: Boolean(gKey),
    source: gKey ? "api-key" : null,
    roles: ["image"],
    models: GEMINI_MODELS,
  };
  if (!gKey && hasAntigravityInstall()) {
    gemini.note =
      "Đã phát hiện Antigravity/gemini-cli — auth IDE không dùng được cho API tạo ảnh, cần GEMINI_API_KEY trong .env";
  }

  res.json({ providers: [claude, gemini] });
});

// GET /api/providers/gemini/image-models — danh sách model ảnh MỚI NHẤT (live từ Google, cache 1h)
router.get("/gemini/image-models", async (_req, res) => {
  res.json(await fetchLiveImageModels());
});

export default router;
