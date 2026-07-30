import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { paths } from "../config.js";
import { listProjectAssets, projectDirOf, projectExists } from "../meta.js";
import {
  HttpError,
  ensureDir,
  fileInfoOf,
  listFilesRecursive,
  moveFile,
  sanitizeFileName,
} from "../util.js";

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(paths.uploadTmpDir);
      cb(null, paths.uploadTmpDir);
    },
    filename: (_req, _file, cb) => cb(null, `up-${Date.now()}-${Math.round(Math.random() * 1e9)}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // footage có thể lớn
});

function qs(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Xác định thư mục theo scope; ném HttpError nếu scope không hợp lệ */
function resolveScopeDir(scope: string, projectId: string, forUpload: boolean): string {
  switch (scope) {
    case "imports":
      return paths.importsDir;
    case "outputs":
      if (forUpload) {
        throw new HttpError(400, "INVALID_SCOPE", "Không upload trực tiếp vào outputs");
      }
      return paths.outputsDir;
    case "project": {
      if (!projectId) throw new HttpError(400, "PROJECT_ID_REQUIRED", "Thiếu projectId");
      if (!projectExists(projectId)) {
        throw new HttpError(404, "PROJECT_NOT_FOUND", `Không tìm thấy project "${projectId}"`);
      }
      return path.join(projectDirOf(projectId), "assets");
    }
    default:
      throw new HttpError(400, "INVALID_SCOPE", "scope phải là imports | outputs | project");
  }
}

// GET /api/assets?scope=imports|outputs  |  ?scope=project&projectId=<id>
router.get("/", (req, res) => {
  const scope = qs(req.query.scope);
  const projectId = qs(req.query.projectId);
  const dir = resolveScopeDir(scope, projectId, false); // validate scope + project tồn tại
  if (scope === "project") {
    // FileInfo + description? merge từ assets/assets.json của project
    res.json(listProjectAssets(projectId));
    return;
  }
  res.json(listFilesRecursive(dir));
});

// POST /api/assets — multipart: file + scope (+projectId) → FileInfo (tên ép ASCII kebab-case)
router.post("/", upload.single("file"), (req, res) => {
  const uploaded = req.file;
  if (!uploaded) throw new HttpError(400, "FILE_REQUIRED", "Thiếu file (field `file`)");

  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scope = qs(body.scope);
    const projectId = qs(body.projectId);
    const dir = resolveScopeDir(scope, projectId, true);

    ensureDir(dir);
    const safeName = sanitizeFileName(uploaded.originalname);
    let finalName = safeName;
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    for (let n = 2; fs.existsSync(path.join(dir, finalName)); n++) {
      finalName = `${base}-${n}${ext}`;
    }

    const destAbs = path.join(dir, finalName);
    moveFile(uploaded.path, destAbs);
    res.status(201).json(fileInfoOf(destAbs));
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

export default router;
