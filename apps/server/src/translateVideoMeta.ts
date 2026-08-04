import fs from "node:fs";
import path from "node:path";
import { paths, repoRoot } from "./config.js";
import { HttpError, isKebabCase, nowIso } from "./util.js";

/**
 * Dịch video - phiên nhận một video, bóc lời, dịch, rồi ghép phụ đề (hoặc lồng
 * tiếng ở giai đoạn sau).
 *
 * HÌNH DẠNG GIỐNG TEXT TO VIDEO / AUTO CUT: đây là một phiên NGUỒN, không phải
 * Videos Project. Đĩa là nguồn sự thật: `translate-video/<id>/meta.json`, SQLite
 * chỉ giữ job của hàng đợi.
 *
 * Vì sao KHÔNG nhét vào Videos Project: ở đây không có gì để "dựng" cả - không
 * scene, không HyperFrames, không Style Design. Chỉ có đúng một video nguồn đi
 * qua ba bước tất định (bóc lời -> dịch -> ghép phụ đề). Trộn vào project sẽ bắt
 * trang project gánh thêm ba trạng thái chẳng liên quan gì tới việc dựng video.
 *
 * Vòng đời (job runner ghi trạng thái, route chỉ validate + đẩy job):
 *   draft -> (job step "transcribe") transcribing -> transcribed
 *         -> (POST /translate, đồng bộ)  translating -> translated
 *         -> (job step "render")         rendering   -> done
 */

// ------------------------------------------------------------------ Kiểu dữ liệu

/** "subtitle" = ghép phụ đề dịch; "dub" = lồng tiếng (giai đoạn 2, chưa chạy) */
export type TranslateMode = "subtitle" | "dub";
export const TRANSLATE_MODES: TranslateMode[] = ["subtitle", "dub"];

export type TranslateStatus =
  | "draft"
  | "transcribing"
  | "transcribed"
  | "translating"
  | "translated"
  | "rendering"
  | "done"
  | "failed";

/** Nền chữ phụ đề: mờ nền phía sau, khối đặc, hoặc không có gì */
export type SubtitleBackdrop = "blur" | "solid" | "none";
export const SUBTITLE_BACKDROPS: SubtitleBackdrop[] = ["blur", "solid", "none"];

/**
 * Font phụ đề là một ID TRONG DANH SÁCH CHO PHÉP, không phải tên family tự do.
 *
 * VÌ SAO: chữ vẽ trong DOM của Remotion chỉ dùng được font đã đăng ký sẵn
 * (@font-face từ public/, hoặc font hệ thống có trên MÁY RENDER). Gõ một family
 * lạ thì trình duyệt IM LẶNG rơi về font mặc định - và thứ hỏng đầu tiên khi rơi
 * font là DẤU TIẾNG VIỆT (ề, ỡ, ậ mất dấu hoặc lệch vị trí), mà lỗi đó chỉ lộ ra
 * sau khi render xong cả video. Chặn ở tầng validate rẻ hơn nhiều.
 *
 * ID PHẢI TRÙNG bảng font của bên render (SUBTITLE_FONTS trong
 * engines/remotion/src/components/SubtitleTrack.tsx): id lạ ở đó rơi về font
 * mặc định một cách im lặng, tức là lựa chọn của người dùng bị nuốt mất mà
 * không ai báo. `cssStack` chỉ để UI hiện đúng bản xem trước - server không vẽ chữ.
 *
 * Mọi stack bên render đều KẾT bằng font tiếng Việt đóng gói sẵn (Inter subset
 * vietnamese, xem components/vietnameseFont.ts), nên chữ có dấu luôn đúng kể cả
 * khi font đứng trước thiếu glyph.
 */
export interface SubtitleFontOption {
  id: string;
  label: string;
  cssStack: string;
}

export const SUBTITLE_FONTS: SubtitleFontOption[] = [
  {
    id: "vietnamese",
    label: "Inter tiếng Việt (mặc định)",
    cssStack: "'CaptionInter', 'Segoe UI', sans-serif",
  },
  { id: "sans", label: "Arial / Helvetica", cssStack: "Arial, Helvetica, sans-serif" },
  {
    id: "serif",
    label: "Georgia / Times New Roman",
    cssStack: "Georgia, 'Times New Roman', serif",
  },
  { id: "mono", label: "Courier New / Consolas", cssStack: "'Courier New', Consolas, monospace" },
];

export const DEFAULT_SUBTITLE_FONT = "vietnamese";

export function isSubtitleFont(v: unknown): v is string {
  return typeof v === "string" && SUBTITLE_FONTS.some((f) => f.id === v);
}

/**
 * Kiểu chữ phụ đề. Mọi số đo tính theo KHUNG CHUẨN 1080x1920 - bên render tự
 * nhân theo kích thước thật của video nguồn. Một nguồn sự thật duy nhất, không
 * phải lưu hai bộ số cho video dọc và video ngang.
 */
export interface SubtitleStyle {
  /** id trong SUBTITLE_FONTS - KHÔNG phải tên family tự do (xem ghi chú trên) */
  fontFamily: string;
  fontSizePx: number;
  /** #rrggbb */
  color: string;
  backdrop: SubtitleBackdrop;
  /** Màu nền chữ - rgba() hoặc hex; chỉ có nghĩa khi backdrop != "none" */
  backdropColor: string;
  blurPx: number;
  /** Khoảng cách từ mép dưới khung */
  bottomPx: number;
}

/**
 * Khoảng cách mép dưới MẶC ĐỊNH - khác nhau theo hướng khung vì đơn vị tỉ lệ
 * của bên render cũng khác: video dọc chuẩn hóa theo cao 1920, video ngang theo
 * cao 1080 (xem SubtitleTrack.tsx). Nhét một con số cho cả hai là phụ đề của
 * video ngang bị đẩy lên gần giữa khung.
 *  - 320 (dọc): nằm trên vùng nút của TikTok/Reels (~288)
 *  - 130 (ngang): chuẩn của skill noti-youtube-edit
 */
export const DEFAULT_BOTTOM_PX = { vertical: 320, horizontal: 130 } as const;

export function defaultBottomPx(vertical: boolean): number {
  return vertical ? DEFAULT_BOTTOM_PX.vertical : DEFAULT_BOTTOM_PX.horizontal;
}

/** Giá trị này có phải MẶC ĐỊNH không (dùng để đổi theo hướng khung, xem route /source) */
export function isDefaultBottomPx(v: number): boolean {
  return v === DEFAULT_BOTTOM_PX.vertical || v === DEFAULT_BOTTOM_PX.horizontal;
}

/**
 * Mặc định TRÙNG KHỚP hằng số đang chạy của SubtitleTrack (và CaptionTrack):
 * "mặc định" phải là một thứ duy nhất ở cả hai đầu, nếu không thì bật/tắt việc
 * gửi subtitleStyle lại ra hai kiểu chữ khác nhau.
 */
export function defaultSubtitleStyle(): SubtitleStyle {
  return {
    fontFamily: DEFAULT_SUBTITLE_FONT,
    fontSizePx: 62,
    color: "rgba(255,255,255,0.92)",
    backdrop: "blur",
    backdropColor: "rgba(10,16,32,0.52)",
    blurPx: 20,
    bottomPx: DEFAULT_BOTTOM_PX.vertical,
  };
}

/** Một câu phụ đề đã dịch. `start`/`end` là GIÂY trong video NGUỒN. */
export interface TranslatedCue {
  start: number;
  end: number;
  /** Đã xuống dòng sẵn bằng "\n" (tối đa 2 dòng - xem segmentsToCues) */
  text: string;
  /** Câu gốc, giữ lại để người dùng đối chiếu và để dịch lại không mất nguồn */
  original?: string;
  /** Nhãn người nói - giai đoạn 2 (lồng tiếng), chưa dùng ở đường phụ đề */
  speaker?: string;
}

export interface TranslateVideoSource {
  /** Đường dẫn tương đối repo tới file nguồn - null = chưa upload */
  relPath: string | null;
  durationSec: number | null;
  /** Kích thước SAU KHI giải mã (đã áp cờ xoay - xem probeVideo ở reframe.ts) */
  width: number | null;
  height: number | null;
  fps: number | null;
}

export interface TranslateVideoMeta {
  id: string;
  name: string;
  /** true = tên do server tự đặt tạm; bước upload nguồn thay bằng tên file thật */
  autoNamed: boolean;
  source: TranslateVideoSource;
  /** "auto" hoặc mã ngôn ngữ whisper ("vi", "en", "ja"...) */
  sourceLang: string;
  /** Mã ngôn ngữ đích ("vi" | "en" | ...) */
  targetLang: string;
  mode: TranslateMode;
  /** Transcript GỐC do whisper bóc ra (đường dẫn tương đối repo) */
  transcriptFile: string | null;
  /** Bản dịch - sửa tay được trên UI qua PATCH */
  cues: TranslatedCue[];
  subtitleStyle: SubtitleStyle;
  /** Video đã ghép phụ đề (đường dẫn tương đối repo) */
  outputFile: string | null;
  status: TranslateStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ Đường dẫn

export function translateVideoDirOf(id: string): string {
  return path.join(paths.translateVideoDir, id);
}

export function translateVideoMetaPathOf(id: string): string {
  return path.join(translateVideoDirOf(id), "meta.json");
}

export function translateVideoExists(id: string): boolean {
  return isKebabCase(id) && fs.existsSync(translateVideoMetaPathOf(id));
}

/** transcript.json của phiên - whisper ghi ra đây, bước dịch đọc lại từ đây */
export function transcriptPathOf(id: string): string {
  return path.join(translateVideoDirOf(id), "transcript.json");
}

/** File video đã ghép phụ đề */
export function outputPathOf(id: string): string {
  return path.join(translateVideoDirOf(id), "output.mp4");
}

/**
 * Đường dẫn tuyệt đối của video nguồn. Ném lỗi rõ ràng nếu chưa upload hoặc
 * file đã bị xóa - job và route đều cần đúng một thông báo này.
 */
export function sourceAbsOf(meta: TranslateVideoMeta): string {
  if (!meta.source.relPath) {
    throw new HttpError(
      400,
      "NO_SOURCE",
      `Phiên "${meta.id}" chưa có video nguồn - upload file trước.`,
    );
  }
  const abs = path.join(repoRoot, meta.source.relPath);
  if (!fs.existsSync(abs)) {
    throw new HttpError(
      404,
      "SOURCE_NOT_FOUND",
      `Không thấy video nguồn "${meta.source.relPath}" - file đã bị xóa hoặc di chuyển khỏi repo.`,
    );
  }
  return abs;
}

// ------------------------------------------------------------------ Chuẩn hóa

function posNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** Mã ngôn ngữ: chữ cái/số/gạch ngang, tối đa 16 ký tự (né chuỗi rác từ client) */
const LANG_RE = /^[A-Za-z0-9-]{2,16}$/;

export function normLang(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim();
  if (!v) return fallback;
  // Whisper nhận mã thường; "vi-VN" cũng chấp nhận để UI khỏi phải biết luật
  return LANG_RE.test(v) ? v.toLowerCase() : fallback;
}

/** Màu: #rgb/#rrggbb/#rrggbbaa hoặc rgb()/rgba() - chặn chuỗi lọt thẳng vào CSS */
const COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/;

function normColor(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim();
  return COLOR_RE.test(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function numInRange(raw: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.round(clamp(raw, lo, hi) * 100) / 100;
}

/**
 * Kiểu chữ phụ đề đã kiểm - field nào sai/thiếu thì giữ giá trị cũ (fallback),
 * không bao giờ ném lỗi: đây là thứ hiển thị, sai một con số không đáng làm hỏng
 * cả phiên. Riêng `fontFamily` sai thì rơi về font mặc định (xem SUBTITLE_FONTS).
 */
export function normSubtitleStyle(raw: unknown, fallback: SubtitleStyle): SubtitleStyle {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const o = raw as Record<string, unknown>;
  return {
    fontFamily: isSubtitleFont(o.fontFamily) ? o.fontFamily : fallback.fontFamily,
    // Dưới 16px là không đọc nổi, trên 200px thì một câu chiếm nửa khung
    fontSizePx: numInRange(o.fontSizePx, 16, 200, fallback.fontSizePx),
    color: normColor(o.color, fallback.color),
    backdrop: SUBTITLE_BACKDROPS.includes(o.backdrop as SubtitleBackdrop)
      ? (o.backdrop as SubtitleBackdrop)
      : fallback.backdrop,
    backdropColor: normColor(o.backdropColor, fallback.backdropColor),
    blurPx: numInRange(o.blurPx, 0, 80, fallback.blurPx),
    bottomPx: numInRange(o.bottomPx, 0, 1600, fallback.bottomPx),
  };
}

/** Bỏ \r (file .srt dán từ Windows) nhưng GIỮ \n - cue đã xuống dòng sẵn */
function normCueText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\r/g, "").replace(/\n{2,}/g, "\n").trim();
}

/**
 * Danh sách cue đã kiểm: bỏ cue không có chữ hoặc mốc thời gian vô nghĩa, sắp
 * xếp theo thời gian. Cue hỏng bị BỎ chứ không ném lỗi cả mảng - người dùng sửa
 * tay trên UI, một dòng lỗi không được chặn 200 dòng đúng.
 */
export function normCues(raw: unknown): TranslatedCue[] {
  if (!Array.isArray(raw)) return [];
  const out: TranslatedCue[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const start = typeof o.start === "number" && Number.isFinite(o.start) ? Math.max(0, o.start) : null;
    const end = typeof o.end === "number" && Number.isFinite(o.end) ? Math.max(0, o.end) : null;
    const text = normCueText(o.text);
    if (start === null || end === null || end <= start || !text) continue;
    const cue: TranslatedCue = {
      start: Math.round(start * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
      text,
    };
    const original = normCueText(o.original);
    if (original) cue.original = original;
    if (typeof o.speaker === "string" && o.speaker.trim()) cue.speaker = o.speaker.trim();
    out.push(cue);
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

// ------------------------------------------------------------------ Đọc/ghi

export function defaultTranslateVideoMeta(id: string, name: string): TranslateVideoMeta {
  const now = nowIso();
  return {
    id,
    name,
    autoNamed: false,
    source: { relPath: null, durationSec: null, width: null, height: null, fps: null },
    sourceLang: "auto",
    targetLang: "vi",
    mode: "subtitle",
    transcriptFile: null,
    cues: [],
    subtitleStyle: defaultSubtitleStyle(),
    outputFile: null,
    status: "draft",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

const TRANSLATE_STATUSES: TranslateStatus[] = [
  "draft",
  "transcribing",
  "transcribed",
  "translating",
  "translated",
  "rendering",
  "done",
  "failed",
];

/** Đọc meta từ đĩa, vá field thiếu bằng mặc định (file trên đĩa không tin kiểu) */
export function readTranslateVideo(id: string): TranslateVideoMeta {
  if (!isKebabCase(id)) {
    throw new HttpError(400, "INVALID_ID", `Id phiên dịch không hợp lệ: ${id}`);
  }
  const file = translateVideoMetaPathOf(id);
  if (!fs.existsSync(file)) {
    throw new HttpError(404, "NOT_FOUND", `Không tìm thấy phiên dịch "${id}"`);
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    throw new HttpError(500, "META_INVALID", `meta.json của phiên dịch "${id}" hỏng`);
  }

  const base = defaultTranslateVideoMeta(id, typeof raw.name === "string" ? raw.name : id);
  const src = (raw.source ?? {}) as Record<string, unknown>;
  const status = raw.status;

  return {
    ...base,
    autoNamed: raw.autoNamed === true,
    source: {
      relPath: typeof src.relPath === "string" && src.relPath ? src.relPath : null,
      durationSec: posNum(src.durationSec),
      width: posNum(src.width),
      height: posNum(src.height),
      fps: posNum(src.fps),
    },
    sourceLang: normLang(raw.sourceLang, base.sourceLang),
    targetLang: normLang(raw.targetLang, base.targetLang),
    mode: TRANSLATE_MODES.includes(raw.mode as TranslateMode)
      ? (raw.mode as TranslateMode)
      : base.mode,
    transcriptFile: typeof raw.transcriptFile === "string" ? raw.transcriptFile : null,
    cues: normCues(raw.cues),
    subtitleStyle: normSubtitleStyle(raw.subtitleStyle, base.subtitleStyle),
    outputFile: typeof raw.outputFile === "string" ? raw.outputFile : null,
    status: TRANSLATE_STATUSES.includes(status as TranslateStatus)
      ? (status as TranslateStatus)
      : base.status,
    error: typeof raw.error === "string" ? raw.error : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : base.createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
  };
}

export function writeTranslateVideo(meta: TranslateVideoMeta): void {
  fs.mkdirSync(translateVideoDirOf(meta.id), { recursive: true });
  const next: TranslateVideoMeta = { ...meta, updatedAt: nowIso() };
  fs.writeFileSync(
    translateVideoMetaPathOf(meta.id),
    JSON.stringify(next, null, 2) + "\n",
    "utf8",
  );
}

/**
 * Vá một phần meta rồi ghi - ĐỌC LẠI TỪ ĐĨA trước khi ghi để không đè mất thay
 * đổi song song (job đang chạy trong khi người dùng sửa cue trên UI).
 */
export function patchTranslateVideo(
  id: string,
  patch: Partial<TranslateVideoMeta>,
): TranslateVideoMeta {
  const cur = readTranslateVideo(id);
  const next: TranslateVideoMeta = { ...cur, ...patch };
  writeTranslateVideo(next);
  return next;
}

/** Danh sách phiên dịch, mới cập nhật trước */
export function scanTranslateVideos(): TranslateVideoMeta[] {
  if (!fs.existsSync(paths.translateVideoDir)) return [];
  const out: TranslateVideoMeta[] = [];
  for (const entry of fs.readdirSync(paths.translateVideoDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !translateVideoExists(entry.name)) continue;
    try {
      out.push(readTranslateVideo(entry.name));
    } catch {
      // meta.json hỏng - bỏ qua một phiên còn hơn làm chết cả danh sách
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
