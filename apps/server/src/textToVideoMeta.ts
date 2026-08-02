import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { defaultBrief, briefOf, type Brief, type ProjectMeta } from "./meta.js";
import { isKebabCase } from "./util.js";

/**
 * Text to video - phiên biến bài viết/đoạn văn thành video.
 *
 * HÌNH DẠNG GIỐNG AUTO CUT: đây là một phiên NGUỒN, không phải video project.
 * Chạy xong nó tự sinh ra một Videos Project thật (createChildProject với
 * parentId: null) rồi để pipeline cũ dựng video - không có đường render riêng.
 *
 * Vì sao không nhét thẳng vào Videos Project: nguồn ở đây phải qua ba bước AI
 * trước khi có nguyên liệu (bóc bài → viết kịch bản đọc → tổng hợp giọng), mỗi
 * bước đều có thể hỏng và cần người duyệt lại. Trộn vào project sẽ làm trang
 * project gánh thêm ba trạng thái không liên quan tới việc dựng video.
 */

/** Nguồn: dán link bài viết, hoặc dán thẳng đoạn văn */
export type TextSourceKind = "url" | "text";

export const TEXT_SOURCE_KINDS: TextSourceKind[] = ["url", "text"];

export interface TextToVideoSource {
  kind: TextSourceKind;
  /** kind="url" - link bài viết người dùng dán */
  url: string;
  /** kind="text" - đoạn văn dán thẳng; cũng là nơi chứa bài đã bóc để user sửa */
  text: string;
}

/** Bài viết đã bóc được từ URL - lưu riêng ra article.json */
export interface ExtractedArticle {
  title: string;
  /** Từng đoạn văn tách sẵn - dùng làm đơn vị chia scene, không phải một khối text */
  blocks: string[];
  byline: string | null;
  siteName: string | null;
  publishedTime: string | null;
  canonicalUrl: string | null;
  leadImage: string | null;
  lang: string | null;
  /** Tổng số ký tự của blocks - UI hiện để người dùng ước lượng độ dài video */
  chars: number;
}

/**
 * Một đoạn của kịch bản đọc. Chia nhỏ vì Gemini TTS cắt câm khi input dài:
 * trên ~1400 ký tự nó đọc thiếu mà VẪN trả finishReason "STOP" (200 OK), đo
 * được chỉ 38% nội dung ở mức 5000 ký tự. Mốc an toàn 400-800 ký tự.
 */
export interface ScriptChunk {
  text: string;
  /** Thời lượng ĐO ĐƯỢC bằng ffprobe sau khi tổng hợp - null = chưa đọc */
  durationSec: number | null;
}

export const TTS_CHUNK_MIN_CHARS = 400;
export const TTS_CHUNK_MAX_CHARS = 800;
/**
 * Input quá ngắn thì Gemini hay trả 200 OK mà KHÔNG có audio (đo được 6/10 lần
 * với câu 9 ký tự). Gộp đoạn ngắn lên tối thiểu mức này.
 */
export const TTS_CHUNK_SAFE_MIN_CHARS = 30;

export interface TextToVideoVoice {
  /** Model TTS, vd "gemini-2.5-flash-preview-tts" - null = mặc định của server */
  model: string | null;
  /** Tên giọng, vd "Kore" (API nhận không phân biệt hoa thường) */
  name: string;
  /**
   * Chỉ dẫn cách đọc, chèn trước văn bản. Đo được: đổi câu này làm thời lượng
   * chênh tới 2,6 lần, nên đổi giữa chừng là phải tổng hợp lại toàn bộ.
   */
  style: string;
}

export function defaultVoice(): TextToVideoVoice {
  return { model: null, name: "Kore", style: "" };
}

export interface TextToVideoOutput {
  width: number;
  height: number;
  fps: number;
  /** Style Design áp cho video sinh ra - null = style mặc định */
  styleId: string | null;
}

export function defaultOutput(): TextToVideoOutput {
  return { width: 1080, height: 1920, fps: 30, styleId: null };
}

export type TextToVideoStatus =
  | "draft"
  | "extracting"
  | "scripting"
  | "ready"
  | "voicing"
  | "building"
  | "done"
  | "failed";

export interface TextToVideoMeta {
  id: string;
  name: string;
  source: TextToVideoSource;
  /** Bài đã bóc (kind="url"); null khi dán text thẳng hoặc chưa bóc */
  article: ExtractedArticle | null;
  /** Kịch bản đọc do AI viết, đã chia đoạn - rỗng nghĩa là chưa viết */
  script: ScriptChunk[];
  voice: TextToVideoVoice;
  /**
   * Model Claude viết kịch bản - null = mặc định của SDK.
   * Chạy qua Agent SDK nên dùng đúng gói subscription đã đăng nhập trên máy,
   * không cần API key riêng (xem hasClaudeAuth trong config.ts).
   */
  scriptModel: string | null;
  output: TextToVideoOutput;
  /**
   * Brief cho Videos Project sinh ra - CÙNG kiểu với Videos Project để dùng lại
   * nguyên bộ BriefFields trên web và applyBriefPatch dưới server.
   */
  brief: Brief;
  /** File giọng đọc đã ghép (đường dẫn tương đối repo) - null = chưa có */
  voiceFile: string | null;
  /** Thời lượng ĐO ĐƯỢC của giọng đọc. KHÔNG suy ra từ số ký tự - xem ghi chú dưới */
  voiceDurationSec: number | null;
  /** Transcript có word timestamp chạy từ file giọng (đường dẫn tương đối repo) */
  transcriptFile: string | null;
  /** id của Videos Project đã sinh ra - null = chưa dựng */
  projectId: string | null;
  status: TextToVideoStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * VÌ SAO thời lượng phải ĐO chứ không tính từ số ký tự: cùng một câu 83 ký tự,
 * 45 lần gọi liên tiếp trả về audio dài từ 4,93s tới 6,33s - lệch 28%. Lấy số
 * ước lượng đi dựng timeline là chắc chắn lệch tiếng.
 */
export const TTS_CHARS_PER_SEC_ESTIMATE = 14.9;

export function textToVideoDirOf(id: string): string {
  return path.join(paths.textToVideoDir, id);
}

export function textToVideoMetaPathOf(id: string): string {
  return path.join(textToVideoDirOf(id), "meta.json");
}

export function textToVideoExists(id: string): boolean {
  return isKebabCase(id) && fs.existsSync(textToVideoMetaPathOf(id));
}

export function defaultTextToVideoMeta(id: string, name: string): TextToVideoMeta {
  const now = new Date().toISOString();
  const brief = defaultBrief();
  // Giọng TTS không có khoảng lặng thừa hay từ đệm để cắt; bật autoCut lên là
  // ra lệnh cho AI đi cắt vào một bản đọc vốn đã sạch.
  brief.autoCut = false;
  return {
    id,
    name,
    source: { kind: "url", url: "", text: "" },
    article: null,
    script: [],
    voice: defaultVoice(),
    scriptModel: null,
    output: defaultOutput(),
    brief,
    voiceFile: null,
    voiceDurationSec: null,
    transcriptFile: null,
    projectId: null,
    status: "draft",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Đọc meta từ đĩa, vá field thiếu bằng mặc định (file trên đĩa không tin kiểu) */
export function readTextToVideo(id: string): TextToVideoMeta {
  const raw = JSON.parse(fs.readFileSync(textToVideoMetaPathOf(id), "utf8")) as Record<
    string,
    unknown
  >;
  const base = defaultTextToVideoMeta(id, typeof raw.name === "string" ? raw.name : id);
  const src = (raw.source ?? {}) as Record<string, unknown>;
  const voice = (raw.voice ?? {}) as Record<string, unknown>;
  const out = (raw.output ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fb: number): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fb;
  return {
    ...base,
    source: {
      kind: src.kind === "text" ? "text" : "url",
      url: typeof src.url === "string" ? src.url : "",
      text: typeof src.text === "string" ? src.text : "",
    },
    article: (raw.article as ExtractedArticle | null) ?? null,
    script: Array.isArray(raw.script) ? (raw.script as ScriptChunk[]) : [],
    voice: {
      model: typeof voice.model === "string" ? voice.model : null,
      name: typeof voice.name === "string" && voice.name ? voice.name : base.voice.name,
      style: typeof voice.style === "string" ? voice.style : "",
    },
    scriptModel: typeof raw.scriptModel === "string" && raw.scriptModel ? raw.scriptModel : null,
    output: {
      width: num(out.width, base.output.width),
      height: num(out.height, base.output.height),
      fps: num(out.fps, base.output.fps),
      styleId: typeof out.styleId === "string" ? out.styleId : null,
    },
    // briefOf nhận ProjectMeta nhưng chỉ đọc đúng field `brief` - bọc lại cho
    // đúng kiểu thay vì ép kiểu bừa, để đổi ProjectMeta sau này còn báo lỗi
    brief: briefOf({ brief: raw.brief } as unknown as ProjectMeta),
    voiceFile: typeof raw.voiceFile === "string" ? raw.voiceFile : null,
    voiceDurationSec:
      typeof raw.voiceDurationSec === "number" && Number.isFinite(raw.voiceDurationSec)
        ? raw.voiceDurationSec
        : null,
    transcriptFile: typeof raw.transcriptFile === "string" ? raw.transcriptFile : null,
    projectId: typeof raw.projectId === "string" ? raw.projectId : null,
    status: (raw.status as TextToVideoStatus) ?? "draft",
    error: typeof raw.error === "string" ? raw.error : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : base.createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : base.updatedAt,
  };
}

export function writeTextToVideo(meta: TextToVideoMeta): void {
  const dir = textToVideoDirOf(meta.id);
  fs.mkdirSync(dir, { recursive: true });
  const next: TextToVideoMeta = { ...meta, updatedAt: new Date().toISOString() };
  fs.writeFileSync(textToVideoMetaPathOf(meta.id), JSON.stringify(next, null, 2), "utf8");
}

/** Vá một phần meta rồi ghi - đọc lại từ đĩa để không đè mất thay đổi song song */
export function patchTextToVideo(
  id: string,
  patch: Partial<TextToVideoMeta>,
): TextToVideoMeta {
  const cur = readTextToVideo(id);
  const next = { ...cur, ...patch };
  writeTextToVideo(next);
  return next;
}

/** Toàn bộ chữ sẽ đưa cho AI viết kịch bản: bài đã bóc, hoặc đoạn văn dán thẳng */
export function sourceTextOf(meta: TextToVideoMeta): string {
  if (meta.article && meta.article.blocks.length > 0) {
    return [meta.article.title, ...meta.article.blocks].filter(Boolean).join("\n\n");
  }
  return meta.source.text.trim();
}

/** Nối kịch bản thành một chuỗi - dùng để đếm ký tự và hiện cho người dùng đọc */
export function scriptTextOf(meta: TextToVideoMeta): string {
  return meta.script.map((c) => c.text).join("\n\n");
}
