import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { paths, repoRoot } from "../config.js";
import * as db from "../db.js";
import { broadcast } from "../events.js";
import {
  IMAGE_ASPECTS,
  IMAGE_GEN_STEPS,
  IMAGE_KINDS,
  defaultOverlay,
  imageDirOf,
  newImageProjectId,
  normOverlay,
  readImageMeta,
  scanImageProjects,
  writeImageMeta,
  type ImageAspect,
  type ImageGenStep,
  type ImageKind,
  type ImageProject,
} from "../imageMeta.js";
import { IMAGE_MODELS } from "../gemini.js";
import { styleExists } from "../styles.js";
import { queue } from "../queue.js";
import {
  HttpError,
  ensureDir,
  isKebabCase,
  listFilesRecursive,
  moveFile,
  nowIso,
} from "../util.js";

/**
 * Image Projects — tạo ảnh AI (Gemini nền + Remotion hoàn thiện).
 * CRUD + upload nền thủ công + POST /:id/generate (queue job "image-gen").
 * Xem docs/API.md mục "Image Projects".
 */

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(paths.uploadTmpDir);
      cb(null, paths.uploadTmpDir);
    },
    filename: (_req, _file, cb) => cb(null, `up-${Date.now()}-${Math.round(Math.random() * 1e9)}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

function parseImageModel(raw: unknown, fallback: string | null): string | null {
  if (raw === undefined || raw === null || raw === "") return raw === undefined ? fallback : null;
  // Chấp nhận cả model mới từ danh sách live của Google (không chỉ IMAGE_MODELS tĩnh) —
  // miễn là id hợp lệ và có "image" trong tên
  if (
    typeof raw !== "string" ||
    !/^[a-z0-9][a-z0-9.-]{2,80}$/i.test(raw) ||
    !raw.includes("image")
  ) {
    throw new HttpError(
      400,
      "INVALID_MODEL",
      `model không hợp lệ — vd: ${IMAGE_MODELS.map((m) => m.id).join(", ")}`,
    );
  }
  return raw;
}

/** styleId: null/"" = dùng style default; string phải là style tồn tại */
function parseStyleId(raw: unknown, fallback: string | null): string | null {
  if (raw === undefined) return fallback;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new HttpError(400, "INVALID_STYLE_ID", "styleId phải là string hoặc null");
  }
  const id = raw.trim();
  if (!id) return null;
  if (!styleExists(id)) {
    throw new HttpError(400, "STYLE_NOT_FOUND", `Không tìm thấy style "${id}"`);
  }
  return id;
}

function parseKind(raw: unknown, fallback: ImageKind): ImageKind {
  if (raw === undefined) return fallback;
  if (!IMAGE_KINDS.includes(raw as ImageKind)) {
    throw new HttpError(400, "INVALID_KIND", `kind phải là một trong: ${IMAGE_KINDS.join(", ")}`);
  }
  return raw as ImageKind;
}

function parseAspect(raw: unknown, fallback: ImageAspect): ImageAspect {
  if (raw === undefined) return fallback;
  if (!IMAGE_ASPECTS.includes(raw as ImageAspect)) {
    throw new HttpError(
      400,
      "INVALID_ASPECT",
      `aspect phải là một trong: ${IMAGE_ASPECTS.join(", ")}`,
    );
  }
  return raw as ImageAspect;
}

// GET /api/images → ImageProject[]
router.get("/", (_req, res) => {
  res.json(scanImageProjects());
});

// POST /api/images — { name, prompt, kind, aspect, overlay? } → 201 (id sinh từ name)
router.post("/", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new HttpError(400, "INVALID_NAME", "Thiếu name");
  if ("prompt" in body && typeof body.prompt !== "string") {
    throw new HttpError(400, "INVALID_PROMPT", "prompt phải là string");
  }

  const now = nowIso();
  const meta: ImageProject = {
    id: newImageProjectId(name),
    name,
    prompt: typeof body.prompt === "string" ? body.prompt.trim() : "",
    kind: parseKind(body.kind, "background"),
    aspect: parseAspect(body.aspect, "9:16"),
    status: "draft",
    model: parseImageModel(body.model, null),
    styleId: parseStyleId(body.styleId, null),
    overlay: normOverlay(body.overlay, defaultOverlay()),
    background: null,
    final: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  writeImageMeta(meta.id, meta);
  res.status(201).json(readImageMeta(meta.id));
});

// GET /api/images/:id → ImageProject
router.get("/:id", (req, res) => {
  res.json(readImageMeta(req.params.id));
});

// PUT /api/images/:id — partial (name/prompt/kind/aspect/overlay) → ImageProject
router.put("/:id", (req, res) => {
  const meta = readImageMeta(req.params.id); // ném 404 nếu không có
  const body = (req.body ?? {}) as Record<string, unknown>;

  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new HttpError(400, "INVALID_NAME", "name phải là string không rỗng");
    }
    meta.name = body.name.trim();
  }
  if ("prompt" in body) {
    if (typeof body.prompt !== "string") {
      throw new HttpError(400, "INVALID_PROMPT", "prompt phải là string");
    }
    meta.prompt = body.prompt;
  }
  meta.kind = parseKind(body.kind, meta.kind);
  meta.aspect = parseAspect(body.aspect, meta.aspect);
  if ("model" in body) meta.model = parseImageModel(body.model, meta.model);
  if ("styleId" in body) meta.styleId = parseStyleId(body.styleId, meta.styleId);
  if ("overlay" in body) {
    if (!body.overlay || typeof body.overlay !== "object" || Array.isArray(body.overlay)) {
      throw new HttpError(400, "INVALID_OVERLAY", "overlay phải là object");
    }
    meta.overlay = normOverlay(body.overlay, meta.overlay);
  }

  writeImageMeta(meta.id, meta);
  res.json(meta);
});

// DELETE /api/images/:id → 204
router.delete("/:id", (req, res) => {
  const id = req.params.id;
  if (!isKebabCase(id)) {
    throw new HttpError(400, "INVALID_IMAGE_ID", `Image project id không hợp lệ: ${id}`);
  }
  if (!fs.existsSync(imageDirOf(id))) {
    throw new HttpError(404, "IMAGE_NOT_FOUND", `Không tìm thấy image project "${id}"`);
  }
  fs.rmSync(imageDirOf(id), { recursive: true, force: true });
  res.status(204).end();
});

// POST /api/images/:id/background — multipart, tự upload nền (không cần Gemini) → ImageProject
router.post("/:id/background", upload.single("file"), (req, res) => {
  const uploaded = req.file;
  try {
    // multer đổi generic của handler → req.params.id bị suy ra string|string[], ép về string
    const meta = readImageMeta(String(req.params.id)); // ném 404 nếu không có
    if (!uploaded) throw new HttpError(400, "FILE_REQUIRED", "Thiếu file (field `file`)");

    let ext = path.extname(uploaded.originalname).toLowerCase();
    if (ext === ".jpeg") ext = ".jpg";
    if (ext !== ".png" && ext !== ".jpg") {
      throw new HttpError(400, "INVALID_BACKGROUND", "Ảnh nền phải là PNG hoặc JPG");
    }

    // Xóa nền cũ (có thể khác đuôi) rồi ghi background.<ext>
    for (const old of ["background.png", "background.jpg"]) {
      const abs = path.join(imageDirOf(meta.id), old);
      if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
    }
    const fileName = `background${ext}`;
    moveFile(uploaded.path, path.join(imageDirOf(meta.id), fileName));

    meta.background = fileName;
    if (meta.status === "error") meta.status = "draft";
    meta.error = null;
    writeImageMeta(meta.id, meta);
    res.json(meta);
  } catch (err) {
    if (uploaded?.path && fs.existsSync(uploaded.path)) {
      try {
        fs.unlinkSync(uploaded.path);
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
});

// ---------------------------------------------------------------- File rác
// File trung gian của bước compose — xóa được an toàn, KHÔNG đụng file nguồn
// (background.png/.jpg, final.png, meta.json). Pattern y hệt junk của video project.

interface JunkItem {
  /** relPath từ repo root, dấu /; thư mục kết thúc bằng "/" */
  relPath: string;
  size: number;
}

function collectImageJunk(id: string): { items: JunkItem[]; totalBytes: number } {
  const items: JunkItem[] = [];

  // props.json — PosterProps đã stage cho Remotion (sản phẩm của lần compose)
  const propsFile = path.join(imageDirOf(id), "props.json");
  if (fs.existsSync(propsFile)) {
    items.push({
      relPath: `image-projects/${id}/props.json`,
      size: fs.statSync(propsFile).size,
    });
  }

  // Staging hardlink cho Remotion — img-<id>
  const staging = path.join(paths.stagingDir, `img-${id}`);
  if (fs.existsSync(staging)) {
    items.push({
      relPath: `engines/remotion/public/staging/img-${id}/`,
      size: listFilesRecursive(staging).reduce((sum, f) => sum + f.size, 0),
    });
  }

  return { items, totalBytes: items.reduce((sum, i) => sum + i.size, 0) };
}

// GET /api/images/:id/junk — liệt kê file rác (file trung gian) + tổng dung lượng
router.get("/:id/junk", (req, res) => {
  const meta = readImageMeta(req.params.id); // ném 404 nếu không có
  res.json(collectImageJunk(meta.id));
});

// POST /api/images/:id/junk/clean — xóa file rác; job running/queued của project → 409
router.post("/:id/junk/clean", (req, res) => {
  const meta = readImageMeta(req.params.id); // ném 404 nếu không có
  if (db.hasActiveJobForProject(meta.id)) {
    throw new HttpError(
      409,
      "JOB_RUNNING",
      "Image project đang có job chạy/chờ trong hàng đợi — đợi xong rồi mới dọn file rác",
    );
  }
  const { items, totalBytes } = collectImageJunk(meta.id);
  for (const item of items) {
    // relPath dạng repo-relative dấu / (thư mục có "/" cuối) — path.join tự chuẩn hóa
    fs.rmSync(path.join(repoRoot, item.relPath), { recursive: true, force: true });
  }
  res.json({ freedBytes: totalBytes, deleted: items.length });
});

// POST /api/images/:id/generate — { step? } → 202 Job (queue type "image-gen")
router.post("/:id/generate", (req, res) => {
  const meta = readImageMeta(req.params.id); // ném 404 nếu không có
  const body = (req.body ?? {}) as Record<string, unknown>;
  const step = body.step === undefined ? "all" : body.step;
  if (!IMAGE_GEN_STEPS.includes(step as ImageGenStep)) {
    throw new HttpError(
      400,
      "INVALID_STEP",
      `step phải là một trong: ${IMAGE_GEN_STEPS.join(", ")}`,
    );
  }

  // sceneId của job "image-gen" mang step cần chạy (all | background | compose)
  const job = db.createJob({
    id: `job_${nanoid()}`,
    projectId: meta.id,
    type: "image-gen",
    sceneId: step as ImageGenStep,
  });
  broadcast("job", db.jobToApi(job));
  queue.enqueue(job.id);
  res.status(202).json(db.jobToApi(job));
});

export default router;
