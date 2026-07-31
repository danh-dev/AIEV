import fs from "node:fs";
import path from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { paths } from "../config.js";
import { broadcast } from "../events.js";
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

// ============ Tiến trình upload → SSE kênh "upload" ============

interface UploadTracker {
  /** Upload thành công — phát event cuối kèm tên file đã lưu. */
  done(projectId: string | undefined, file: string): void;
  /** Upload thất bại — phát event lỗi (idempotent). */
  fail(projectId?: string): void;
}

/** Tracker của request đang upload — handler phía sau lấy ra để chốt done/fail. */
const uploadTrackers = new WeakMap<Request, UploadTracker>();

const UPLOAD_THROTTLE_MS = 400;
/** Chỉ soi ~64KB đầu stream để tìm field projectId (client gửi field trước file). */
const HEAD_SNIFF_LIMIT = 65536;
/** Quá lâu không nhận thêm byte nào (điện thoại tắt màn hình, WiFi rớt ngầm) → coi là stall. */
const UPLOAD_STALL_MS = 45_000;

/**
 * Middleware ĐẶT TRƯỚC multer: đếm bytes nhận được của request multipart và
 * broadcast SSE `upload` (throttle ~400ms) để web UI hiện thanh tiến trình
 * realtime. Listener "data" chạy song song, không tiêu thụ stream — multer
 * (pipe vào busboy) vẫn nhận đủ dữ liệu.
 *
 * projectId được đọc từ đầu stream multipart (client append scope/projectId
 * TRƯỚC file) để các event progress lọc được theo project; event done cuối
 * cùng luôn dùng projectId chính xác từ req.body sau khi multer parse xong.
 */
function uploadProgress(req: Request, res: Response, next: NextFunction): void {
  const id = `up_${nanoid(10)}`;
  const total = Number(req.headers["content-length"]) || 0;
  let received = 0;
  let projectId: string | undefined;
  let head = "";
  let settled = false;
  let lastSent = 0;

  // Stall watchdog: timer reset mỗi chunk — hết UPLOAD_STALL_MS mà không nhận
  // thêm data thì phát event lỗi (PC không kẹt thanh tiến trình) + hủy request
  // (điện thoại nhận lỗi thay vì treo). Node requestTimeout đã tắt cho upload
  // dài nên đây là lưới duy nhất bắt kết nối chết ngầm.
  let stallTimer: NodeJS.Timeout | null = null;
  const clearStall = () => {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  };
  const armStall = () => {
    clearStall();
    stallTimer = setTimeout(() => {
      if (settled || req.complete) return;
      uploadTrackers.get(req)?.fail();
      req.destroy(new Error("Upload stall: 45s không nhận thêm dữ liệu"));
    }, UPLOAD_STALL_MS);
  };
  armStall();

  uploadTrackers.set(req, {
    done(finalProjectId, file) {
      if (settled) return;
      settled = true;
      clearStall();
      broadcast("upload", {
        id,
        projectId: finalProjectId ?? projectId,
        file,
        received: total,
        total,
        done: true,
      });
    },
    fail(finalProjectId) {
      if (settled) return;
      settled = true;
      clearStall();
      broadcast("upload", {
        id,
        projectId: finalProjectId ?? projectId,
        done: true,
        error: true,
      });
    },
  });

  req.on("data", (chunk: Buffer) => {
    armStall();
    received += chunk.length;
    if (!projectId && head.length < HEAD_SNIFF_LIMIT) {
      head += chunk.toString("latin1", 0, Math.min(chunk.length, HEAD_SNIFF_LIMIT));
      const m = /name="projectId"\r\n\r\n([^\r]*)\r\n/.exec(head);
      if (m?.[1]) projectId = m[1];
    }
    const now = Date.now();
    if (now - lastSent >= UPLOAD_THROTTLE_MS) {
      lastSent = now;
      broadcast("upload", { id, projectId, received, total, done: false });
    }
  });

  // Client rớt mạng giữa chừng — body chưa nhận đủ mà socket đã đóng
  req.on("close", () => {
    clearStall();
    if (!settled && !req.complete) uploadTrackers.get(req)?.fail();
  });

  // Lưới an toàn: response đã gửi mà chưa chốt (vd multer lỗi file quá lớn,
  // FILE_REQUIRED…) — chốt theo status code để web UI không kẹt thanh tiến trình
  res.on("finish", () => {
    if (!settled && res.statusCode >= 400) uploadTrackers.get(req)?.fail();
  });

  next();
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
// Tiến trình nhận file phát realtime qua SSE kênh "upload" (middleware uploadProgress)
router.post("/", uploadProgress, upload.single("file"), (req, res) => {
  const uploaded = req.file;
  if (!uploaded) throw new HttpError(400, "FILE_REQUIRED", "Thiếu file (field `file`)");

  const body = (req.body ?? {}) as Record<string, unknown>;
  const projectId = qs(body.projectId) || undefined;
  try {
    const scope = qs(body.scope);
    const dir = resolveScopeDir(scope, projectId ?? "", true);

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
    uploadTrackers.get(req)?.done(projectId, finalName);
    res.status(201).json(fileInfoOf(destAbs));
  } catch (err) {
    uploadTrackers.get(req)?.fail(projectId);
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
