/**
 * Typed fetch wrapper theo hợp đồng docs/API.md.
 * Web (6868) rewrites /api/* và /media/* sang backend (6869).
 */

// ============ Types ============

export interface HealthChecks {
  ffmpeg: boolean;
  node: string;
  /** Có xác thực Claude (subscription OAuth của Claude Code hoặc API key) */
  claudeAuth: boolean;
  hyperframes: boolean;
}

export interface Health {
  ok: boolean;
  checks: HealthChecks;
}

export type ProjectStatus = "draft" | "rendering" | "done";

export interface ProjectSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  status: ProjectStatus;
  output: string | null;
  tags: string[];
  /** Project cũ tạo trước khi có field này → null. */
  createdAt: string | null;
  updatedAt: string;
  /** Tổng token AI đã dùng cho project. */
  tokensUsed: number;
  /** Chi phí ước tính (USD) tương ứng. */
  costUsd: number;
}

/** Token + chi phí gộp - /api/usage/summary. */
export interface UsageSummary {
  byProject: Record<string, { tokens: number; costUsd: number }>;
  total: {
    tokens: number;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
  };
}

/** Loại project để lọc timeline token: all = mọi dòng, video/image theo projectId. */
export type UsageScope = "all" | "video" | "image";

/** Một ngày trong timeline token - /api/usage/timeline. */
export interface UsageTimelinePoint {
  /** yyyy-mm-dd */
  date: string;
  tokens: number;
  /** Token input (prompt) trong ngày. */
  tokensIn: number;
  /** Token output (completion) trong ngày. */
  tokensOut: number;
  costUsd: number;
  /** Token phân theo AI ("claude" | "gemini" | "openai") - vẽ đường theo provider. */
  byProvider: Record<string, number>;
}

export interface FileInfo {
  name: string;
  relPath: string;
  size: number;
  mtime: string;
  kind: "video" | "audio" | "image" | "other";
  /** Mô tả asset (assets.json của project) - cho AI biết dùng file vào lúc nào. */
  description?: string;
  /** Preset chỉnh màu đã lưu cho video (id preset - nhãn lấy từ getGradePresets). */
  colorGrade?: string;
  /** Thông số chỉnh tay cộng chồng lên preset - chỉ có khi khác mặc định. */
  colorAdjust?: Record<string, number>;
}

/**
 * Nhãn fallback của vài preset cũ - CHỈ dùng khi chưa fetch được danh sách.
 * Nguồn nhãn chính thức: GET /api/grade-presets (getGradePresets).
 */
export const GRADE_LABELS: Record<string, string> = {
  "tu-nhien": "Tự nhiên",
  cinematic: "Cinematic",
  "tuoi-sang": "Tươi sáng",
  am: "Ấm",
  lanh: "Lạnh",
};

/** Một preset màu server hỗ trợ - nguồn nhãn duy nhất cho UI. */
export interface GradePresetInfo {
  id: string;
  label: string;
}

// Cache module-level - danh sách preset tĩnh trong một phiên chạy server.
let gradePresetsCache: GradePresetInfo[] | null = null;

/** Danh sách preset màu (id + nhãn tiếng Việt) - cache sau lần gọi đầu. */
export async function getGradePresets(): Promise<GradePresetInfo[]> {
  if (gradePresetsCache) return gradePresetsCache;
  const list = await request<GradePresetInfo[]>("/api/grade-presets");
  gradePresetsCache = list;
  return list;
}

/** Thông số chỉnh màu tay - cộng CHỒNG lên preset (khớp GradeAdjust của server). */
export interface GradeAdjust {
  /** -0.3..0.3, mặc định 0 */
  brightness: number;
  /** 0.7..1.4, mặc định 1 */
  contrast: number;
  /** 0..2, mặc định 1 */
  saturation: number;
  /** 0.7..1.4, mặc định 1 */
  gamma: number;
  /** 4000..9500 (K), mặc định 6500 = không đổi */
  temperature: number;
  /** -0.5..0.5, mặc định 0 */
  vibrance: number;
}

export const DEFAULT_ADJUST: GradeAdjust = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  gamma: 1,
  temperature: 6500,
  vibrance: 0,
};

/** Điền default cho object adjust thiếu field (vd colorAdjust đọc từ meta). */
export function toGradeAdjust(raw?: Record<string, number> | null): GradeAdjust {
  const a = { ...DEFAULT_ADJUST };
  if (!raw || typeof raw !== "object") return a;
  for (const k of Object.keys(a) as (keyof GradeAdjust)[]) {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v)) a[k] = v;
  }
  return a;
}

/** true = mọi thông số đều ở mặc định (không chỉnh tay gì). */
export function isDefaultAdjust(raw?: GradeAdjust | Record<string, number> | null): boolean {
  const a = toGradeAdjust(raw as Record<string, number> | null | undefined);
  return (Object.keys(DEFAULT_ADJUST) as (keyof GradeAdjust)[]).every(
    (k) => a[k] === DEFAULT_ADJUST[k]
  );
}

/** Thông tin màu của footage - kèm kết quả grade-preview. */
export interface GradePreviewInfo {
  transfer: string;
  primaries: string;
  /** true = footage HDR/log, hệ thống sẽ delog trước khi áp màu. */
  needsTonemap: boolean;
  durationSec: number;
}

export interface GradePreviewItem {
  /** null = ảnh "Gốc" (không áp preset). */
  preset: string | null;
  label: string;
  relPath: string;
}

export interface GradePreviewResult {
  info: GradePreviewInfo;
  previews: GradePreviewItem[];
}

export type SfxMode = "recommended" | "library" | "none";

/** Nhạc nền: AI tự chọn bài theo mood trong thư viện / không dùng. */
export type MusicMode = "auto" | "none";

/** Kịch bản edit của project - AI đọc phần này khi bắt đầu edit. */
export interface Brief {
  sourceDescription: string;
  autoCut: boolean;
  subtitles: boolean;
  /** BẬT = AI tự phân tích source, chọn keyword và highlight. */
  highlightEnabled: boolean;
  /** (Nâng cao, tùy chọn) chỉ định thêm keyword thủ công. */
  highlightKeywords: string[];
  /** BẬT (mặc định) = bố cục Key: KEY CHÍNH ở vùng TRÊN video, KEY LIÊN QUAN ở vùng DƯỚI. */
  keyLayoutEnabled: boolean;
  /** Key chính do user chỉ định - "" = AI tự phân tích chọn. */
  mainKey: string;
  /** Key liên quan user chỉ định (AI bắt buộc dùng đủ) - [] = AI tự chọn 3–6 key. */
  relatedKeys: string[];
  skill: string | null;
  sfxMode: SfxMode;
  /** "auto" (mặc định) = AI tự chọn nhạc nền theo mood, "none" = không dùng. */
  musicMode: MusicMode;
  notes: string;
  /** BẬT = Claude chọn ý chính, Gemini vẽ ảnh minh họa rồi ghép vào video. */
  autoIllustrations: boolean;
  /** Model Gemini vẽ minh họa - null = mặc định của server (Nano Banana 2). */
  illustrationModel: string | null;
  /** BẬT = Gemini được vẽ chữ vào ảnh minh họa (mặc định TẮT - chữ do hệ thống đặt). */
  illustrationText: boolean;
  /** Style Design sản phẩm phải tuân theo - null = style mặc định. */
  styleId: string | null;
}

/** Prompt mẫu tái sử dụng - đổ vào ô "Yêu cầu edit" của brief. */
export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface SceneMeta {
  id: string;
  src?: string;
  srcVideo?: string;
  durationInFrames?: number;
  [key: string]: unknown;
}

export interface ProjectDetail extends ProjectSummary {
  scenes?: SceneMeta[];
  brief?: Brief;
  /** "thumbnail.png" nếu video-projects/<id>/thumbnail.png tồn tại - null = chưa tạo. */
  thumbnail?: string | null;
  files: { renders: FileInfo[]; assets: FileInfo[] };
  [key: string]: unknown;
}

export type JobType =
  | "scene-draft"
  | "scene-final"
  | "assemble-draft"
  | "assemble-final"
  | "image-gen";

export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface Job {
  id: string;
  projectId: string;
  type: JobType;
  sceneId: string | null;
  status: JobStatus;
  progress: number;
  step: string;
  outputPath: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type JobWithLog = Job & { log: string };

export interface Overview {
  runningJob: Job | null;
  queuedCount: number;
  recentJobs: Job[];
  recentProjects: ProjectSummary[];
  health: Health;
}

export interface SkillMeta {
  name: string;
  description: string;
  updatedAt: string;
  sizeBytes: number;
}

export interface SkillDetail {
  name: string;
  content: string;
}

export interface SfxEntry {
  file: string;
  tags: string[];
  durationMs: number | null;
  description: string;
}

/** Một bài nhạc nền trong thư viện assets/music/ - tags = mood. */
export interface MusicEntry {
  file: string;
  tags: string[];
  durationMs: number | null;
  description: string;
}

/** Trạng thái phiên AI - bền vững trong DB, đọc lại được sau khi tắt UI. */
export type ChatSessionStatus =
  | "idle"
  | "running"
  | "done"
  | "error"
  | "interrupted";

export interface ChatSession {
  sessionId: string;
  title: string;
  /** Project mà phiên chat gắn vào (null = chat tự do). */
  projectId: string | null;
  status: ChatSessionStatus;
  /** ISO - lúc lượt chạy hiện tại BẮT ĐẦU (không reset khi auto-resume). */
  runStartedAt: string | null;
  /** ISO - lúc lượt chạy kết thúc hẳn; null khi đang chạy. */
  runFinishedAt: string | null;
  /** Tự chạy tiếp khi phiên bị lỗi/gián đoạn (mặc định true). */
  autoResume: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  kind: "text" | "tool";
  content: string;
  createdAt: string;
}

export interface AgentEvent {
  sessionId: string;
  kind: "text" | "tool" | "result" | "error" | "done";
  text?: string;
  tool?: { name: string; input: unknown };
  error?: string;
  /** Kèm theo event kind "done" - kết cục của phiên. */
  status?: "done" | "error" | "interrupted";
}

export interface JobLogEvent {
  jobId: string;
  line: string;
}

/** Event SSE kênh "upload" - tiến trình server nhận file qua POST /api/assets. */
export interface UploadEvent {
  id: string;
  /** Có khi scope=project - dùng để lọc theo trang project đang mở. */
  projectId?: string;
  received?: number;
  /** 0 = không biết tổng (thiếu content-length) → hiện progress vô định. */
  total?: number;
  done: boolean;
  error?: boolean;
  /** Tên file đã lưu - đi kèm event done thành công. */
  file?: string;
}

// ============ AI Providers ============

/** Mode trên UI map sang effort của Agent SDK: Nhanh=low, Chuẩn=medium, Sâu=high. */
export type AgentEffort = "low" | "medium" | "high" | "xhigh";

export type ProviderRole = "edit" | "chat" | "image";

export interface ProviderModel {
  id: string;
  label: string;
}

export interface Provider {
  id: "claude" | "gemini";
  label: string;
  connected: boolean;
  /** oauth = subscription Claude Code; api-key = key trong .env. */
  source: "oauth" | "api-key" | null;
  note?: string;
  roles: ProviderRole[];
  models: ProviderModel[];
}

// ============ Kết nối (API key providers) ============

/** Trạng thái API key của một provider - key đọc từ .env, đổi được qua UI. */
export interface ConnectionKeyInfo {
  /** Tên biến môi trường chứa key (vd ANTHROPIC_API_KEY). */
  envVar: string;
  present: boolean;
  /** Key đã che bớt (vd sk-ant-…abcd) - null khi chưa có key. */
  masked: string | null;
}

/** Một provider trên trang Kết nối - GET /api/connections. */
export interface ConnectionInfo {
  id: "claude" | "gemini" | "openai";
  label: string;
  roles: string[];
  connected: boolean;
  /** oauth = subscription Claude Code; api-key = key trong .env. */
  source: "oauth" | "api-key" | null;
  /** Ghi chú giải thích trạng thái (server soạn, tiếng Việt). */
  note: string | null;
  key: ConnectionKeyInfo;
  /** Trang lấy API key của provider. */
  keyHelpUrl: string;
}

// ============ Cấu hình (render settings) ============

/**
 * Cài đặt tăng tốc render - server đọc mỗi lần job chạy / queue tick,
 * nên PUT là có hiệu lực ngay, không cần restart.
 */
export interface RenderSettings {
  /** Số worker Chrome của HyperFrames (0 = auto, 0-12). */
  workers: number;
  /** Chrome dùng GPU khi capture (browser rendering). */
  browserGpu: boolean;
  /** Encode GPU (NVENC/VideoToolbox) cho bản draft. */
  gpuEncodeDraft: boolean;
  /** Encode GPU cho bản FINAL - nhanh nhưng chất lượng nhỉnh kém libx264. */
  gpuEncodeFinal: boolean;
  /** Fast capture - chỉ thực sự hoạt động trên macOS + GPU, nơi khác fallback vô hại. */
  fastCapture: boolean;
  /** Concurrency render của Remotion (0 = auto; trần = số luồng CPU của máy). */
  remotionConcurrency: number;
  /** Số job render chạy đồng thời trong queue (1-4). */
  queueConcurrency: number;
  /** FPS cho bản draft - null = giữ nguyên fps project; 15 = draft nhanh. */
  draftFps: number | null;
}

/** Phần cứng máy backend phát hiện được - GET /api/render-settings. */
export interface HardwareInfo {
  /** process.platform của server: win32 | darwin | linux… */
  platform: string;
  cores: number;
  ramGb: number;
  /** Tên GPU - null khi không phát hiện được. */
  gpuName: string | null;
  /** Có encoder NVENC (GPU NVIDIA). */
  nvenc: boolean;
  /** Có encoder VideoToolbox (macOS). */
  videotoolbox: boolean;
  /** Tên đầy đủ CPU, vd "Intel Core i5-9400F CPU @ 2.90GHz". */
  cpuModel: string;
  /** Số core vật lý - null nếu không tra được (hiển thị rơi về threads). */
  cpuCores: number | null;
  /** Số luồng logic. */
  cpuThreads: number;
  /** Xung tối đa (GHz) - null nếu không tra được. */
  cpuMaxGhz: number | null;
  /** Loại RAM: DDR4 | DDR5 | Unified Memory… - null nếu không tra được. */
  ramType: string | null;
  /** Bus RAM (MHz). */
  ramSpeedMhz: number | null;
  /** VRAM (GB) - hiện chỉ có với GPU NVIDIA. */
  gpuVramGb: number | null;
}

/** Khuyến nghị theo máy thật - UI dựng option worker/concurrency từ đây. */
export interface RenderRecommended {
  /** Số worker Chrome khuyên dùng (= min(số luồng CPU, 8)). */
  workers: number;
  /** Remotion concurrency khuyên dùng. */
  concurrency: number;
  /** Trần chọn được (= max(số luồng CPU, 4)). */
  maxWorkers: number;
}

export interface RenderSettingsResponse {
  settings: RenderSettings;
  defaults: RenderSettings;
  hardware: HardwareInfo;
  recommended: RenderRecommended;
}

export const getRenderSettings = () =>
  request<RenderSettingsResponse>("/api/render-settings");

/** PUT partial - hiệu lực NGAY (job đọc mỗi lần chạy), không cần restart. */
export const updateRenderSettings = (patch: Partial<RenderSettings>) =>
  jsonBody<{ settings: RenderSettings }>("/api/render-settings", "PUT", patch);

// ============ Style Design (bộ nhận diện thương hiệu - nhiều style) ============

/** Màu BRAND trong một style (DATA của user) - không phải token màu UI. */
export interface StyleColors {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  accent: string;
}

/** Slot font của style - heading (tiêu đề) | body (nội dung). */
export type StyleFontSlot = "heading" | "body";

/** Hiệu ứng thị giác của style - bật/tắt được từng cái (default true/true). */
export interface StyleEffects {
  /** Chữ highlight + bề mặt dùng chuyển màu primary→secondary. */
  gradient: boolean;
  /** Chất liệu kính mờ: chip số liệu, phần tử 3D trong ảnh nền. */
  liquidGlass: boolean;
}

/** Một bộ nhận diện (Style Design) - lưu tại assets/styles/styles.json. */
export interface StyleDesign {
  id: string;
  name: string;
  tags: string[];
  colors: StyleColors;
  fonts: { heading: string; body: string };
  /** File font đã upload (relPath, phát qua /media) - null = font hệ thống. */
  fontFiles: { heading: string | null; body: string | null };
  /** relPath logo - phát qua /media. */
  logoPath: string | null;
  /** Hiệu ứng thị giác (gradient / liquid glass) - style cũ có thể thiếu. */
  effects?: StyleEffects;
  tone: string;
  guidelines: string;
  createdAt: string;
  updatedAt: string;
}

/** Kết quả GET /api/styles - danh sách style + style mặc định. */
export interface StylesResponse {
  defaultId: string | null;
  styles: StyleDesign[];
}

// ============ Image Projects ============

export type ImageKind =
  | "background"
  | "3d"
  | "character"
  | "texture"
  | "product"
  | "concept";

export type ImageAspect = "9:16" | "16:9" | "1:1" | "4:5";

export type ImageProjectStatus = "draft" | "generating" | "done" | "error";

export interface ImageStat {
  label: string;
  value: string;
}

/** Chữ trên ảnh - Remotion đặt theo Design System, KHÔNG nằm trong ảnh Gemini. */
export interface ImageOverlay {
  title: string;
  subtitle: string;
  stats: ImageStat[];
  cta: string;
  showLogo: boolean;
}

export interface ImageProject {
  id: string;
  name: string;
  prompt: string;
  kind: ImageKind;
  aspect: ImageAspect;
  status: ImageProjectStatus;
  overlay: ImageOverlay;
  /** Model Gemini tạo ảnh nền - null = model mặc định của server. */
  model: string | null;
  /** Style Design ảnh phải tuân theo - null = style mặc định. */
  styleId: string | null;
  /** relPath ảnh nền (Gemini tạo hoặc upload tay) - phát qua /media. */
  background: string | null;
  /** relPath ảnh hoàn thiện (Remotion compose) - phát qua /media. */
  final: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ImageGenStep = "all" | "background" | "compose";

// ============ Error & core ============

/**
 * Origin của backend - dùng cho upload file lớn: gọi THẲNG server (CORS đã mở),
 * không qua rewrite proxy của Next (proxy có timeout ~30s, file video lớn sẽ chết).
 */
export function serverOrigin(): string {
  if (typeof window === "undefined") return "http://localhost:6869";
  const port = process.env.NEXT_PUBLIC_SERVER_PORT || "6869";
  return `http://${window.location.hostname}:${port}`;
}

/**
 * Origin để UPLOAD file từ trang mobile /m - tự thích ứng cách truy cập:
 * - LAN/localhost (localhost, 127.x, IP private 192.168/10./172.16-31,
 *   Tailscale 100.64-127): gọi THẲNG backend 6869 (serverOrigin) - né proxy
 *   Next vì request dài dễ dính buffering/timeout với file video lớn.
 * - Domain qua tunnel (vd Cloudflare Tunnel https://aiev.noti.vn →
 *   localhost:6868): cổng 6869 KHÔNG tồn tại trên domain đó → upload
 *   same-origin qua đường proxy /api của Next (đã set proxyTimeout 10 phút).
 */
export function uploadOrigin(): string {
  if (typeof window === "undefined") return "http://localhost:6869";
  const host = window.location.hostname;
  const isLocalNetwork =
    host === "localhost" ||
    /^127\./.test(host) ||
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
      host
    );
  return isLocalNetwork ? serverOrigin() : window.location.origin;
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

// ============ Token truy cập backend ============

/**
 * Backend (6869) mở cho cả LAN để điện thoại upload được, nên nó đòi token cho
 * MỌI request không đến trực tiếp từ chính máy chủ. Dashboard lấy token thế này:
 *
 * 1. `?t=<token>` trên URL (mở dashboard từ xa qua Cloudflare Tunnel) → lưu lại.
 * 2. localStorage (đã lấy được ở lần trước).
 * 3. Gọi THẲNG `${serverOrigin()}/api/health` - request loopback trực tiếp
 *    (không qua proxy Next) nên backend trả kèm `apiToken`. Chỉ trình duyệt
 *    chạy trên chính máy chủ mới lấy được.
 *
 * Token được gắn vào: header `x-aiev-token` (mọi fetch) VÀ cookie `aiev_token`
 * (để <img>/<video>/EventSource - thứ không set được header - vẫn qua được).
 *
 * Trang /m trên điện thoại KHÔNG dùng token này: nó đi bằng token phiên QR
 * (`?k=`) mà backend chỉ cho xem project + upload asset.
 */
const TOKEN_KEY = "aiev_api_token";
/** Tên cookie PHẢI khớp với middleware xác thực của backend (index.ts) */
const TOKEN_COOKIE = "aiev_token";

let apiToken: string | null = null;
let tokenPromise: Promise<string | null> | null = null;

/** Token phiên upload QR trên URL (trang /m) - "" nếu không có. */
function uploadTokenFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("k") ?? "";
}

function persistToken(token: string): void {
  apiToken = token;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Safari private mode… - vẫn dùng được token trong phiên này
  }
  // Cookie để img/video/EventSource (không set header được) qua được middleware
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

async function ensureToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (apiToken) return apiToken;
  // Trang mobile /m: dùng ?k=, không có quyền lấy token chung
  if (uploadTokenFromUrl()) return null;
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("t");
    if (fromUrl) {
      persistToken(fromUrl);
      // Bỏ token khỏi thanh địa chỉ sau khi đã lưu (tránh lộ qua ảnh chụp/referrer)
      params.delete("t");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
      );
      return fromUrl;
    }
    try {
      const stored = window.localStorage.getItem(TOKEN_KEY);
      if (stored) {
        persistToken(stored); // set lại cookie (có thể đã hết hạn/bị xóa)
        return stored;
      }
    } catch {
      /* bỏ qua */
    }
    try {
      const res = await fetch(`${serverOrigin()}/api/health`, { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { apiToken?: string };
        if (body?.apiToken) {
          persistToken(body.apiToken);
          return body.apiToken;
        }
      }
    } catch {
      // Không gọi thẳng backend được (mở dashboard qua tunnel) - cần ?t=
    }
    tokenPromise = null; // cho phép thử lại ở request sau
    return null;
  })();

  return tokenPromise;
}

/** Thêm `k=<token QR>` vào URL khi đang ở trang /m (mọi request phải mang token). */
function withUploadToken(path: string): string {
  const k = uploadTokenFromUrl();
  if (!k) return path;
  return path + (path.includes("?") ? "&" : "?") + `k=${encodeURIComponent(k)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await ensureToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("x-aiev-token", token);

  let res: Response;
  try {
    res = await fetch(withUploadToken(path), { ...init, headers });
  } catch {
    throw new ApiError(
      "network",
      "Không kết nối được backend (port 6869). Kiểm tra server đã chạy chưa.",
      0
    );
  }
  if (!res.ok) {
    let code = String(res.status);
    let message = `Lỗi HTTP ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code: string; message: string };
      };
      if (body?.error) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {
      // body không phải JSON - giữ message mặc định
    }
    throw new ApiError(code, message, res.status);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function jsonBody<T>(
  path: string,
  method: "PUT" | "PATCH",
  body: unknown
): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ============ Health & Dashboard ============

export const getHealth = () => request<Health>("/api/health");
export const getOverview = () => request<Overview>("/api/overview");

// ============ Update (cập nhật hệ thống từ GitHub) ============

/** Một commit sắp được kéo về - hiện trong danh sách "Có gì mới" của popup. */
export interface UpdateCommit {
  hash: string;
  message: string;
}

export interface UpdateStatus {
  /** Short hash HEAD hiện tại ("" nếu server check lỗi). */
  current: string;
  /** Số commit đang thua origin/main. */
  behind: number;
  upToDate: boolean;
  latestMessage: string | null;
  /** Commit sắp về, mới nhất trước (tối đa 10) - rỗng khi đã mới nhất. */
  commits?: UpdateCommit[];
  checkedAt: string;
  /** false khi `git fetch origin` thất bại - behind tính theo refs cũ. */
  fetchOk?: boolean;
  /** Lỗi ngắn khi check thất bại (offline…) - server không bao giờ 500. */
  error?: string;
}

/** Bước script update đang chạy - server đọc từ mốc `[STEP] <tên>` trong log. */
export type UpdateStep = "pull" | "stop" | "install" | "restart";

/** Đuôi start/update.log của LẦN CHẠY GẦN NHẤT - /api/update/log. */
export interface UpdateLog {
  exists: boolean;
  lines: string[];
  step: UpdateStep | null;
  /** Dòng mốc mở đầu lần chạy (server trả nguyên văn, không phải ISO). */
  startedAt: string | null;
  error?: string;
}

export const checkUpdate = (force = false) =>
  request<UpdateStatus>(`/api/update/check${force ? "?force=1" : ""}`);

/**
 * Đuôi log cập nhật. VÌ SAO cần: script update chạy detached và tự kill server
 * này nên không thể đẩy tiến trình qua SSE - UI poll log lúc server còn sống
 * (bước pull) và gọi lại một lần khi server hồi sinh để lấy kết quả thật.
 */
export const getUpdateLog = (tail = 200) =>
  request<UpdateLog>(`/api/update/log?tail=${tail}`);

/** 202 khi đã spawn script update; 409 JOB_RUNNING khi đang có job render. */
export const applyUpdate = () =>
  post<{ ok: true; logHint: string }>("/api/update/apply");

// ============ Usage (token AI) ============

export const getUsageSummary = () =>
  request<UsageSummary>("/api/usage/summary");

/** Timeline token theo ngày - scope lọc theo loại project (bỏ qua = all). */
export const getUsageTimeline = (days = 30, scope?: UsageScope) =>
  request<UsageTimelinePoint[]>(
    `/api/usage/timeline?days=${days}${scope && scope !== "all" ? `&scope=${scope}` : ""}`
  );

// ============ Projects ============

export const getProjects = () => request<ProjectSummary[]>("/api/projects");

export const createProject = (input: {
  /** Bỏ trống → server tự sinh từ name (bỏ dấu tiếng Việt, kebab-case). */
  id?: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  tags?: string[];
}) => post<ProjectSummary>("/api/projects", input);

export const getProject = (id: string) =>
  request<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`);

/**
 * POST nhân bản project - server copy compositions/assets (kèm mô tả)/brief/tags/scenes,
 * BỎ renders + output; project mới ở trạng thái draft, id tự sinh từ name.
 * name bỏ trống → server dùng "<tên cũ> (bản sao)".
 */
export const cloneProject = (id: string, name?: string) =>
  post<ProjectSummary>(
    `/api/projects/${encodeURIComponent(id)}/clone`,
    name && name.trim() ? { name: name.trim() } : {}
  );

export const deleteProject = (id: string) =>
  request<void>(`/api/projects/${encodeURIComponent(id)}?force=true`, {
    method: "DELETE",
  });

/** PUT brief (partial được - server merge). */
export const updateBrief = (id: string, brief: Partial<Brief>) =>
  jsonBody<Brief>(
    `/api/projects/${encodeURIComponent(id)}/brief`,
    "PUT",
    brief
  );

/** PUT thay toàn bộ tags của project. */
export const updateProjectTags = (id: string, tags: string[]) =>
  jsonBody<{ tags: string[] }>(
    `/api/projects/${encodeURIComponent(id)}/tags`,
    "PUT",
    { tags }
  );

/** PUT mô tả một asset của project. */
export const updateAssetDescription = (
  projectId: string,
  file: string,
  description: string
) =>
  jsonBody<FileInfo>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(file)}/description`,
    "PUT",
    { description }
  );

/**
 * POST tạo thumbnail cho video project - chạy ĐỒNG BỘ (~1 phút: ffmpeg cắt
 * frame + Gemini vẽ nền theo Style Design + Remotion still). Trả 201 khi
 * video-projects/<id>/thumbnail.png đã ghi xong.
 */
export const createThumbnail = (
  id: string,
  input: { title: string; frameAt?: number; bgPrompt?: string }
) =>
  post<{ file: string; relPath: string }>(
    `/api/projects/${encodeURIComponent(id)}/thumbnail`,
    input
  );

/** Một mục file rác - relPath từ repo root, thư mục kết thúc bằng "/". */
export interface JunkItem {
  relPath: string;
  size: number;
}

export interface ProjectJunk {
  items: JunkItem[];
  totalBytes: number;
}

/** GET danh sách file rác (file trung gian sau khi xuất final) của project. */
export const getProjectJunk = (id: string) =>
  request<ProjectJunk>(`/api/projects/${encodeURIComponent(id)}/junk`);

/**
 * POST xóa file rác của project - renders/verify/cache, props.resolved.json,
 * draft lắp ráp và staging Remotion. File nguồn + video final giữ nguyên.
 * Project đang có job chạy/chờ → lỗi 409 JOB_RUNNING.
 */
export const cleanProjectJunk = (id: string) =>
  post<{ freedBytes: number; deleted: number }>(
    `/api/projects/${encodeURIComponent(id)}/junk/clean`
  );

/** DELETE một asset của project - xóa file + entry mô tả/màu trong assets.json. */
export const deleteProjectAsset = (projectId: string, file: string) =>
  request<void>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(file)}`,
    { method: "DELETE" }
  );

/**
 * Sinh ảnh preview các preset màu cho một video của project.
 * POST (dù là "get") vì server phải render 6 ảnh - mất vài giây.
 */
export const getGradePreviews = (projectId: string, file: string) =>
  post<GradePreviewResult>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(file)}/grade-preview`
  );

/**
 * Render MỘT frame chính xác theo preset + thông số chỉnh tay - phục vụ preview
 * lớn khi kéo slider. Server cache theo tham số nên gọi lại nhanh.
 */
export const renderGradeFrame = (
  projectId: string,
  file: string,
  preset: string | null,
  adjust: GradeAdjust
) =>
  post<{ relPath: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(file)}/grade-frame`,
    { preset, adjust }
  );

/**
 * PUT preset chỉnh màu cho asset video - preset null = bỏ chỉnh màu.
 * adjust mặc định thì server tự bỏ (không lưu colorAdjust).
 */
export const setAssetGrade = (
  projectId: string,
  file: string,
  preset: string | null,
  adjust?: GradeAdjust
) =>
  jsonBody<{
    file: string;
    colorGrade: string | null;
    colorAdjust: GradeAdjust | null;
  }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(file)}/grade`,
    "PUT",
    adjust ? { preset, adjust } : { preset }
  );

/**
 * Bắt đầu edit bằng AI - server tự soạn prompt từ brief + assets, trả sessionId chat.
 * model/effort (tùy chọn) lưu vào session - mọi lượt chạy sau dùng đúng model đó.
 */
export const startProjectEdit = (
  id: string,
  extraNotes?: string,
  opts?: { model?: string; effort?: AgentEffort }
) =>
  post<{ sessionId: string }>(`/api/projects/${encodeURIComponent(id)}/edit`, {
    ...(extraNotes && extraNotes.trim()
      ? { extraNotes: extraNotes.trim() }
      : {}),
    ...(opts?.model ? { model: opts.model } : {}),
    ...(opts?.effort ? { effort: opts.effort } : {}),
  });

// ============ Jobs ============

export const getJobs = (limit = 50) => request<Job[]>(`/api/jobs?limit=${limit}`);

export const getJob = (id: string) =>
  request<JobWithLog>(`/api/jobs/${encodeURIComponent(id)}`);

export const createJob = (input: {
  projectId: string;
  type: JobType;
  sceneId?: string;
}) => post<Job>("/api/jobs", input);

export const cancelJob = (id: string) =>
  post<Job>(`/api/jobs/${encodeURIComponent(id)}/cancel`);

// ============ Skills ============

export const getSkills = () => request<SkillMeta[]>("/api/skills");

export const getSkill = (name: string) =>
  request<SkillDetail>(`/api/skills/${encodeURIComponent(name)}`);

export const createSkill = (input: { name: string; content: string }) =>
  post<SkillDetail>("/api/skills", input);

export const updateSkill = (name: string, content: string) =>
  request<SkillDetail>(`/api/skills/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

export const deleteSkill = (name: string) =>
  request<void>(`/api/skills/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });

// ============ Tạo skill bằng AI ============

/** Body POST /api/skills/generate - mọi field trừ goal đều optional. */
export interface SkillGenerateInput {
  /** Mục đích & loại video - BẮT BUỘC. */
  goal: string;
  /** Tên kebab-case gợi ý; rỗng = AI tự đặt. */
  name?: string;
  /** "TikTok" | "YouTube" | "Facebook" | "Instagram" | tự do. */
  platform?: string;
  aspect?: "9:16" | "16:9" | "1:1" | "4:5";
  fps?: 30 | 60;
  /** vd "30–60s". */
  duration?: string;
  /** Phong cách & nhịp điệu. */
  style?: string;
  captions?: "karaoke" | "sentence" | "none";
  /** Keyword highlight. */
  highlights?: boolean;
  /** Sound effect đồng bộ timestamp. */
  sfx?: boolean;
  /** Tên skill có sẵn làm mẫu - server nhúng nội dung vào prompt. */
  baseSkill?: string;
  notes?: string;
}

export interface SkillGenerateResult {
  name: string;
  content: string;
  tokens: { input: number; output: number };
}

/**
 * Lỗi tạo skill bằng AI. 422 BAD_SKILL_OUTPUT kèm `raw` = văn bản gốc AI
 * trả về - UI đưa cho user tự sửa tay rồi lưu.
 */
export class SkillGenerateError extends ApiError {
  raw: string | null;

  constructor(code: string, message: string, status: number, raw: string | null) {
    super(code, message, status);
    this.name = "SkillGenerateError";
    this.raw = raw;
  }
}

/**
 * POST /api/skills/generate - Claude soạn draft SKILL.md (KHÔNG ghi file).
 * Gọi THẲNG server origin (như upload) vì có thể chạy 1–3 phút - proxy Next
 * có timeout sẽ cắt ngang. Lỗi ném SkillGenerateError (422 kèm raw).
 */
export async function generateSkill(
  input: SkillGenerateInput
): Promise<SkillGenerateResult> {
  let res: Response;
  const token = await ensureToken();
  try {
    res = await fetch(`${serverOrigin()}/api/skills/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-aiev-token": token } : {}),
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw new SkillGenerateError(
      "network",
      "Không kết nối được backend (port 6869). Kiểm tra server đã chạy chưa.",
      0,
      null
    );
  }
  if (!res.ok) {
    let code = String(res.status);
    let message = `Lỗi HTTP ${res.status}`;
    let raw: string | null = null;
    try {
      const body = (await res.json()) as {
        error?: { code: string; message: string; raw?: string };
        raw?: string;
      };
      if (body?.error) {
        code = body.error.code;
        message = body.error.message;
      }
      const r = body?.raw ?? body?.error?.raw;
      if (typeof r === "string" && r) raw = r;
    } catch {
      // body không phải JSON - giữ message mặc định
    }
    throw new SkillGenerateError(code, message, res.status, raw);
  }
  return (await res.json()) as SkillGenerateResult;
}

// ============ Prompt mẫu ============

export const getPrompts = () => request<PromptTemplate[]>("/api/prompts");

export const createPrompt = (input: { name: string; content: string }) =>
  post<PromptTemplate>("/api/prompts", input);

export const updatePrompt = (
  id: string,
  patch: { name?: string; content?: string }
) =>
  jsonBody<PromptTemplate>(
    `/api/prompts/${encodeURIComponent(id)}`,
    "PUT",
    patch
  );

export const deletePrompt = (id: string) =>
  request<void>(`/api/prompts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

// ============ Sound Effects ============

export const getSfx = () => request<SfxEntry[]>("/api/sfx");

export const uploadSfx = (file: File, tags: string, description: string) => {
  const form = new FormData();
  form.append("file", file);
  form.append("tags", tags);
  form.append("description", description);
  return request<SfxEntry>(`${serverOrigin()}/api/sfx`, { method: "POST", body: form });
};

/** PATCH sound effect - recommended=true/false thêm/gỡ tag "hay-dung". */
export const patchSfx = (
  file: string,
  patch: { description?: string; tags?: string[]; recommended?: boolean }
) => jsonBody<SfxEntry>(`/api/sfx/${encodeURIComponent(file)}`, "PATCH", patch);

export const deleteSfx = (file: string) =>
  request<void>(`/api/sfx/${encodeURIComponent(file)}`, { method: "DELETE" });

// ============ Nhạc nền (Music) ============

export const getMusic = () => request<MusicEntry[]>("/api/music");

export const uploadMusic = (file: File, tags: string, description: string) => {
  const form = new FormData();
  form.append("file", file);
  form.append("tags", tags);
  form.append("description", description);
  return request<MusicEntry>(`${serverOrigin()}/api/music`, { method: "POST", body: form });
};

export const patchMusic = (
  file: string,
  patch: { description?: string; tags?: string[] }
) => jsonBody<MusicEntry>(`/api/music/${encodeURIComponent(file)}`, "PATCH", patch);

export const deleteMusic = (file: string) =>
  request<void>(`/api/music/${encodeURIComponent(file)}`, { method: "DELETE" });

// ============ Assets ============

export type AssetScope = "imports" | "outputs" | "project";

export const getAssets = (scope: AssetScope, projectId?: string) => {
  const qs = new URLSearchParams({ scope });
  if (projectId) qs.set("projectId", projectId);
  return request<FileInfo[]>(`/api/assets?${qs.toString()}`);
};

export const uploadAsset = (
  file: File,
  scope: AssetScope,
  projectId?: string
) => {
  const form = new FormData();
  // scope/projectId TRƯỚC file - server đọc projectId từ đầu stream để phát
  // SSE `upload` progress lọc được theo project
  form.append("scope", scope);
  if (projectId) form.append("projectId", projectId);
  form.append("file", file);
  return request<FileInfo>(`${serverOrigin()}/api/assets`, { method: "POST", body: form });
};

// ============ Chat ============

/** Danh sách phiên chat - truyền projectId để chỉ lấy phiên của project đó. */
export const getChatSessions = (projectId?: string) =>
  request<ChatSession[]>(
    projectId
      ? `/api/chat/sessions?projectId=${encodeURIComponent(projectId)}`
      : "/api/chat/sessions"
  );

export const getChatMessages = (sessionId: string) =>
  request<ChatMessage[]>(
    `/api/chat/${encodeURIComponent(sessionId)}/messages`
  );

/**
 * Gửi tin nhắn - projectId chỉ dùng khi tạo session mới (gắn session vào project).
 * model/effort cũng chỉ có tác dụng lúc tạo session mới - lưu vào session.
 */
export const sendChat = (
  message: string,
  sessionId?: string,
  projectId?: string,
  opts?: { model?: string; effort?: AgentEffort }
) =>
  post<{ sessionId: string }>("/api/chat", {
    message,
    sessionId,
    projectId,
    ...(opts?.model ? { model: opts.model } : {}),
    ...(opts?.effort ? { effort: opts.effort } : {}),
  });

export const interruptChat = (sessionId: string) =>
  post<void>(`/api/chat/${encodeURIComponent(sessionId)}/interrupt`);

/** Bật/tắt tự chạy tiếp khi phiên bị lỗi/gián đoạn. */
export const setChatAutoResume = (sessionId: string, enabled: boolean) =>
  jsonBody<void>(
    `/api/chat/${encodeURIComponent(sessionId)}/auto-resume`,
    "PUT",
    { enabled }
  );

// ============ AI Providers ============

export const getProviders = () =>
  request<{ providers: Provider[] }>("/api/providers");

/** Kết quả GET /api/providers/gemini/image-models. */
export interface GeminiImageModels {
  /** google = danh sách live mới nhất; static = fallback khi chưa có key / lỗi mạng. */
  source: "google" | "static";
  models: ProviderModel[];
}

/**
 * Danh sách model ảnh Gemini MỚI NHẤT - KHÔNG cache phía client (server đã cache 1h)
 * để mỗi lần mở select đều nhận được model mới Google vừa phát hành.
 */
export const getGeminiImageModels = () =>
  request<GeminiImageModels>("/api/providers/gemini/image-models");

/** Kết quả GET /api/providers/claude/models. */
export interface ClaudeModels {
  /** anthropic = danh sách live từ Models API; static = fallback (chỉ OAuth / lỗi mạng). */
  source: "anthropic" | "static";
  models: ProviderModel[];
}

/**
 * Danh sách model Claude MỚI NHẤT - server cache 10 phút; chưa fetch xong
 * thì UI dùng danh sách tĩnh từ /api/providers.
 */
export const getClaudeModels = () =>
  request<ClaudeModels>("/api/providers/claude/models");

// ============ Kết nối (API key providers) ============

export const getConnections = () =>
  request<{ connections: ConnectionInfo[] }>("/api/connections");

/** PUT key mới (apiKey null = xóa key). Hiệu lực ngay, không cần restart. */
export const setConnectionKey = (provider: string, apiKey: string | null) =>
  jsonBody<{ connections: ConnectionInfo[] }>(
    `/api/connections/${encodeURIComponent(provider)}/key`,
    "PUT",
    { apiKey }
  );

/** Gọi thử API thật của provider - kiểm tra kết nối. */
export const testConnection = (provider: string) =>
  post<{ ok: boolean; message: string }>(
    `/api/connections/${encodeURIComponent(provider)}/test`
  );

// ============ Style Design ============

export const getStyles = () => request<StylesResponse>("/api/styles");

/** Tạo style mới - cloneFrom = id style muốn sao chép toàn bộ (bỏ qua = trống). */
export const createStyle = (input: {
  name: string;
  tags?: string[];
  cloneFrom?: string;
}) => post<StyleDesign>("/api/styles", input);

/** PUT partial (name/tags/colors/fonts/effects/tone/guidelines) - server merge. */
export const updateStyle = (
  id: string,
  patch: Partial<
    Pick<
      StyleDesign,
      "name" | "tags" | "colors" | "fonts" | "effects" | "tone" | "guidelines"
    >
  >
) =>
  jsonBody<StyleDesign>(`/api/styles/${encodeURIComponent(id)}`, "PUT", patch);

/** Xóa style - server cấm xóa style cuối cùng (400). */
export const deleteStyle = (id: string) =>
  request<void>(`/api/styles/${encodeURIComponent(id)}`, { method: "DELETE" });

export const setDefaultStyle = (id: string) =>
  post<{ defaultId: string }>(
    `/api/styles/${encodeURIComponent(id)}/default`
  );

/** Upload logo cho style (multipart) - gọi thẳng server như uploadAsset. */
export const uploadStyleLogo = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return request<StyleDesign>(
    `${serverOrigin()}/api/styles/${encodeURIComponent(id)}/logo`,
    { method: "POST", body: form }
  );
};

/** Upload font (.ttf/.otf/.woff/.woff2) cho một slot của style. */
export const uploadStyleFont = (id: string, slot: StyleFontSlot, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return request<StyleDesign>(
    `${serverOrigin()}/api/styles/${encodeURIComponent(id)}/font?slot=${slot}`,
    { method: "POST", body: form }
  );
};

/**
 * Tải font từ Google Fonts theo TÊN (server tải file TTF trọn bộ glyph tiếng
 * Việt, set luôn fonts[slot] + fontFiles[slot]). Lỗi: 404 FONT_NOT_FOUND
 * (sai tên), 502 (mạng).
 */
export const styleFontGoogle = (id: string, slot: StyleFontSlot, family: string) =>
  post<StyleDesign>(`/api/styles/${encodeURIComponent(id)}/font-google`, {
    slot,
    family,
  });

/** Gỡ font một slot của style - quay về font hệ thống. */
export const deleteStyleFont = (id: string, slot: StyleFontSlot) =>
  request<StyleDesign>(
    `/api/styles/${encodeURIComponent(id)}/font/${slot}`,
    { method: "DELETE" }
  );

// ============ Image Projects (tạo ảnh AI) ============

export const getImageProjects = () =>
  request<ImageProject[]>("/api/images");

export const createImageProject = (input: {
  name: string;
  prompt: string;
  kind: ImageKind;
  aspect: ImageAspect;
  overlay?: Partial<ImageOverlay>;
  /** Model Gemini tạo nền - bỏ qua = server dùng mặc định. */
  model?: string | null;
  /** Style Design áp cho ảnh - bỏ qua/null = style mặc định. */
  styleId?: string | null;
}) => post<ImageProject>("/api/images", input);

export const getImageProject = (id: string) =>
  request<ImageProject>(`/api/images/${encodeURIComponent(id)}`);

export const updateImageProject = (
  id: string,
  patch: Partial<
    Pick<
      ImageProject,
      "name" | "prompt" | "kind" | "aspect" | "overlay" | "model" | "styleId"
    >
  >
) =>
  jsonBody<ImageProject>(`/api/images/${encodeURIComponent(id)}`, "PUT", patch);

export const deleteImageProject = (id: string) =>
  request<void>(`/api/images/${encodeURIComponent(id)}`, { method: "DELETE" });

/** GET danh sách file rác của image project (props.json + staging Remotion). */
export const getImageJunk = (id: string) =>
  request<ProjectJunk>(`/api/images/${encodeURIComponent(id)}/junk`);

/**
 * POST xóa file rác của image project - props.json và staging Remotion img-<id>.
 * Ảnh nền, final.png và meta giữ nguyên. Project đang có job chạy/chờ → 409 JOB_RUNNING.
 */
export const cleanImageJunk = (id: string) =>
  post<{ freedBytes: number; deleted: number }>(
    `/api/images/${encodeURIComponent(id)}/junk/clean`
  );

/** Upload ảnh nền thủ công (multipart) - thay cho bước Gemini. */
export const uploadImageBackground = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return request<ImageProject>(
    `${serverOrigin()}/api/images/${encodeURIComponent(id)}/background`,
    { method: "POST", body: form }
  );
};

/** Chạy pipeline tạo ảnh - trả Job (queue type "image-gen", projectId = id ảnh). */
export const generateImage = (id: string, step?: ImageGenStep) =>
  post<Job>(
    `/api/images/${encodeURIComponent(id)}/generate`,
    step ? { step } : {}
  );

// ============ Kết nối điện thoại (LAN) ============

/** GET /api/lan-info - IP LAN của máy chạy server + port web, cho QR "Kết nối điện thoại". */
export interface LanInfo {
  /** IPv4 non-internal, đã ưu tiên dải 192.168/10. lên đầu. */
  ips: string[];
  webPort: number;
  /** Domain Cloudflare Tunnel (TUNNEL_DOMAIN trong .env, đã bỏ protocol) - null nếu chưa cấu hình. */
  tunnelDomain: string | null;
}

export const getLanInfo = () => request<LanInfo>("/api/lan-info");

/**
 * Phiên upload cho QR "Kết nối điện thoại" - token gắn vào URL (?k=) và
 * field `token` của FormData upload. Đóng modal → revoke → link hết hiệu lực.
 */
export interface UploadSession {
  /** Token dạng ut_<nanoid> - server giữ trong RAM, TTL 60 phút. */
  token: string;
  /** ISO - hạn của token (server tự dọn khi quá hạn). */
  expiresAt: string;
}

/** POST /api/upload-session - tạo token upload cho project (mở modal QR). */
export const createUploadSession = (projectId: string) =>
  post<UploadSession>("/api/upload-session", { projectId });

/** DELETE /api/upload-session/:token - thu hồi ngay (đóng modal QR). Idempotent. */
export const revokeUploadSession = (token: string) =>
  request<void>(`/api/upload-session/${encodeURIComponent(token)}`, {
    method: "DELETE",
  });

// ============ Cloudflare Tunnel (trang Kết nối) ============

/** GET /api/tunnel - trạng thái cloudflared + tunnel đang chạy. */
export interface TunnelStatus {
  /** cloudflared có trên PATH của máy chạy server không. */
  installed: boolean;
  running: boolean;
  /** true = tunnel do modal QR bật lên, sẽ tự tắt khi đóng modal / hết phiên upload. */
  auto: boolean;
  /** named = có TUNNEL_DOMAIN; quick = URL ngẫu nhiên trycloudflare.com. Null khi không chạy. */
  mode: "named" | "quick" | null;
  /** URL public đang hoạt động (https://…) - null khi không chạy / quick chưa parse được. */
  url: string | null;
  /** TUNNEL_DOMAIN trong .env (đã chuẩn hóa) - null nếu chưa cấu hình. */
  domain: string | null;
  /** ≤20 dòng log cloudflared cuối cùng. */
  lastLog: string[];
}

export const getTunnelStatus = () => request<TunnelStatus>("/api/tunnel");

/** PUT domain (rỗng/null = xóa TUNNEL_DOMAIN). Ghi .env, hiệu lực ngay. */
export const setTunnelDomain = (domain: string | null) =>
  jsonBody<TunnelStatus>("/api/tunnel/domain", "PUT", { domain });

/**
 * Bật tunnel - 409 NOT_INSTALLED nếu chưa cài cloudflared, 409 nếu đang chạy.
 * `auto` = bật từ modal QR: server đánh dấu để tự tắt khi đóng modal / hết phiên upload.
 */
export const startTunnel = (auto = false) =>
  post<{ mode: "named" | "quick"; auto: boolean }>("/api/tunnel/start", { auto });

/**
 * Tắt tunnel (kill cả cây cloudflared) → 204.
 * `onlyAuto` = chỉ tắt nếu tunnel do modal QR bật - tránh tắt nhầm tunnel người
 * dùng tự bật ở trang Kết nối để vào dashboard từ xa.
 */
export const stopTunnel = (onlyAuto = false) =>
  post<void>("/api/tunnel/stop", { onlyAuto });

/**
 * Dọn dẹp lúc TAB BỊ ĐÓNG ĐỘT NGỘT: thu hồi token upload + tắt tunnel của modal.
 *
 * Không dùng được hàm request() ở đây - fetch thường bị hủy ngay khi trang chết.
 * `keepalive` bảo trình duyệt cứ gửi nốt. sendBeacon không dùng được vì cần
 * method DELETE và header token.
 */
export function closePhoneSessionOnUnload(uploadToken: string | null, stopAuto: boolean): void {
  // Token đã nạp sẵn từ trước (modal chỉ mở được khi dashboard đã xác thực) -
  // lúc trang đang chết thì không kịp await ensureToken()
  const token = apiToken;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["x-aiev-token"] = token;
  if (uploadToken) {
    void fetch(`/api/upload-session/${encodeURIComponent(uploadToken)}`, {
      method: "DELETE",
      headers,
      keepalive: true,
    }).catch(() => {});
  }
  if (stopAuto) {
    void fetch("/api/tunnel/stop", {
      method: "POST",
      headers,
      body: JSON.stringify({ onlyAuto: true }),
      keepalive: true,
    }).catch(() => {});
  }
}

// ============ Media helper ============

/**
 * Mở file trong Explorer/Finder trên máy chạy server (chọn đúng file).
 * relPath tính từ repo root - whitelist thư mục như /media, 404 nếu không tồn tại.
 */
export const revealFile = (relPath: string) =>
  post<void>("/api/reveal", { relPath });

/**
 * Đường dẫn phát file qua backend, relPath tính từ repo root. Phòng thủ với dữ
 * liệu lệch kiểu (AI ghi meta sai hợp đồng).
 * Xác thực: dashboard đi bằng cookie `aiev_token` (ensureToken đã set trước khi
 * dữ liệu về); trang /m trên điện thoại gắn thêm `?k=` của phiên QR.
 */
export const mediaUrl = (relPath: string) =>
  withUploadToken(
    `/media/${String(relPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "")}`
  );

/**
 * URL ảnh của image project - meta lưu TÊN FILE trần (background.png/final.png),
 * phải ghép image-projects/<id>/ vào trước khi qua /media.
 * `version` (updatedAt) để cache-bust: file trùng tên khi tạo lại, không có ?v
 * trình duyệt sẽ hiện ảnh CŨ trong cache.
 */
export const imageFileUrl = (projectId: string, file: string, version?: string | number) =>
  mediaUrl(`image-projects/${projectId}/${file}`) +
  (version !== undefined ? `?v=${encodeURIComponent(String(version))}` : "");

// ================= QC tự động + Gói xuất bản =================

/**
 * Cổng QC trong render settings. Khai báo bằng declaration merging (TypeScript
 * gộp interface trùng tên trong cùng module) để phần QC tự gói gọn ở đây, không
 * phải sửa khối RenderSettings phía trên.
 */
export interface RenderSettings {
  /** true (mặc định) = job assemble-final bị chặn khi report QC còn "fail". */
  qcGate: boolean;
}

/** Kết cục một phép đo QC: đạt / cảnh báo / không đạt. */
export type QcStatus = "pass" | "warn" | "fail";

/** Nền tảng dùng để chọn vùng an toàn (chữ không bị UI app che). */
export type QcPlatform = "tiktok" | "youtube" | "reels";

export interface QcCheck {
  id: string;
  label: string;
  status: QcStatus;
  detail: string;
  /** Số đo chính của check (LUFS, số frame đen…) - null khi không đo được. */
  value?: number | null;
  /**
   * Ảnh bằng chứng (relPath repo, xem qua mediaUrl). Check `safe-area` dùng:
   * máy không phân biệt được chữ với cảnh quay nên trả ảnh khoanh đỏ vùng bị
   * UI che để người dùng tự soi.
   */
  frames?: string[];
}

export interface QcReport {
  checkedAt: string;
  /** relPath từ repo root của file đã đo. */
  file: string;
  /** mtime file lúc đo - server so với mtime hiện tại để biết report cũ. */
  fileMtime: string;
  platform: string;
  status: QcStatus;
  checks: QcCheck[];
}

/** GET /api/projects/:id/qc - stale=true khi file đã render lại sau lần đo. */
export interface QcReportResponse {
  report: QcReport | null;
  stale?: boolean;
}

export const getQcReport = (projectId: string) =>
  request<QcReportResponse>(`/api/projects/${encodeURIComponent(projectId)}/qc`);

/**
 * POST chạy QC - ĐỒNG BỘ, ffmpeg đo cả video nên có thể mất vài chục giây tới
 * ~2 phút (server tự cắt ở 10 phút). Đi qua rewrite /api của Next vì
 * next.config đã nâng proxyTimeout lên 10 phút - đủ cho lượt đo dài nhất.
 * Lỗi: 400 NO_VIDEO, 404 FILE_NOT_FOUND, 504 QC_TIMEOUT.
 */
export const runProjectQc = (
  projectId: string,
  input?: { file?: string; platform?: QcPlatform }
) =>
  post<{ report: QcReport }>(
    `/api/projects/${encodeURIComponent(projectId)}/qc`,
    input ?? {}
  );

/** Nền tảng có metadata đăng bài trong gói xuất bản. */
export type PublishPlatform = "tiktok" | "youtube" | "facebook";

export interface PublishItem {
  platform: PublishPlatform;
  title: string;
  /** Có thể nhiều dòng (mô tả YouTube kèm danh sách chương) - giữ nguyên xuống dòng. */
  description: string;
  hashtags: string[];
}

export interface PublishPack {
  generatedAt: string;
  /** File transcript đã dùng làm nguồn (relPath repo). */
  transcriptRel: string;
  items: PublishItem[];
  /** relPath repo của file phụ đề đã ghi vào video-projects/<id>/publish/. */
  subtitles: { srt: string; vtt: string };
  thumbnail: string | null;
  output: string | null;
}

export const getPublishPack = (projectId: string) =>
  request<{ pack: PublishPack | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/publish`
  );

/**
 * POST soạn gói xuất bản - AI đọc transcript + Style Design, chạy tới ~3 phút.
 * platforms bỏ trống = cả 3 nền tảng. Lỗi: 404 NO_TRANSCRIPT, 502 PUBLISH_PARSE_FAILED.
 */
export const createPublishPack = (
  projectId: string,
  platforms?: PublishPlatform[]
) =>
  post<{ pack: PublishPack }>(
    `/api/projects/${encodeURIComponent(projectId)}/publish`,
    platforms && platforms.length ? { platforms } : {}
  );

/** POST ghi lại .srt/.vtt vào publish/ - trả số cue để UI hiển thị. */
export const createSubtitles = (projectId: string) =>
  post<{ srt: string; vtt: string; cues: number }>(
    `/api/projects/${encodeURIComponent(projectId)}/subtitles`
  );

/**
 * Link TẢI phụ đề - dùng cho <a download>, không qua fetch nên không set được
 * header token: dashboard đi bằng cookie `aiev_token` (ensureToken đã set),
 * trang /m gắn thêm `?k=` giống mediaUrl.
 * `version` để trình duyệt không trả file .srt cũ trong cache sau khi soạn lại.
 */
export const subtitleDownloadUrl = (
  projectId: string,
  format: "srt" | "vtt",
  version?: string
) =>
  withUploadToken(
    `/api/projects/${encodeURIComponent(projectId)}/subtitles?format=${format}` +
      (version ? `&v=${encodeURIComponent(version)}` : "")
  );

// ================= Duyệt draft + Cắt short + Tái chế tỉ lệ =================

/** open = chưa gửi, sent = đã gửi cho AI, resolved = người duyệt đã xác nhận xong. */
export type ReviewNoteStatus = "open" | "sent" | "resolved";

/** Một ghi chú duyệt draft - ghim vào đúng giây trong video. */
export interface ReviewNote {
  id: string;
  /** Mốc thời gian trong video (giây, server làm tròn 2 chữ số). */
  atSec: number;
  text: string;
  status: ReviewNoteStatus;
  createdAt: string;
  /** Chỉ có khi ghi chú đã được gửi cho AI. */
  sentAt?: string;
}

/** Tối đa 500 ký tự - PHẢI khớp MAX_TEXT_LEN của server (routes/review.ts). */
export const REVIEW_TEXT_MAX = 500;

/** Danh sách ghi chú - server đã sắp theo atSec tăng dần. */
export const getReviewNotes = (projectId: string) =>
  request<{ notes: ReviewNote[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/review`
  );

export const addReviewNote = (projectId: string, atSec: number, text: string) =>
  post<{ note: ReviewNote }>(
    `/api/projects/${encodeURIComponent(projectId)}/review`,
    { atSec, text }
  );

/** PATCH partial - field không gửi thì server giữ nguyên. */
export const updateReviewNote = (
  projectId: string,
  noteId: string,
  patch: { text?: string; status?: ReviewNoteStatus }
) =>
  jsonBody<{ note: ReviewNote }>(
    `/api/projects/${encodeURIComponent(projectId)}/review/${encodeURIComponent(noteId)}`,
    "PATCH",
    patch
  );

export const deleteReviewNote = (projectId: string, noteId: string) =>
  request<void>(
    `/api/projects/${encodeURIComponent(projectId)}/review/${encodeURIComponent(noteId)}`,
    { method: "DELETE" }
  );

/**
 * Gửi mọi ghi chú đang "open" cho AI sửa (202 + sessionId của phiên đang dùng lại).
 * Lỗi: 400 NO_OPEN_NOTES, 409 SESSION_BUSY (phiên AI của project đang chạy).
 */
export const sendReviewNotes = (projectId: string, extraNotes?: string) =>
  post<{ sessionId: string; sentCount: number }>(
    `/api/projects/${encodeURIComponent(projectId)}/review/send`,
    extraNotes && extraNotes.trim() ? { extraNotes: extraNotes.trim() } : {}
  );

/** Một đoạn AI gợi ý cắt thành short - start/end là giây tuyệt đối trong video nguồn. */
export interface Clip {
  start: number;
  end: number;
  title: string;
  /** Câu mở đầu, AI copy nguyên văn từ transcript. */
  hook: string;
  reason: string;
  /** 1-10, càng cao càng đáng cắt. */
  score: number;
}

export interface ClipsResponse {
  clips: Clip[];
  /** null = chưa gợi ý lần nào. */
  suggestedAt: string | null;
  sourceDurationSec?: number;
}

export const getClips = (projectId: string) =>
  request<ClipsResponse>(`/api/projects/${encodeURIComponent(projectId)}/clips`);

/**
 * AI đọc transcript rồi chọn đoạn hay - chạy 1-3 phút (proxy Next đã nới
 * timeout 10 phút nên đi đường /api bình thường là đủ).
 * Lỗi: 404 NO_TRANSCRIPT, 502 CLIPS_PARSE_FAILED.
 */
export const suggestClips = (
  projectId: string,
  input?: { count?: number; minSec?: number; maxSec?: number }
) =>
  post<{ clips: Clip[]; suggestedAt: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/clips/suggest`,
    input ?? {}
  );

/** Project con vừa tạo - sessionId null = chưa mở phiên edit AI. */
export interface CreatedClipProject {
  id: string;
  name: string;
  sessionId: string | null;
}

/**
 * Tạo project con từ các clip đã chọn (indexes tính theo mảng clips).
 * autoEdit chỉ chạy edit ngay cho tối đa 3 project - phần còn lại server ghi vào `note`.
 */
export const createClipProjects = (
  projectId: string,
  input: {
    indexes: number[];
    width?: number;
    height?: number;
    autoEdit?: boolean;
  }
) =>
  post<{ created: CreatedClipProject[]; note?: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/clips/create`,
    input
  );

/** Tỉ lệ khung hỗ trợ khi tái chế - khớp bảng ASPECTS của server. */
export type RepurposeAspect = "9:16" | "16:9" | "1:1" | "4:5";

/** Kích thước tương ứng từng tỉ lệ - PHẢI khớp server (routes/clips.ts). */
export const REPURPOSE_SIZES: Record<
  RepurposeAspect,
  { width: number; height: number }
> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

/**
 * Tạo bản tái chế sang tỉ lệ khác - project con mang toàn bộ scene + asset của cha.
 * Lỗi: 400 SAME_ASPECT ("Project đã ở tỉ lệ này").
 */
export const repurposeProject = (
  projectId: string,
  input: { aspect: RepurposeAspect; name?: string; autoEdit?: boolean }
) =>
  post<{ project: ProjectSummary; sessionId: string | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/repurpose`,
    input
  );

// ============ Auto cut videos ============
// Cắt một video dài thành nhiều video ngắn - mỗi đoạn tự thành một Videos
// Project dựng sẵn. Hợp đồng: mục "Auto cut videos" trong docs/API.md.

export type AutoCutStatus =
  | "draft"
  | "planning"
  | "planned"
  | "cutting"
  | "done"
  | "failed";

/** time = chia đều theo phút; ai = AI chọn đoạn hay; prompt = cắt theo yêu cầu. */
export type AutoCutMode = "time" | "ai" | "prompt";

export type AutoCutAspect = "keep" | "9:16" | "16:9" | "1:1" | "4:5";

/** auto = hệ thống tự nhìn khung để chọn crop hay fit. */
export type AutoCutLayout = "auto" | "crop" | "fit";

export type AutoCutBackground = "gemini" | "blur" | "style";

export interface AutoCutSource {
  relPath: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  /** Metadata xoay của file gốc (điện thoại quay dọc) - 0/90/180/270. */
  rotation: number;
}

export interface AutoCutParams {
  /** mode "time": số phút mỗi đoạn. */
  minutes?: number;
  /** mode "time": số giây chồng lấn giữa hai đoạn liền nhau. */
  overlapSec?: number;
  /** mode "ai" | "prompt": số đoạn mong muốn + khoảng độ dài. */
  count?: number;
  minSec?: number;
  maxSec?: number;
  /** mode "prompt": yêu cầu bằng lời của người dùng. */
  request?: string;
}

export interface AutoCutOutput {
  aspect: AutoCutAspect;
  layout: AutoCutLayout;
  background: AutoCutBackground;
  /** null = dùng style mặc định. */
  styleId: string | null;
  /** null = giữ fps nguồn. */
  fps: number | null;
}

export interface AutoCutSegment {
  index: number;
  /** Giây tuyệt đối trong video nguồn. */
  start: number;
  end: number;
  title: string;
  hook?: string;
  reason?: string;
  /** 1-10 - chỉ có ở mode ai/prompt. */
  score?: number;
  selected: boolean;
  /** Có sau bước cut - id Videos Project con đã tạo. */
  projectId?: string;
  /** Layout thực tế đã áp khi đổi khung (mode auto quyết định lúc chạy). */
  appliedLayout?: "crop" | "fit";
}

export interface AutoCutMeta {
  id: string;
  name: string;
  status: AutoCutStatus;
  source: AutoCutSource;
  mode: AutoCutMode;
  params: AutoCutParams;
  output: AutoCutOutput;
  transcribe: boolean;
  autoEdit: boolean;
  /** Kịch bản edit áp cho MỌI project con cắt ra - cấu hình một lần cho cả phiên. */
  brief: Brief;
  transcriptRel?: string | null;
  segments: AutoCutSegment[];
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Patch một đoạn - chỉ gửi field người dùng vừa sửa. */
export interface AutoCutSegmentPatch {
  index: number;
  start?: number;
  end?: number;
  title?: string;
  selected?: boolean;
}

/** Kích thước tương ứng từng tỉ lệ ("keep" giữ nguyên khung nguồn nên không có). */
export const AUTO_CUT_SIZES: Record<
  Exclude<AutoCutAspect, "keep">,
  { width: number; height: number }
> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

/** Giá trị mặc định của form tạo phiên - khớp mặc định server. */
export const AUTO_CUT_DEFAULT_PARAMS = {
  minutes: 5,
  overlapSec: 0,
  count: 5,
  minSec: 20,
  maxSec: 60,
} as const;

/**
 * Job của phiên cắt: `type` = "auto-cut", `projectId` = id phiên, `sceneId` = bước.
 * JobType hiện chưa liệt kê "auto-cut" (backend đang bổ sung song song) nên so
 * sánh qua string để không phải sửa phần đầu file.
 */
export type AutoCutStep = "plan" | "cut";

export function isAutoCutJob(job: Job, sessionId?: string): boolean {
  if ((job.type as string) !== "auto-cut") return false;
  return sessionId === undefined || job.projectId === sessionId;
}

/** Video trong imports/ - nguồn cho phiên cắt. */
export const getAutoCutSources = () =>
  request<{ files: FileInfo[] }>("/api/auto-cut/sources").then(
    (r) => r.files ?? []
  );

export const getAutoCutSessions = () =>
  request<{ sessions: AutoCutMeta[] }>("/api/auto-cut").then(
    (r) => r.sessions ?? []
  );

export const getAutoCutSession = (id: string) =>
  request<{ session: AutoCutMeta }>(
    `/api/auto-cut/${encodeURIComponent(id)}`
  ).then((r) => r.session);

export const createAutoCut = (input: {
  /** Bỏ trống → server đặt theo tên file nguồn. */
  name?: string;
  sourceRel: string;
  mode: AutoCutMode;
  params?: AutoCutParams;
  output?: Partial<AutoCutOutput>;
  transcribe?: boolean;
  autoEdit?: boolean;
  /** styleId trong brief bị server bỏ qua - style của phiên lấy từ output.styleId. */
  brief?: Partial<Brief>;
}) => post<{ session: AutoCutMeta }>("/api/auto-cut", input).then((r) => r.session);

/** PATCH partial - field không gửi thì server giữ nguyên. */
export const updateAutoCut = (
  id: string,
  patch: {
    name?: string;
    params?: AutoCutParams;
    output?: Partial<AutoCutOutput>;
    transcribe?: boolean;
    autoEdit?: boolean;
    /** Sửa brief KHÔNG reset danh sách đoạn - gửi được cả khi phiên đã planned. */
    brief?: Partial<Brief>;
    segments?: AutoCutSegmentPatch[];
  }
) =>
  jsonBody<{ session: AutoCutMeta }>(
    `/api/auto-cut/${encodeURIComponent(id)}`,
    "PATCH",
    patch
  ).then((r) => r.session);

/** 202 - transcribe + chọn đoạn. Lỗi: 409 BUSY, 400 REQUEST_REQUIRED. */
export const planAutoCut = (id: string) =>
  post<{ job: Job }>(`/api/auto-cut/${encodeURIComponent(id)}/plan`).then(
    (r) => r.job
  );

/** 202 - cắt + đổi khung + đẻ project con. Lỗi: 409 NOT_PLANNED, 400 NO_SEGMENT_SELECTED. */
export const cutAutoCut = (id: string) =>
  post<{ job: Job }>(`/api/auto-cut/${encodeURIComponent(id)}/cut`).then(
    (r) => r.job
  );

/** Xóa phiên cắt - KHÔNG động tới các Videos Project đã tạo ra từ phiên. */
export const deleteAutoCut = (id: string, force = true) =>
  request<void>(
    `/api/auto-cut/${encodeURIComponent(id)}${force ? "?force=true" : ""}`,
    { method: "DELETE" }
  );

// ================= Đồng hồ CPU/GPU realtime trên header =================
export interface Metrics {
  cpu: { percent: number; threads: number; model: string };
  gpu: {
    available: boolean;
    name: string | null;
    percent: number | null;
    vramUsedMb: number | null;
    vramTotalMb: number | null;
  };
}

/** Mức dùng CPU/GPU hiện tại - server tự cache 1,5s nên poll 2s là an toàn. */
export const getMetrics = () => request<Metrics>("/api/metrics");

// ================= Kiểm tra môi trường (start/doctor.mjs) =================

export type DoctorLevel = "required" | "optional" | "info";

export interface DoctorFix {
  /** true = bấm nút là cài được, không cần gõ lệnh */
  auto: boolean;
  size?: string;
  manual?: string;
  /**
   * Lệnh chép-dán-chạy được. Chỉ có ở mục mà cách sửa THỰC SỰ là một dòng lệnh -
   * mục kiểu "dán API key ở trang Kết nối" thì không, để khỏi hiện nút chép vô nghĩa.
   */
  command?: string;
  /** Trang trong dashboard làm được việc này (vd /connections) */
  link?: string;
  url?: string;
}

export interface DoctorCheck {
  id: string;
  /** Tên riêng (FFmpeg, Google Chrome...) - KHÔNG dịch */
  label: string;
  level: DoctorLevel;
  status: "ok" | "missing";
  /** Version/đường dẫn máy dò được - KHÔNG dịch */
  detail: string;
  /** Mã ghi chú, dịch bằng key "doctor.note.<note>" */
  note?: string | null;
  fix: DoctorFix | null;
}

export interface DoctorReport {
  platform: string;
  ok: boolean;
  missingRequired: string[];
  checks: DoctorCheck[];
}

export interface DoctorFixResult {
  ok: boolean;
  installed: boolean;
  timedOut: boolean;
  log: string[];
  report: DoctorReport;
}

/** Dò môi trường - server cache 20s; refresh=true để ép dò lại. */
export const getDoctor = (refresh = false) =>
  request<DoctorReport>(`/api/doctor${refresh ? "?refresh=1" : ""}`);

/** Cài một mục còn thiếu. Chỉ chạy được với mục có fix.auto = true. */
export const fixDoctor = (id: string) =>
  post<DoctorFixResult>("/api/doctor/fix", { id });
