import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import {
  HttpError,
  ensureDir,
  isKebabCase,
  listFilesRecursive,
  nowIso,
  type FileInfo,
} from "./util.js";

/** Schema meta.json - manifest trung tâm của một video project (xem skill video-pipeline) */
export interface SceneMeta {
  id: string;
  /** Composition HyperFrames - scene do HyperFrames render */
  src?: string;
  /** Footage dùng thẳng - không qua HyperFrames */
  srcVideo?: string;
  /** Ảnh tĩnh (ảnh minh họa AI) - scene cutaway full-bleed */
  srcImage?: string;
  durationInFrames?: number;
  render?: string;
  from?: number;
  to?: number;
  transitionOverlap?: number;
  [key: string]: unknown;
}

export interface SfxMeta {
  file: string;
  atFrame?: number;
  volume?: number;
  [key: string]: unknown;
}

/** Nhạc nền với auto-ducking khi có thoại - file staging + speech ranges (giây) */
export interface MusicMeta {
  file: string;
  volume?: number;
  duckVolume?: number;
  speech?: [number, number][];
  [key: string]: unknown;
}

/** Kịch bản edit - AI đọc phần này khi bắt đầu edit project (xem docs/API.md mục Project Brief) */
export type SfxMode = "recommended" | "library" | "none";

export const SFX_MODES: SfxMode[] = ["recommended", "library", "none"];

/** Nhạc nền: AI tự chọn theo mood trong thư viện assets/music/ hoặc không dùng */
export type MusicMode = "auto" | "none";

export const MUSIC_MODES: MusicMode[] = ["auto", "none"];

export interface Brief {
  /** Mô tả nội dung video gốc - bối cảnh cho AI */
  sourceDescription: string;
  /** Có tự động cắt bỏ đoạn thừa, khoảng lặng không */
  autoCut: boolean;
  /** Có tạo phụ đề (karaoke) không */
  subtitles: boolean;
  /** BẬT = AI tự phân tích source, tự chọn keyword để highlight */
  highlightEnabled: boolean;
  /** (Nâng cao, tùy chọn) chỉ định thêm keyword thủ công */
  highlightKeywords: string[];
  /** BẬT = bố cục Key: KEY CHÍNH vùng TRÊN video, KEY LIÊN QUAN vùng DƯỚI (skill key-layout) */
  keyLayoutEnabled: boolean;
  /** Key chính user chỉ định - "" = AI tự phân tích chọn */
  mainKey: string;
  /** Key liên quan user chỉ định (bắt buộc dùng đủ) - [] = AI tự chọn 3–6 key */
  relatedKeys: string[];
  /** Tên skill dùng để edit (null = AI tự chọn) */
  skill: string | null;
  /** Sound effect: chỉ bộ đề xuất / tự tìm cả thư viện / không dùng */
  sfxMode: SfxMode;
  /** Nhạc nền: "auto" = AI tự chọn bài theo mood (thư viện assets/music/), "none" = không dùng */
  musicMode: MusicMode;
  /** BẬT = Claude tự tạo ảnh minh họa bằng Gemini (đồng bộ Design System) và ghép vào video */
  autoIllustrations: boolean;
  /** Model Gemini cho ảnh minh họa (null = mặc định Nano Banana 2) */
  illustrationModel: string | null;
  /** BẬT = cho phép Gemini vẽ chữ tiếng Việt vào ảnh minh họa (mặc định TẮT - chữ do Remotion/HyperFrames đặt) */
  illustrationText: boolean;
  /** Style Design áp cho video (id trong assets/styles/styles.json) - null = style default */
  styleId: string | null;
  /** Ghi chú tự do cho AI */
  notes: string;
}

export function defaultBrief(): Brief {
  return {
    sourceDescription: "",
    autoCut: true,
    subtitles: true,
    highlightEnabled: true,
    highlightKeywords: [],
    keyLayoutEnabled: true,
    mainKey: "",
    relatedKeys: [],
    skill: null,
    sfxMode: "recommended",
    musicMode: "auto",
    autoIllustrations: false,
    illustrationModel: null,
    illustrationText: false,
    styleId: null,
    notes: "",
  };
}

/** Merge meta.brief (nếu có) lên default - field thiếu/sai kiểu dùng default */
export function briefOf(meta: ProjectMeta): Brief {
  const base = defaultBrief();
  const raw = meta.brief as unknown; // meta đọc từ đĩa - không tin kiểu
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const b = raw as Record<string, unknown>;
  if (typeof b.sourceDescription === "string") base.sourceDescription = b.sourceDescription;
  if (typeof b.autoCut === "boolean") base.autoCut = b.autoCut;
  if (typeof b.subtitles === "boolean") base.subtitles = b.subtitles;
  if (typeof b.highlightEnabled === "boolean") base.highlightEnabled = b.highlightEnabled;
  if (Array.isArray(b.highlightKeywords)) {
    base.highlightKeywords = b.highlightKeywords.filter(
      (k): k is string => typeof k === "string",
    );
  }
  if (typeof b.keyLayoutEnabled === "boolean") base.keyLayoutEnabled = b.keyLayoutEnabled;
  if (typeof b.mainKey === "string") base.mainKey = b.mainKey;
  if (Array.isArray(b.relatedKeys)) {
    base.relatedKeys = b.relatedKeys.filter((k): k is string => typeof k === "string");
  }
  if (typeof b.skill === "string" && b.skill.trim()) base.skill = b.skill.trim();
  if (SFX_MODES.includes(b.sfxMode as SfxMode)) base.sfxMode = b.sfxMode as SfxMode;
  if (MUSIC_MODES.includes(b.musicMode as MusicMode)) base.musicMode = b.musicMode as MusicMode;
  if (typeof b.autoIllustrations === "boolean") base.autoIllustrations = b.autoIllustrations;
  if (typeof b.illustrationModel === "string" && b.illustrationModel.trim()) {
    base.illustrationModel = b.illustrationModel.trim();
  }
  if (typeof b.illustrationText === "boolean") base.illustrationText = b.illustrationText;
  if (typeof b.styleId === "string" && b.styleId.trim()) base.styleId = b.styleId.trim();
  if (typeof b.notes === "string") base.notes = b.notes;
  return base;
}

export interface ProjectMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  status: string;
  brief?: Brief;
  scenes?: SceneMeta[];
  audio?: {
    voice?: string | null;
    sfx?: SfxMeta[];
    /** Nhạc nền auto-ducking (xem skill background-music) - null/thiếu = không có nhạc */
    music?: MusicMeta | null;
    [key: string]: unknown;
  };
  output?: string | null;
  /** Tags quản lý project - hiện trong danh sách, lọc được */
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ProjectSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  status: "draft" | "rendering" | "done";
  output: string | null;
  tags: string[];
  createdAt: string | null;
  updatedAt: string;
}

/**
 * Chuẩn hóa output về string đường dẫn theo hợp đồng API.
 * AI đôi khi ghi meta.output thành object { file, renderPath, ... } - lấy .file.
 */
export function normOutput(raw: unknown): string | null {
  if (typeof raw === "string" && raw) return raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (typeof o.file === "string" && o.file) return o.file;
    if (typeof o.renderPath === "string" && o.renderPath) return o.renderPath;
  }
  return null;
}

/** Chuẩn hóa mảng tags: string, trim, bỏ rỗng, dedupe */
export function normTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean))];
}

export function projectDirOf(id: string): string {
  return path.join(paths.videoProjectsDir, id);
}

export function metaPathOf(id: string): string {
  return path.join(projectDirOf(id), "meta.json");
}

export function projectExists(id: string): boolean {
  return isKebabCase(id) && fs.existsSync(metaPathOf(id));
}

/** Đọc meta.json - ném HttpError 404/500 tùy trường hợp */
export function readMeta(id: string): ProjectMeta {
  if (!isKebabCase(id)) {
    throw new HttpError(400, "INVALID_PROJECT_ID", `Project id không hợp lệ: ${id}`);
  }
  const file = metaPathOf(id);
  if (!fs.existsSync(file)) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", `Không tìm thấy project "${id}"`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ProjectMeta;
  } catch {
    throw new HttpError(500, "META_INVALID", `meta.json của project "${id}" không phải JSON hợp lệ`);
  }
}

export function writeMeta(id: string, meta: ProjectMeta): void {
  meta.updatedAt = nowIso();
  fs.writeFileSync(metaPathOf(id), JSON.stringify(meta, null, 2) + "\n", "utf8");
}

function normStatus(s: unknown): ProjectSummary["status"] {
  return s === "rendering" || s === "done" ? s : "draft";
}

export function projectSummaryOf(id: string): ProjectSummary | null {
  const file = metaPathOf(id);
  try {
    const meta = JSON.parse(fs.readFileSync(file, "utf8")) as ProjectMeta;
    const updatedAt =
      typeof meta.updatedAt === "string" && meta.updatedAt
        ? meta.updatedAt
        : fs.statSync(file).mtime.toISOString();
    return {
      id,
      name: typeof meta.name === "string" ? meta.name : id,
      width: Number(meta.width) || 0,
      height: Number(meta.height) || 0,
      fps: Number(meta.fps) || 0,
      status: normStatus(meta.status),
      output: normOutput(meta.output),
      tags: normTags(meta.tags),
      createdAt: typeof meta.createdAt === "string" && meta.createdAt ? meta.createdAt : null,
      updatedAt,
    };
  } catch {
    return null; // meta hỏng → bỏ qua khỏi danh sách
  }
}

// ------------------------------------------------- Asset descriptions
// File video-projects/<id>/assets/assets.json = { "<fileName>": { "description": string } }
// Thiếu entry nghĩa là asset chưa được mô tả - upload mới không cần tạo entry.

export type FileInfoWithDescription = FileInfo & {
  description?: string;
  /** Preset chỉnh màu người dùng đã duyệt cho asset video (id trong GRADE_PRESETS, null = không chỉnh) */
  colorGrade?: string;
  /** Thông số chỉnh tay cộng chồng lên preset (GradeAdjust) - chỉ có khi khác mặc định */
  colorAdjust?: Record<string, number>;
};

export interface AssetEntry {
  description?: string;
  colorGrade?: string;
  colorAdjust?: Record<string, number>;
}

/** Đọc assets.json → map fileName → entry đầy đủ; file thiếu/hỏng → {} */
export function readAssetEntries(id: string): Record<string, AssetEntry> {
  try {
    const raw = JSON.parse(fs.readFileSync(assetsJsonPathOf(id), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, AssetEntry> = {};
    for (const [file, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const clean: AssetEntry = {};
      if (typeof e.description === "string") clean.description = e.description;
      if (typeof e.colorGrade === "string" && e.colorGrade) clean.colorGrade = e.colorGrade;
      if (e.colorAdjust && typeof e.colorAdjust === "object" && !Array.isArray(e.colorAdjust)) {
        clean.colorAdjust = e.colorAdjust as Record<string, number>;
      }
      out[file] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** Merge một phần entry của asset vào assets.json (colorGrade: null để xóa) */
export function writeAssetEntry(
  id: string,
  fileName: string,
  patch: {
    description?: string;
    colorGrade?: string | null;
    colorAdjust?: Record<string, number> | null;
  },
): void {
  const map = readAssetEntries(id);
  const cur = map[fileName] ?? {};
  if (patch.description !== undefined) cur.description = patch.description;
  if (patch.colorGrade !== undefined) {
    if (patch.colorGrade === null) delete cur.colorGrade;
    else cur.colorGrade = patch.colorGrade;
  }
  if (patch.colorAdjust !== undefined) {
    if (patch.colorAdjust === null) delete cur.colorAdjust;
    else cur.colorAdjust = patch.colorAdjust;
  }
  map[fileName] = cur;
  ensureDir(projectAssetsDirOf(id));
  fs.writeFileSync(assetsJsonPathOf(id), JSON.stringify(map, null, 2) + "\n", "utf8");
}

/** Xóa hẳn entry của một asset khỏi assets.json (dùng khi xóa file asset) - không có entry thì bỏ qua */
export function removeAssetEntry(id: string, fileName: string): void {
  const map = readAssetEntries(id);
  if (!(fileName in map)) return;
  delete map[fileName];
  fs.writeFileSync(assetsJsonPathOf(id), JSON.stringify(map, null, 2) + "\n", "utf8");
}

export function projectAssetsDirOf(id: string): string {
  return path.join(projectDirOf(id), "assets");
}

export function assetsJsonPathOf(id: string): string {
  return path.join(projectAssetsDirOf(id), "assets.json");
}

// LƯU Ý: mọi ghi vào assets.json PHẢI đi qua writeAssetEntry (merge từng field).
// Cặp readAssetDescriptions/writeAssetDescription cũ đã bị xóa vì rebuild cả file
// chỉ với description → xóa trắng colorGrade/colorAdjust của mọi asset.

/** Liệt kê asset của project (bỏ assets.json), merge description + colorGrade từ assets.json */
export function listProjectAssets(id: string): FileInfoWithDescription[] {
  const files = listFilesRecursive(projectAssetsDirOf(id)).filter(
    (f) => f.name !== "assets.json",
  );
  const entries = readAssetEntries(id);
  return files.map((f) => {
    const e = entries[f.name];
    if (!e) return f;
    const out: FileInfoWithDescription = { ...f };
    if (e.description !== undefined) out.description = e.description;
    if (e.colorGrade !== undefined) out.colorGrade = e.colorGrade;
    if (e.colorAdjust !== undefined) out.colorAdjust = e.colorAdjust;
    return out;
  });
}

/** Quét video-projects/<id>/meta.json → danh sách summary, mới cập nhật trước */
export function scanProjects(): ProjectSummary[] {
  if (!fs.existsSync(paths.videoProjectsDir)) return [];
  const out: ProjectSummary[] = [];
  for (const entry of fs.readdirSync(paths.videoProjectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!fs.existsSync(metaPathOf(entry.name))) continue;
    const summary = projectSummaryOf(entry.name);
    if (summary) out.push(summary);
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}
