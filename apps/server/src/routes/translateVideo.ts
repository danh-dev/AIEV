import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { paths, repoRoot } from "../config.js";
import * as db from "../db.js";
import { broadcast } from "../events.js";
import { cuesFromTranscript } from "../jobs/translateVideo.js";
import { queue } from "../queue.js";
import { probeVideo } from "../reframe.js";
import { STT_PROVIDERS, assertSttAvailable, isSttProvider, sttCapabilities } from "../stt.js";
import { translateCues } from "../translate.js";
import {
  SUBTITLE_FONTS,
  TRANSLATE_MODES,
  defaultBottomPx,
  defaultTranslateVideoMeta,
  isDefaultBottomPx,
  normCues,
  normLang,
  normSubtitleStyle,
  patchTranslateVideo,
  readTranslateVideo,
  scanTranslateVideos,
  sourceAbsOf,
  transcriptPathOf,
  translateVideoDirOf,
  translateVideoExists,
  writeTranslateVideo,
  type TranslateMode,
  type TranslateVideoMeta,
  type TranslatedCue,
} from "../translateVideoMeta.js";
import {
  HttpError,
  ensureDir,
  fileKind,
  isKebabCase,
  moveFile,
  toKebabAscii,
  toRepoRel,
} from "../util.js";

/**
 * Dịch video - mount tại /api/translate-video (xem index.ts).
 *
 * Bốn hành động tách riêng CÓ CHỦ Ý, vì mỗi bước đều cần người duyệt lại trước
 * khi tốn thời gian/tiền cho bước sau:
 *   POST /:id/source     - upload + đo video bằng ffprobe (vài giây)
 *   POST /:id/transcribe - whisper bóc lời          (rất lâu)  -> vào queue
 *   POST /:id/translate  - AI dịch từng câu         (~chục giây, tốn token) - ĐỒNG BỘ
 *   POST /:id/render     - Remotion ghép phụ đề     (lâu)      -> vào queue
 *
 * Route CHỈ validate + ghi meta + đẩy job. Mọi chuyển trạng thái nặng
 * (transcribing/rendering/done/failed) do job runner ghi - backend là nguồn sự
 * thật duy nhất về trạng thái job, route không đoán trước.
 */

const router = Router();

/** Video nguồn có thể rất nặng - cùng mức trần với upload asset thường */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(paths.uploadTmpDir);
      cb(null, paths.uploadTmpDir);
    },
    filename: (_req, _file, cb) =>
      cb(null, `tvd-${Date.now()}-${Math.round(Math.random() * 1e9)}`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
});

/** Đuôi video nhận được - đúng bộ mà fileKind() coi là "video" */
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);

// ------------------------------------------------------------------ Tiện ích

function mustRead(id: string): TranslateVideoMeta {
  if (!isKebabCase(id)) throw new HttpError(400, "INVALID_ID", "id không hợp lệ");
  if (!translateVideoExists(id)) {
    throw new HttpError(404, "NOT_FOUND", `Không tìm thấy phiên dịch "${id}"`);
  }
  return readTranslateVideo(id);
}

function uniqueId(name: string): string {
  const base = toKebabAscii(name) || "translate-video";
  let id = base;
  for (let n = 2; fs.existsSync(translateVideoDirOf(id)); n++) id = `${base}-${n}`;
  return id;
}

/** Chặn chạy chồng job trên cùng một phiên (queue chạy song song nhiều job) */
function assertNotBusy(meta: TranslateVideoMeta): void {
  if (db.hasActiveJobForProject(meta.id)) {
    throw new HttpError(
      409,
      "BUSY",
      `Phiên dịch "${meta.id}" đang có job chạy/chờ trong hàng đợi`,
    );
  }
  if (meta.status === "transcribing" || meta.status === "rendering" || meta.status === "translating") {
    throw new HttpError(409, "BUSY", `Phiên dịch "${meta.id}" đang ${meta.status}`);
  }
}

/**
 * Provider bóc lời từ client - giá trị lạ thì 400 CÓ MÃ, không im lặng lùi về
 * mặc định (im lặng thì người dùng chọn Soniox, hệ thống chạy whisper, và không
 * ai hiểu vì sao không có nhãn người nói). Đúng cách `mode` đang validate.
 *
 * KHÔNG kiểm tra key ở đây: lưu lựa chọn là việc rẻ và làm được cả khi chưa nhập
 * key (người dùng chọn trước, nhập key sau). Chốt chặn "có key chưa" nằm ở
 * /transcribe, ngay trước khi thật sự tốn thời gian.
 */
function mustSttProvider(raw: unknown): (typeof STT_PROVIDERS)[number] {
  if (!isSttProvider(raw)) {
    throw new HttpError(
      400,
      "INVALID_STT_PROVIDER",
      `sttProvider phải là một trong: ${STT_PROVIDERS.join(", ")}`,
    );
  }
  return raw;
}

/** Tạo + enqueue job. sceneId mang step (xem db.ts JobType "translate-video") */
function enqueueJob(sessionId: string, step: "transcribe" | "render"): db.JobApi {
  const job = db.createJob({
    id: `job_${nanoid()}`,
    // Queue dùng projectId làm khóa bận; namespace "tvd:" tách khỏi job video
    projectId: sessionId,
    type: "translate-video",
    sceneId: step,
  });
  const api = db.jobToApi(job);
  broadcast("job", api);
  queue.enqueue(job.id);
  return api;
}

// ------------------------------------------------------------------ CRUD

/**
 * GET /api/translate-video/fonts -> SubtitleFontOption[]
 * Danh sách font hợp lệ cho subtitleStyle.fontFamily - UI đọc để dựng dropdown
 * thay vì hardcode. ĐẶT TRƯỚC GET /:id, nếu không "fonts" bị bắt như một id.
 */
router.get("/fonts", (_req, res) => {
  res.json(SUBTITLE_FONTS);
});

/**
 * GET /api/translate-video/stt-providers -> SttCapabilities[]
 *
 * AI nào bóc lời được TRÊN MÁY NÀY, kèm `diarization` (có phân vai người nói
 * không) và `why` khi không dùng được. UI đọc để dựng dropdown và khóa lựa chọn
 * thiếu key - thay vì để người dùng chọn rồi job chết ở phút thứ hai.
 * ĐẶT TRƯỚC GET /:id, nếu không "stt-providers" bị bắt như một id.
 */
router.get("/stt-providers", (_req, res) => {
  res.json(sttCapabilities());
});

// GET /api/translate-video -> TranslateVideoMeta[] (mới cập nhật trước)
router.get("/", (_req, res) => {
  res.json(scanTranslateVideos());
});

// POST /api/translate-video { name? } -> 201 TranslateVideoMeta
router.post("/", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Ô tên là tùy chọn: bỏ trống thì đặt tên tạm rồi lấy tên file nguồn khi upload
  let name = typeof body.name === "string" ? body.name.trim() : "";
  let autoNamed = false;
  if (!name) {
    name = "Video dịch";
    autoNamed = true;
  }

  const meta = defaultTranslateVideoMeta(uniqueId(name), name);
  meta.autoNamed = autoNamed;
  if ("sourceLang" in body) meta.sourceLang = normLang(body.sourceLang, meta.sourceLang);
  if ("targetLang" in body) meta.targetLang = normLang(body.targetLang, meta.targetLang);
  if (TRANSLATE_MODES.includes(body.mode as TranslateMode)) meta.mode = body.mode as TranslateMode;
  if ("sttProvider" in body) meta.sttProvider = mustSttProvider(body.sttProvider);

  writeTranslateVideo(meta);
  res.status(201).json(readTranslateVideo(meta.id));
});

// GET /api/translate-video/:id -> TranslateVideoMeta
router.get("/:id", (req, res) => {
  res.json(mustRead(req.params.id));
});

/**
 * PATCH /api/translate-video/:id -> TranslateVideoMeta
 * Body: { name?, sourceLang?, targetLang?, mode?, subtitleStyle?, cues? }
 *
 * Hai quy tắc "làm hết đúng" ở đây, cố ý ồn ào thay vì im lặng:
 *  - đổi sourceLang -> transcript cũ bóc bằng ngôn ngữ khác nên hết giá trị:
 *    xóa transcript + cues, phiên về draft, phải bóc lời lại.
 *  - đổi targetLang -> chỉ BẢN DỊCH hết giá trị: giữ transcript, trả `text` về
 *    câu gốc (`original`) và lùi về "transcribed" để dịch lại.
 */
router.patch("/:id", (req, res) => {
  const cur = mustRead(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;

  // Đang chạy job thì cue/ngôn ngữ/kiểu chữ đang được job đọc - chỉ cho sửa tên
  const touchesRun =
    "sourceLang" in body ||
    "targetLang" in body ||
    "mode" in body ||
    "sttProvider" in body ||
    "cues" in body ||
    "subtitleStyle" in body;
  if (touchesRun) assertNotBusy(cur);

  const patch: Partial<TranslateVideoMeta> = {};

  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new HttpError(400, "INVALID_NAME", "name phải là string không rỗng");
    }
    patch.name = body.name.trim();
    // User tự đặt tên - hạ cờ để bước upload không ghi đè bằng tên file
    patch.autoNamed = false;
  }

  if ("mode" in body) {
    if (!TRANSLATE_MODES.includes(body.mode as TranslateMode)) {
      throw new HttpError(
        400,
        "INVALID_MODE",
        `mode phải là một trong: ${TRANSLATE_MODES.join(", ")}`,
      );
    }
    patch.mode = body.mode as TranslateMode;
  }

  /**
   * Đổi provider bóc lời KHÔNG xóa transcript đang có - khác hẳn đổi `sourceLang`.
   *
   * Lý do phân biệt: đổi ngôn ngữ nguồn làm transcript cũ SAI (bóc bằng ngôn ngữ
   * khác), nên phải xóa. Đổi provider chỉ làm nó CŨ chứ không sai - chữ vẫn đúng,
   * bản dịch dựa trên nó vẫn dùng được. Xóa ở đây là bắt người dùng chạy lại một
   * bước rất đắt chỉ vì họ bấm thử một lựa chọn. Muốn có transcript của provider
   * mới thì bấm "bóc lời" lại; `transcriptInfo` luôn nói rõ transcript ĐANG CÓ là
   * của provider nào nên không có chuyện nhầm.
   */
  if ("sttProvider" in body) {
    patch.sttProvider = mustSttProvider(body.sttProvider);
  }

  if ("sourceLang" in body) {
    const next = normLang(body.sourceLang, cur.sourceLang);
    patch.sourceLang = next;
    if (next !== cur.sourceLang && cur.transcriptFile) {
      patch.transcriptFile = null;
      patch.cues = [];
      patch.outputFile = null;
      patch.status = "draft";
      patch.error = null;
    }
  }

  if ("targetLang" in body) {
    const next = normLang(body.targetLang, cur.targetLang);
    patch.targetLang = next;
    if (next !== cur.targetLang && cur.cues.length > 0) {
      patch.cues = cur.cues.map((c) => ({ ...c, text: c.original ?? c.text }));
      patch.outputFile = null;
      patch.status = cur.transcriptFile ? "transcribed" : "draft";
      patch.error = null;
    }
  }

  if ("subtitleStyle" in body) {
    patch.subtitleStyle = normSubtitleStyle(body.subtitleStyle, cur.subtitleStyle);
  }

  // Sửa bản dịch bằng tay: đọc thấy sai thì sửa chứ không phải dịch lại cả bài
  if ("cues" in body) {
    if (!Array.isArray(body.cues)) {
      throw new HttpError(400, "INVALID_CUES", "cues phải là mảng");
    }
    const cues = normCues(body.cues);
    if (cues.length === 0 && (body.cues as unknown[]).length > 0) {
      throw new HttpError(
        400,
        "INVALID_CUES",
        "Không cue nào hợp lệ - mỗi cue cần start < end (giây) và text không rỗng",
      );
    }
    patch.cues = cues;
    // Chữ đổi thì video đã ghép trước đó không còn khớp
    patch.outputFile = null;
  }

  res.json(patchTranslateVideo(cur.id, patch));
});

/**
 * DELETE /api/translate-video/:id -> 204
 * Xóa cả thư mục phiên (meta + nguồn + transcript + output). Không có gì đứng
 * độc lập bên ngoài như Videos Project của Auto cut, nên xóa là xóa sạch.
 */
router.delete("/:id", (req, res) => {
  const meta = mustRead(req.params.id);
  // Job đang chạy sẽ ghi tiếp vào thư mục vừa xóa -> chặn trước cho sạch
  assertNotBusy(meta);
  fs.rmSync(translateVideoDirOf(meta.id), { recursive: true, force: true });
  // Bản stage trong Remotion public/ chỉ là hardlink - dọn luôn cho khỏi rác
  fs.rmSync(path.join(paths.stagingDir, `tvd-${meta.id}`), { recursive: true, force: true });
  res.status(204).end();
});

// ------------------------------------------------------------------ Nguồn

/**
 * POST /api/translate-video/:id/source - multipart: file -> TranslateVideoMeta
 *
 * Đo bằng ffprobe NGAY khi nhận: kích thước/fps/thời lượng là đầu vào của mọi
 * phép đổi giây -> frame ở bước render, đo sau thì render mới biết là hỏng.
 * Dùng `probeVideo` chung với Auto cut nên cờ xoay của video quay bằng điện
 * thoại được xử lý y hệt (rotation 90/270 -> hoán đổi W/H).
 */
router.post("/:id/source", upload.single("file"), async (req, res) => {
  const uploaded = req.file;
  if (!uploaded) throw new HttpError(400, "FILE_REQUIRED", "Thiếu file (field `file`)");

  try {
    // multer đổi generic của handler → req.params.id bị suy ra string|string[], ép về string
    const meta = mustRead(String(req.params.id));
    assertNotBusy(meta);

    const ext = path.extname(uploaded.originalname).toLowerCase();
    if (!VIDEO_EXT.has(ext)) {
      throw new HttpError(
        400,
        "INVALID_SOURCE",
        `"${uploaded.originalname}" không phải video (mp4/mov/webm/mkv/avi/m4v)`,
      );
    }

    const dir = translateVideoDirOf(meta.id);
    ensureDir(dir);
    // Đổi nguồn = xóa nguồn cũ: tên file luôn là "source.<ext>" nên đuôi khác
    // sẽ để lại file mồ côi nặng hàng GB nếu không dọn.
    for (const name of fs.readdirSync(dir)) {
      if (/^source\./i.test(name)) fs.rmSync(path.join(dir, name), { force: true });
    }
    const destAbs = path.join(dir, `source${ext}`);
    moveFile(uploaded.path, destAbs);

    const probe = await probeVideo(destAbs);
    if (!(probe.durationSec > 0)) {
      throw new HttpError(400, "PROBE_FAILED", "ffprobe không đọc được thời lượng video");
    }

    const patch: Partial<TranslateVideoMeta> = {
      source: {
        relPath: toRepoRel(destAbs),
        durationSec: Math.round(probe.durationSec * 100) / 100,
        width: probe.width,
        height: probe.height,
        fps: Math.round(probe.fps * 1000) / 1000,
      },
      // Nguồn mới thì mọi thứ dẫn xuất từ nguồn cũ đều hết giá trị
      transcriptFile: null,
      cues: [],
      outputFile: null,
      status: "draft",
      error: null,
    };
    // Giờ mới biết khung dọc hay ngang: nếu bottomPx vẫn đang là một trong hai
    // giá trị MẶC ĐỊNH thì snap về đúng mặc định của hướng khung này (xem
    // DEFAULT_BOTTOM_PX). Người dùng đã tự đặt số khác thì không đụng tới.
    if (isDefaultBottomPx(meta.subtitleStyle.bottomPx)) {
      patch.subtitleStyle = {
        ...meta.subtitleStyle,
        bottomPx: defaultBottomPx(probe.height >= probe.width),
      };
    }
    // Phiên đặt tên tạm (user bỏ trống ô tên) - lấy tên file thật thay vào
    if (meta.autoNamed) {
      const stem = path.basename(uploaded.originalname, path.extname(uploaded.originalname)).trim();
      if (stem) {
        patch.name = stem.slice(0, 120);
        patch.autoNamed = false;
      }
    }
    // Transcript cũ trỏ tới video khác - xóa để không bị dùng nhầm
    fs.rmSync(transcriptPathOf(meta.id), { force: true });

    res.json(patchTranslateVideo(meta.id, patch));
  } catch (err) {
    if (uploaded.path && fs.existsSync(uploaded.path)) {
      try {
        fs.unlinkSync(uploaded.path);
      } catch {
        /* file tạm đang bị giữ - bỏ qua */
      }
    }
    throw err;
  }
});

// ------------------------------------------------------------------ Bóc lời

/**
 * POST /api/translate-video/:id/transcribe -> 202 { jobId } - job step "transcribe"
 * Body (tùy chọn): { sttProvider } - chọn luôn provider cho lần chạy này.
 *
 * Kiểm tra provider có dùng được TRƯỚC KHI đẩy vào hàng đợi: thiếu
 * SONIOX_API_KEY thì trả 503 STT_PROVIDER_UNAVAILABLE kèm câu tiếng Việt ngay
 * tại đây, thay vì để người dùng thấy job "đang chạy" rồi failed vài giây sau.
 */
router.post("/:id/transcribe", (req, res) => {
  const meta = mustRead(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  sourceAbsOf(meta); // ném 400 NO_SOURCE / 404 SOURCE_NOT_FOUND nếu thiếu file
  assertNotBusy(meta);

  const provider = "sttProvider" in body ? mustSttProvider(body.sttProvider) : meta.sttProvider;
  assertSttAvailable(provider);
  // Job runner đọc meta từ đĩa - lựa chọn phải nằm trên đĩa TRƯỚC khi enqueue
  if (provider !== meta.sttProvider) patchTranslateVideo(meta.id, { sttProvider: provider });

  res.status(202).json({ jobId: enqueueJob(meta.id, "transcribe").id });
});

// ------------------------------------------------------------------ Dịch

/**
 * POST /api/translate-video/:id/translate { model? } -> TranslateVideoMeta
 *
 * ĐỒNG BỘ (giống /script của Text to video): dịch vài chục câu mất khoảng chục
 * giây, đưa vào queue chỉ thêm một tầng trạng thái mà không nhanh hơn.
 *
 * Đầu vào lấy từ TRANSCRIPT GỐC chứ không phải `cues` hiện tại - `cues` có thể
 * đã là bản dịch của lần trước (dịch chồng lên bản dịch là ra thứ càng lúc càng
 * lệch). Không còn transcript thì mới lùi về dùng `original` của cue.
 */
router.post("/:id/translate", async (req, res) => {
  const meta = mustRead(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  assertNotBusy(meta);

  const model =
    typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;

  const input = sourceCuesOf(meta);
  if (input.length === 0) {
    throw new HttpError(
      400,
      "NO_TRANSCRIPT",
      "Chưa có lời gốc để dịch - chạy bước bóc lời trước.",
    );
  }

  patchTranslateVideo(meta.id, { status: "translating", error: null });
  try {
    const result = await translateCues({
      cues: input.map((c) => ({ start: c.start, end: c.end, text: c.text })),
      sourceLang: meta.sourceLang,
      targetLang: meta.targetLang,
      mode: meta.mode,
      model,
      usageTag: "translate-video",
      projectId: meta.id,
    });
    const cues = normCues(result.cues);
    if (cues.length === 0) {
      throw new HttpError(
        502,
        "TRANSLATE_EMPTY",
        "AI không trả về câu dịch nào đọc được - thử lại, hoặc đổi model.",
      );
    }
    res.json(
      patchTranslateVideo(meta.id, {
        cues,
        status: "translated",
        // Bản dịch mới thì video đã ghép trước đó không còn khớp
        outputFile: null,
        error: null,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Lùi về đúng trạng thái CHẠY LẠI ĐƯỢC, không để kẹt ở "translating"
    patchTranslateVideo(meta.id, {
      status: meta.transcriptFile ? "transcribed" : "draft",
      error: message,
    });
    throw err;
  }
});

/**
 * Câu GỐC để đưa đi dịch: ưu tiên transcript trên đĩa (nguồn sự thật, chia câu
 * bằng đúng segmentsToCues của hệ thống), thiếu thì lùi về `original` của cue.
 */
function sourceCuesOf(meta: TranslateVideoMeta): TranslatedCue[] {
  if (meta.transcriptFile) {
    const abs = path.join(repoRoot, meta.transcriptFile);
    const cues = cuesFromTranscript(abs);
    if (cues.length > 0) return cues;
  }
  return meta.cues.map((c) => ({ ...c, text: c.original ?? c.text }));
}

// ------------------------------------------------------------------ Ghép phụ đề

// POST /api/translate-video/:id/render -> 202 { jobId } - job step "render"
router.post("/:id/render", (req, res) => {
  const meta = mustRead(req.params.id);
  sourceAbsOf(meta);
  assertNotBusy(meta);
  if (meta.mode !== "subtitle") {
    throw new HttpError(
      501,
      "MODE_NOT_IMPLEMENTED",
      'Mới làm được chế độ "subtitle" (ghép phụ đề) - lồng tiếng là giai đoạn sau.',
    );
  }
  if (meta.cues.length === 0) {
    throw new HttpError(
      400,
      "NO_CUES",
      "Chưa có câu phụ đề nào - chạy bước bóc lời và dịch trước.",
    );
  }
  if (fileKind(meta.source.relPath ?? "") !== "video") {
    throw new HttpError(400, "INVALID_SOURCE", "Nguồn của phiên không phải file video");
  }
  res.status(202).json({ jobId: enqueueJob(meta.id, "render").id });
});

export default router;
