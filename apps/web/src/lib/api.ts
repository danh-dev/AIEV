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

/** Token + chi phí gộp — /api/usage/summary. */
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

/** Một ngày trong timeline token — /api/usage/timeline. */
export interface UsageTimelinePoint {
  /** yyyy-mm-dd */
  date: string;
  tokens: number;
  /** Token input (prompt) trong ngày. */
  tokensIn: number;
  /** Token output (completion) trong ngày. */
  tokensOut: number;
  costUsd: number;
  /** Token phân theo AI ("claude" | "gemini" | "openai") — vẽ đường theo provider. */
  byProvider: Record<string, number>;
}

export interface FileInfo {
  name: string;
  relPath: string;
  size: number;
  mtime: string;
  kind: "video" | "audio" | "image" | "other";
  /** Mô tả asset (assets.json của project) — cho AI biết dùng file vào lúc nào. */
  description?: string;
  /** Preset chỉnh màu đã lưu cho video (id preset — nhãn lấy từ getGradePresets). */
  colorGrade?: string;
  /** Thông số chỉnh tay cộng chồng lên preset — chỉ có khi khác mặc định. */
  colorAdjust?: Record<string, number>;
}

/**
 * Nhãn fallback của vài preset cũ — CHỈ dùng khi chưa fetch được danh sách.
 * Nguồn nhãn chính thức: GET /api/grade-presets (getGradePresets).
 */
export const GRADE_LABELS: Record<string, string> = {
  "tu-nhien": "Tự nhiên",
  cinematic: "Cinematic",
  "tuoi-sang": "Tươi sáng",
  am: "Ấm",
  lanh: "Lạnh",
};

/** Một preset màu server hỗ trợ — nguồn nhãn duy nhất cho UI. */
export interface GradePresetInfo {
  id: string;
  label: string;
}

// Cache module-level — danh sách preset tĩnh trong một phiên chạy server.
let gradePresetsCache: GradePresetInfo[] | null = null;

/** Danh sách preset màu (id + nhãn tiếng Việt) — cache sau lần gọi đầu. */
export async function getGradePresets(): Promise<GradePresetInfo[]> {
  if (gradePresetsCache) return gradePresetsCache;
  const list = await request<GradePresetInfo[]>("/api/grade-presets");
  gradePresetsCache = list;
  return list;
}

/** Thông số chỉnh màu tay — cộng CHỒNG lên preset (khớp GradeAdjust của server). */
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

/** Thông tin màu của footage — kèm kết quả grade-preview. */
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

/** Kịch bản edit của project — AI đọc phần này khi bắt đầu edit. */
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
  /** Key chính do user chỉ định — "" = AI tự phân tích chọn. */
  mainKey: string;
  /** Key liên quan user chỉ định (AI bắt buộc dùng đủ) — [] = AI tự chọn 3–6 key. */
  relatedKeys: string[];
  skill: string | null;
  sfxMode: SfxMode;
  /** "auto" (mặc định) = AI tự chọn nhạc nền theo mood, "none" = không dùng. */
  musicMode: MusicMode;
  notes: string;
  /** BẬT = Claude chọn ý chính, Gemini vẽ ảnh minh họa rồi ghép vào video. */
  autoIllustrations: boolean;
  /** Model Gemini vẽ minh họa — null = mặc định của server (Nano Banana 2). */
  illustrationModel: string | null;
  /** BẬT = Gemini được vẽ chữ vào ảnh minh họa (mặc định TẮT — chữ do hệ thống đặt). */
  illustrationText: boolean;
  /** Style Design sản phẩm phải tuân theo — null = style mặc định. */
  styleId: string | null;
}

/** Prompt mẫu tái sử dụng — đổ vào ô "Yêu cầu edit" của brief. */
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
  /** "thumbnail.png" nếu video-projects/<id>/thumbnail.png tồn tại — null = chưa tạo. */
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

/** Một bài nhạc nền trong thư viện assets/music/ — tags = mood. */
export interface MusicEntry {
  file: string;
  tags: string[];
  durationMs: number | null;
  description: string;
}

/** Trạng thái phiên AI — bền vững trong DB, đọc lại được sau khi tắt UI. */
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
  /** ISO — lúc lượt chạy hiện tại BẮT ĐẦU (không reset khi auto-resume). */
  runStartedAt: string | null;
  /** ISO — lúc lượt chạy kết thúc hẳn; null khi đang chạy. */
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
  /** Kèm theo event kind "done" — kết cục của phiên. */
  status?: "done" | "error" | "interrupted";
}

export interface JobLogEvent {
  jobId: string;
  line: string;
}

/** Event SSE kênh "upload" — tiến trình server nhận file qua POST /api/assets. */
export interface UploadEvent {
  id: string;
  /** Có khi scope=project — dùng để lọc theo trang project đang mở. */
  projectId?: string;
  received?: number;
  /** 0 = không biết tổng (thiếu content-length) → hiện progress vô định. */
  total?: number;
  done: boolean;
  error?: boolean;
  /** Tên file đã lưu — đi kèm event done thành công. */
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

/** Trạng thái API key của một provider — key đọc từ .env, đổi được qua UI. */
export interface ConnectionKeyInfo {
  /** Tên biến môi trường chứa key (vd ANTHROPIC_API_KEY). */
  envVar: string;
  present: boolean;
  /** Key đã che bớt (vd sk-ant-…abcd) — null khi chưa có key. */
  masked: string | null;
}

/** Một provider trên trang Kết nối — GET /api/connections. */
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
 * Cài đặt tăng tốc render — server đọc mỗi lần job chạy / queue tick,
 * nên PUT là có hiệu lực ngay, không cần restart.
 */
export interface RenderSettings {
  /** Số worker Chrome của HyperFrames (0 = auto, 0-12). */
  workers: number;
  /** Chrome dùng GPU khi capture (browser rendering). */
  browserGpu: boolean;
  /** Encode GPU (NVENC/VideoToolbox) cho bản draft. */
  gpuEncodeDraft: boolean;
  /** Encode GPU cho bản FINAL — nhanh nhưng chất lượng nhỉnh kém libx264. */
  gpuEncodeFinal: boolean;
  /** Fast capture — chỉ thực sự hoạt động trên macOS + GPU, nơi khác fallback vô hại. */
  fastCapture: boolean;
  /** Concurrency render của Remotion (0 = auto; trần = số luồng CPU của máy). */
  remotionConcurrency: number;
  /** Số job render chạy đồng thời trong queue (1-4). */
  queueConcurrency: number;
  /** FPS cho bản draft — null = giữ nguyên fps project; 15 = draft nhanh. */
  draftFps: number | null;
}

/** Phần cứng máy backend phát hiện được — GET /api/render-settings. */
export interface HardwareInfo {
  /** process.platform của server: win32 | darwin | linux… */
  platform: string;
  cores: number;
  ramGb: number;
  /** Tên GPU — null khi không phát hiện được. */
  gpuName: string | null;
  /** Có encoder NVENC (GPU NVIDIA). */
  nvenc: boolean;
  /** Có encoder VideoToolbox (macOS). */
  videotoolbox: boolean;
  /** Tên đầy đủ CPU, vd "Intel Core i5-9400F CPU @ 2.90GHz". */
  cpuModel: string;
  /** Số core vật lý — null nếu không tra được (hiển thị rơi về threads). */
  cpuCores: number | null;
  /** Số luồng logic. */
  cpuThreads: number;
  /** Xung tối đa (GHz) — null nếu không tra được. */
  cpuMaxGhz: number | null;
  /** Loại RAM: DDR4 | DDR5 | Unified Memory… — null nếu không tra được. */
  ramType: string | null;
  /** Bus RAM (MHz). */
  ramSpeedMhz: number | null;
  /** VRAM (GB) — hiện chỉ có với GPU NVIDIA. */
  gpuVramGb: number | null;
}

/** Khuyến nghị theo máy thật — UI dựng option worker/concurrency từ đây. */
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

/** PUT partial — hiệu lực NGAY (job đọc mỗi lần chạy), không cần restart. */
export const updateRenderSettings = (patch: Partial<RenderSettings>) =>
  jsonBody<{ settings: RenderSettings }>("/api/render-settings", "PUT", patch);

// ============ Style Design (bộ nhận diện thương hiệu — nhiều style) ============

/** Màu BRAND trong một style (DATA của user) — không phải token màu UI. */
export interface StyleColors {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  accent: string;
}

/** Slot font của style — heading (tiêu đề) | body (nội dung). */
export type StyleFontSlot = "heading" | "body";

/** Hiệu ứng thị giác của style — bật/tắt được từng cái (default true/true). */
export interface StyleEffects {
  /** Chữ highlight + bề mặt dùng chuyển màu primary→secondary. */
  gradient: boolean;
  /** Chất liệu kính mờ: chip số liệu, phần tử 3D trong ảnh nền. */
  liquidGlass: boolean;
}

/** Một bộ nhận diện (Style Design) — lưu tại assets/styles/styles.json. */
export interface StyleDesign {
  id: string;
  name: string;
  tags: string[];
  colors: StyleColors;
  fonts: { heading: string; body: string };
  /** File font đã upload (relPath, phát qua /media) — null = font hệ thống. */
  fontFiles: { heading: string | null; body: string | null };
  /** relPath logo — phát qua /media. */
  logoPath: string | null;
  /** Hiệu ứng thị giác (gradient / liquid glass) — style cũ có thể thiếu. */
  effects?: StyleEffects;
  tone: string;
  guidelines: string;
  createdAt: string;
  updatedAt: string;
}

/** Kết quả GET /api/styles — danh sách style + style mặc định. */
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

/** Chữ trên ảnh — Remotion đặt theo Design System, KHÔNG nằm trong ảnh Gemini. */
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
  /** Model Gemini tạo ảnh nền — null = model mặc định của server. */
  model: string | null;
  /** Style Design ảnh phải tuân theo — null = style mặc định. */
  styleId: string | null;
  /** relPath ảnh nền (Gemini tạo hoặc upload tay) — phát qua /media. */
  background: string | null;
  /** relPath ảnh hoàn thiện (Remotion compose) — phát qua /media. */
  final: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ImageGenStep = "all" | "background" | "compose";

// ============ Error & core ============

/**
 * Origin của backend — dùng cho upload file lớn: gọi THẲNG server (CORS đã mở),
 * không qua rewrite proxy của Next (proxy có timeout ~30s, file video lớn sẽ chết).
 */
export function serverOrigin(): string {
  if (typeof window === "undefined") return "http://localhost:6869";
  const port = process.env.NEXT_PUBLIC_SERVER_PORT || "6869";
  return `http://${window.location.hostname}:${port}`;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
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
      // body không phải JSON — giữ message mặc định
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

export interface UpdateStatus {
  /** Short hash HEAD hiện tại ("" nếu server check lỗi). */
  current: string;
  /** Số commit đang thua origin/main. */
  behind: number;
  upToDate: boolean;
  latestMessage: string | null;
  checkedAt: string;
  /** false khi `git fetch origin` thất bại — behind tính theo refs cũ. */
  fetchOk?: boolean;
  /** Lỗi ngắn khi check thất bại (offline…) — server không bao giờ 500. */
  error?: string;
}

export const checkUpdate = (force = false) =>
  request<UpdateStatus>(`/api/update/check${force ? "?force=1" : ""}`);

/** 202 khi đã spawn script update; 409 JOB_RUNNING khi đang có job render. */
export const applyUpdate = () => post<{ ok: true }>("/api/update/apply");

// ============ Usage (token AI) ============

export const getUsageSummary = () =>
  request<UsageSummary>("/api/usage/summary");

/** Timeline token theo ngày — scope lọc theo loại project (bỏ qua = all). */
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
 * POST nhân bản project — server copy compositions/assets (kèm mô tả)/brief/tags/scenes,
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

/** PUT brief (partial được — server merge). */
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
 * POST tạo thumbnail cho video project — chạy ĐỒNG BỘ (~1 phút: ffmpeg cắt
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

/** Một mục file rác — relPath từ repo root, thư mục kết thúc bằng "/". */
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
 * POST xóa file rác của project — renders/verify/cache, props.resolved.json,
 * draft lắp ráp và staging Remotion. File nguồn + video final giữ nguyên.
 * Project đang có job chạy/chờ → lỗi 409 JOB_RUNNING.
 */
export const cleanProjectJunk = (id: string) =>
  post<{ freedBytes: number; deleted: number }>(
    `/api/projects/${encodeURIComponent(id)}/junk/clean`
  );

/** DELETE một asset của project — xóa file + entry mô tả/màu trong assets.json. */
export const deleteProjectAsset = (projectId: string, file: string) =>
  request<void>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(file)}`,
    { method: "DELETE" }
  );

/**
 * Sinh ảnh preview các preset màu cho một video của project.
 * POST (dù là "get") vì server phải render 6 ảnh — mất vài giây.
 */
export const getGradePreviews = (projectId: string, file: string) =>
  post<GradePreviewResult>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(file)}/grade-preview`
  );

/**
 * Render MỘT frame chính xác theo preset + thông số chỉnh tay — phục vụ preview
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
 * PUT preset chỉnh màu cho asset video — preset null = bỏ chỉnh màu.
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
 * Bắt đầu edit bằng AI — server tự soạn prompt từ brief + assets, trả sessionId chat.
 * model/effort (tùy chọn) lưu vào session — mọi lượt chạy sau dùng đúng model đó.
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

/** Body POST /api/skills/generate — mọi field trừ goal đều optional. */
export interface SkillGenerateInput {
  /** Mục đích & loại video — BẮT BUỘC. */
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
  /** Tên skill có sẵn làm mẫu — server nhúng nội dung vào prompt. */
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
 * trả về — UI đưa cho user tự sửa tay rồi lưu.
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
 * POST /api/skills/generate — Claude soạn draft SKILL.md (KHÔNG ghi file).
 * Gọi THẲNG server origin (như upload) vì có thể chạy 1–3 phút — proxy Next
 * có timeout sẽ cắt ngang. Lỗi ném SkillGenerateError (422 kèm raw).
 */
export async function generateSkill(
  input: SkillGenerateInput
): Promise<SkillGenerateResult> {
  let res: Response;
  try {
    res = await fetch(`${serverOrigin()}/api/skills/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      // body không phải JSON — giữ message mặc định
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

/** PATCH sound effect — recommended=true/false thêm/gỡ tag "hay-dung". */
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
  // scope/projectId TRƯỚC file — server đọc projectId từ đầu stream để phát
  // SSE `upload` progress lọc được theo project
  form.append("scope", scope);
  if (projectId) form.append("projectId", projectId);
  form.append("file", file);
  return request<FileInfo>(`${serverOrigin()}/api/assets`, { method: "POST", body: form });
};

// ============ Chat ============

/** Danh sách phiên chat — truyền projectId để chỉ lấy phiên của project đó. */
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
 * Gửi tin nhắn — projectId chỉ dùng khi tạo session mới (gắn session vào project).
 * model/effort cũng chỉ có tác dụng lúc tạo session mới — lưu vào session.
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
 * Danh sách model ảnh Gemini MỚI NHẤT — KHÔNG cache phía client (server đã cache 1h)
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
 * Danh sách model Claude MỚI NHẤT — server cache 10 phút; chưa fetch xong
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

/** Gọi thử API thật của provider — kiểm tra kết nối. */
export const testConnection = (provider: string) =>
  post<{ ok: boolean; message: string }>(
    `/api/connections/${encodeURIComponent(provider)}/test`
  );

// ============ Style Design ============

export const getStyles = () => request<StylesResponse>("/api/styles");

/** Tạo style mới — cloneFrom = id style muốn sao chép toàn bộ (bỏ qua = trống). */
export const createStyle = (input: {
  name: string;
  tags?: string[];
  cloneFrom?: string;
}) => post<StyleDesign>("/api/styles", input);

/** PUT partial (name/tags/colors/fonts/effects/tone/guidelines) — server merge. */
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

/** Xóa style — server cấm xóa style cuối cùng (400). */
export const deleteStyle = (id: string) =>
  request<void>(`/api/styles/${encodeURIComponent(id)}`, { method: "DELETE" });

export const setDefaultStyle = (id: string) =>
  post<{ defaultId: string }>(
    `/api/styles/${encodeURIComponent(id)}/default`
  );

/** Upload logo cho style (multipart) — gọi thẳng server như uploadAsset. */
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

/** Gỡ font một slot của style — quay về font hệ thống. */
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
  /** Model Gemini tạo nền — bỏ qua = server dùng mặc định. */
  model?: string | null;
  /** Style Design áp cho ảnh — bỏ qua/null = style mặc định. */
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
 * POST xóa file rác của image project — props.json và staging Remotion img-<id>.
 * Ảnh nền, final.png và meta giữ nguyên. Project đang có job chạy/chờ → 409 JOB_RUNNING.
 */
export const cleanImageJunk = (id: string) =>
  post<{ freedBytes: number; deleted: number }>(
    `/api/images/${encodeURIComponent(id)}/junk/clean`
  );

/** Upload ảnh nền thủ công (multipart) — thay cho bước Gemini. */
export const uploadImageBackground = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return request<ImageProject>(
    `${serverOrigin()}/api/images/${encodeURIComponent(id)}/background`,
    { method: "POST", body: form }
  );
};

/** Chạy pipeline tạo ảnh — trả Job (queue type "image-gen", projectId = id ảnh). */
export const generateImage = (id: string, step?: ImageGenStep) =>
  post<Job>(
    `/api/images/${encodeURIComponent(id)}/generate`,
    step ? { step } : {}
  );

// ============ Kết nối điện thoại (LAN) ============

/** GET /api/lan-info — IP LAN của máy chạy server + port web, cho QR "Kết nối điện thoại". */
export interface LanInfo {
  /** IPv4 non-internal, đã ưu tiên dải 192.168/10. lên đầu. */
  ips: string[];
  webPort: number;
}

export const getLanInfo = () => request<LanInfo>("/api/lan-info");

// ============ Media helper ============

/**
 * Mở file trong Explorer/Finder trên máy chạy server (chọn đúng file).
 * relPath tính từ repo root — whitelist thư mục như /media, 404 nếu không tồn tại.
 */
export const revealFile = (relPath: string) =>
  post<void>("/api/reveal", { relPath });

/** Đường dẫn phát file qua backend, relPath tính từ repo root. Phòng thủ với dữ liệu lệch kiểu (AI ghi meta sai hợp đồng). */
export const mediaUrl = (relPath: string) =>
  `/media/${String(relPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "")}`;

/**
 * URL ảnh của image project — meta lưu TÊN FILE trần (background.png/final.png),
 * phải ghép image-projects/<id>/ vào trước khi qua /media.
 * `version` (updatedAt) để cache-bust: file trùng tên khi tạo lại, không có ?v
 * trình duyệt sẽ hiện ảnh CŨ trong cache.
 */
export const imageFileUrl = (projectId: string, file: string, version?: string | number) =>
  mediaUrl(`image-projects/${projectId}/${file}`) +
  (version !== undefined ? `?v=${encodeURIComponent(String(version))}` : "");
