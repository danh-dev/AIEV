import { Router } from "express";
import {
  DEFAULT_TTS_VOICE,
  listTtsModels,
  listVoices,
  synthPreviewWav,
} from "../tts.js";
import { HttpError } from "../util.js";

/**
 * GET  /api/tts/models  - model TTS khả dụng (live từ Google, cache 1h)
 * GET  /api/tts/voices  - 30 giọng dựng sẵn kèm nhãn tiếng Việt
 * POST /api/tts/preview - đọc thử một câu ngắn, trả thẳng bytes WAV
 *
 * Đây là các endpoint phục vụ màn hình chọn giọng của Text to video. Chỉ
 * /preview là TỐN TIỀN (mỗi lần bấm là một lần gọi Gemini sinh audio), nên nó
 * bị chặn cả về độ dài chữ lẫn tần suất - xem PREVIEW_MAX_CHARS và rate limit
 * bên dưới. /models và /voices thì miễn phí: danh sách model là một lời gọi
 * GET, còn danh sách giọng lấy được từ chính thông báo lỗi 400 khi hỏi một tên
 * giọng bịa (bị chặn trước khi sinh audio).
 */

/** Câu đọc thử mặc định - cố ý nhiều dấu khó để nghe rõ giọng xử lý tiếng Việt thế nào */
const PREVIEW_DEFAULT_TEXT =
  "Xin chào, đây là giọng đọc thử của hệ thống dựng video tự động. " +
  "Những chữ khó đọc như khuỷu tay, ngoằn ngoèo, quyến rũ, nghiêng ngả, tuyệt vời.";

/**
 * Trần độ dài câu đọc thử. Đọc thử chỉ để nghe chất giọng, không phải để tổng
 * hợp cả bài - ai muốn cả bài thì chạy job. Trần này cũng nằm dưới mốc ~1400 ký
 * tự mà Gemini bắt đầu đọc thiếu mà vẫn trả 200.
 */
const PREVIEW_MAX_CHARS = 300;

/**
 * Rate limit đơn giản trong một tiến trình (server này chỉ chạy một tiến trình,
 * không cần store ngoài): cách nhau tối thiểu 2 giây và tối đa 30 lần mỗi 10
 * phút. Mục đích là chặn tay bấm liên tục / vòng lặp lỗi đốt tiền, không phải
 * chống tấn công - lớp xác thực token đã lo phần đó.
 */
const PREVIEW_MIN_GAP_MS = 2_000;
const PREVIEW_WINDOW_MS = 10 * 60 * 1000;
const PREVIEW_MAX_PER_WINDOW = 30;
let previewLastAt = 0;
let previewHits: number[] = [];

function checkPreviewRate(): void {
  const now = Date.now();
  if (now - previewLastAt < PREVIEW_MIN_GAP_MS) {
    throw new HttpError(
      429,
      "PREVIEW_TOO_FAST",
      "Bấm chậm lại một chút - mỗi lần đọc thử cách nhau ít nhất 2 giây.",
    );
  }
  previewHits = previewHits.filter((t) => now - t < PREVIEW_WINDOW_MS);
  if (previewHits.length >= PREVIEW_MAX_PER_WINDOW) {
    throw new HttpError(
      429,
      "PREVIEW_QUOTA",
      `Đã đọc thử ${PREVIEW_MAX_PER_WINDOW} lần trong 10 phút - mỗi lần đọc thử đều tốn tiền API. Chờ vài phút rồi thử lại.`,
    );
  }
  previewLastAt = now;
  previewHits.push(now);
}

const router = Router();

// GET /api/tts/models → TtsModel[]
router.get("/models", async (_req, res) => {
  res.json(await listTtsModels());
});

// GET /api/tts/voices → TtsVoice[]
router.get("/voices", async (_req, res) => {
  res.json(await listVoices());
});

// POST /api/tts/preview { voice, model?, style?, text? } → bytes audio/wav
router.post("/preview", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const voice = typeof body.voice === "string" ? body.voice.trim() : "";
  if (!voice) {
    throw new HttpError(400, "VOICE_REQUIRED", "Thiếu tên giọng cần nghe thử (voice)");
  }
  if (!/^[a-z][a-z0-9-]{1,40}$/i.test(voice)) {
    throw new HttpError(400, "INVALID_VOICE", `Tên giọng không hợp lệ: "${voice.slice(0, 40)}"`);
  }
  if ("model" in body && body.model !== null && body.model !== undefined && typeof body.model !== "string") {
    throw new HttpError(400, "INVALID_MODEL", "model phải là string hoặc null");
  }
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
  const style = typeof body.style === "string" ? body.style.trim() : "";
  if (style.length > PREVIEW_MAX_CHARS) {
    throw new HttpError(
      400,
      "STYLE_TOO_LONG",
      `Chỉ dẫn cách đọc dài quá ${PREVIEW_MAX_CHARS} ký tự`,
    );
  }

  const raw = typeof body.text === "string" ? body.text.trim() : "";
  if (raw.length > PREVIEW_MAX_CHARS) {
    throw new HttpError(
      400,
      "PREVIEW_TEXT_TOO_LONG",
      `Câu đọc thử tối đa ${PREVIEW_MAX_CHARS} ký tự (đang ${raw.length}). Đọc thử chỉ để nghe chất giọng - cả bài thì chạy bước tổng hợp giọng đọc.`,
    );
  }
  const text = raw || PREVIEW_DEFAULT_TEXT;

  checkPreviewRate();

  const { wav, durationSec, model: modelUsed } = await synthPreviewWav({
    text,
    voice: voice || DEFAULT_TTS_VOICE,
    model,
    style,
  });

  res.setHeader("content-type", "audio/wav");
  res.setHeader("content-length", String(wav.length));
  // Mỗi lần gọi cho ra audio khác nhau (thời lượng lệch tới 28%) - cấm cache
  res.setHeader("cache-control", "no-store");
  // Thông tin phụ cho UI hiện dưới nút nghe thử, không nằm trong body vì body là audio
  res.setHeader("x-tts-model", modelUsed);
  res.setHeader("x-tts-duration", durationSec.toFixed(2));
  res.send(wav);
});

export default router;
