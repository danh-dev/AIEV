import { Router } from "express";
import {
  DEFAULT_RENDER_SETTINGS,
  detectHardware,
  readRenderSettings,
  writeRenderSettings,
  type RenderSettings,
} from "../renderSettings.js";
import { HttpError } from "../util.js";

/** Tab "Tăng tốc" — xem phần cứng + chỉnh cài đặt render. Đổi là hiệu lực ngay (job đọc mỗi lần chạy). */
const router = Router();

// GET /api/render-settings → { settings, defaults, hardware }
router.get("/", async (_req, res) => {
  res.json({
    settings: readRenderSettings(),
    defaults: DEFAULT_RENDER_SETTINGS,
    hardware: await detectHardware(),
  });
});

// PUT /api/render-settings — partial → { settings }
router.put("/", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Partial<RenderSettings> = {};

  const numFields: Array<keyof RenderSettings> = [
    "workers",
    "remotionConcurrency",
    "queueConcurrency",
  ];
  for (const f of numFields) {
    if (f in body) {
      if (typeof body[f] !== "number" || !Number.isFinite(body[f])) {
        throw new HttpError(400, "INVALID_SETTING", `${f} phải là số`);
      }
      (patch as Record<string, unknown>)[f] = body[f];
    }
  }
  const boolFields: Array<keyof RenderSettings> = [
    "browserGpu",
    "gpuEncodeDraft",
    "gpuEncodeFinal",
    "fastCapture",
  ];
  for (const f of boolFields) {
    if (f in body) {
      if (typeof body[f] !== "boolean") {
        throw new HttpError(400, "INVALID_SETTING", `${f} phải là boolean`);
      }
      (patch as Record<string, unknown>)[f] = body[f];
    }
  }
  if ("draftFps" in body) {
    if (body.draftFps !== null && typeof body.draftFps !== "number") {
      throw new HttpError(400, "INVALID_SETTING", "draftFps phải là số hoặc null");
    }
    patch.draftFps = body.draftFps as number | null;
  }

  res.json({ settings: writeRenderSettings(patch) });
});

export default router;
