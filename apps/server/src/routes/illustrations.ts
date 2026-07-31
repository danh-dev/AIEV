import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { generateBackground } from "../gemini.js";
import { briefOf, projectExists, readMeta, writeAssetEntry } from "../meta.js";
import { getStyle, styleExists } from "../styles.js";
import { paths } from "../config.js";
import { HttpError, ensureDir, toKebabAscii } from "../util.js";
import type { ImageAspect } from "../imageMeta.js";

/**
 * Tạo ảnh minh họa cho VIDEO project — công cụ cho agent Claude gọi trong lúc edit
 * (curl http://localhost:6869/api/illustrations). Ảnh sinh bằng Gemini, prompt tự trộn
 * Style Design nên đồng bộ thương hiệu; cấm chữ trong ảnh. Style Design là BẮT BUỘC:
 * thiếu body.styleId thì server tự lấy brief.styleId của project (rồi mới tới default) —
 * agent quên truyền cũng không thoát được style đã chọn cho video.
 * Ảnh lưu vào video-projects/<id>/assets/illustrations/ + mô tả ghi vào assets.json.
 */

const ASPECTS: ImageAspect[] = ["9:16", "16:9", "1:1", "4:5"];

const router = Router();

// POST /api/illustrations { projectId, prompt, name?, aspect?, model?, description?, styleId?, allowText? }
// → { file, relPath, promptUsed }
router.post("/", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!projectId || !projectExists(projectId)) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", `Không tìm thấy video project "${projectId}"`);
  }
  if (!prompt) {
    throw new HttpError(400, "PROMPT_REQUIRED", "Thiếu prompt mô tả nội dung ảnh minh họa");
  }
  const aspect = ASPECTS.includes(body.aspect as ImageAspect)
    ? (body.aspect as ImageAspect)
    : "9:16";
  const model = typeof body.model === "string" && body.model ? body.model : undefined;
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if ("styleId" in body && body.styleId !== null && typeof body.styleId !== "string") {
    throw new HttpError(400, "INVALID_STYLE_ID", "styleId phải là string hoặc null");
  }
  const styleId = typeof body.styleId === "string" ? body.styleId.trim() : "";
  if (styleId && !styleExists(styleId)) {
    throw new HttpError(404, "STYLE_NOT_FOUND", `Không tìm thấy style "${styleId}"`);
  }
  if ("allowText" in body && typeof body.allowText !== "boolean") {
    throw new HttpError(400, "INVALID_ALLOW_TEXT", "allowText phải là boolean");
  }

  // Tên file: từ name (kebab) hoặc từ prompt, dedupe
  const base =
    toKebabAscii(typeof body.name === "string" ? body.name : prompt.slice(0, 40)) || "minh-hoa";
  const dir = path.join(paths.videoProjectsDir, projectId, "assets", "illustrations");
  ensureDir(dir);
  let fileName = `${base}.png`;
  for (let n = 2; fs.existsSync(path.join(dir, fileName)); n++) fileName = `${base}-${n}.png`;
  const outFile = path.join(dir, fileName);

  // Cưỡng chế Style Design: body.styleId → brief.styleId của project → default
  const brief = briefOf(readMeta(projectId));
  const design = getStyle(styleId || brief.styleId || null);
  // Cho phép chữ trong ảnh: body.allowText → brief.illustrationText của project (mặc định false)
  const allowText = typeof body.allowText === "boolean" ? body.allowText : brief.illustrationText;
  const { promptUsed } = await generateBackground({
    prompt,
    kind: "concept",
    aspect,
    design,
    outFile,
    usageProjectId: projectId,
    model,
    allowText,
  });

  // Ghi mô tả vào assets.json để cả UI lẫn các phiên AI sau đều biết ảnh này là gì
  if (description) {
    writeAssetEntry(projectId, fileName, { description });
  }

  res.status(201).json({
    file: fileName,
    relPath: `video-projects/${projectId}/assets/illustrations/${fileName}`,
    promptUsed,
  });
});

export default router;
