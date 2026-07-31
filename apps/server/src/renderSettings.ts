import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { paths } from "./config.js";
import { ensureDir } from "./util.js";

const execFileAsync = promisify(execFile);

/**
 * Cài đặt tăng tốc phần cứng cho render — điều khiển từ tab "Tăng tốc" trên web UI.
 * Lưu data/render-settings.json; job đọc MỖI LẦN chạy nên đổi là có hiệu lực ngay.
 * Thiết kế đa nền tảng: NVENC (NVIDIA/Windows-Linux), VideoToolbox + fast-capture (macOS).
 */

export interface RenderSettings {
  /** Số worker Chrome của HyperFrames (0 = auto của CLI) */
  workers: number;
  /** Dùng GPU cho capture của Chrome (Windows/NVIDIA lẫn macOS/Metal đều hưởng) */
  browserGpu: boolean;
  /** Encode GPU cho bản DRAFT (NVENC/VideoToolbox tùy máy) — nhanh, chất lượng draft không quan trọng */
  gpuEncodeDraft: boolean;
  /** Encode GPU cho bản FINAL — nhanh hơn nhưng chất lượng nhỉnh kém libx264 cùng dung lượng */
  gpuEncodeFinal: boolean;
  /** --experimental-fast-capture — chỉ thực sự ăn trên macOS + GPU thật (nơi khác tự fallback) */
  fastCapture: boolean;
  /** --concurrency của Remotion (0 = mặc định Remotion ~ nửa số core) */
  remotionConcurrency: number;
  /** Số job render chạy đồng thời trong queue (1-4) */
  queueConcurrency: number;
  /** fps cho bản draft (null = giữ fps composition; 15 = nhanh gần gấp đôi, chỉ để duyệt nhịp) */
  draftFps: number | null;
}

/** Số luồng CPU thật của máy — nguồn cho default + trần của workers/concurrency */
const cpuThreads = os.cpus().length;
/** Số worker khuyên dùng: theo máy thật, trần 8 (nhiều hơn hiếm khi nhanh hơn đáng kể) */
export const recommendedWorkers = Math.min(cpuThreads, 8);
/** Trần chọn được trên UI: máy nhiều luồng được chọn tới đúng số luồng (tối thiểu 4) */
export const maxWorkers = Math.max(cpuThreads, 4);

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  workers: recommendedWorkers,
  browserGpu: true,
  gpuEncodeDraft: true,
  gpuEncodeFinal: false,
  fastCapture: false,
  remotionConcurrency: recommendedWorkers,
  queueConcurrency: 2,
  draftFps: null,
};

const settingsFile = path.join(paths.dataDir, "render-settings.json");

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Kẹp range + ép kiểu một object bất kỳ về RenderSettings hợp lệ — dùng cho cả read lẫn write */
function normalizeSettings(raw: Record<string, unknown>): RenderSettings {
  const base = { ...DEFAULT_RENDER_SETTINGS };
  if (typeof raw.workers === "number") base.workers = clamp(Math.round(raw.workers), 0, maxWorkers);
  if (typeof raw.browserGpu === "boolean") base.browserGpu = raw.browserGpu;
  if (typeof raw.gpuEncodeDraft === "boolean") base.gpuEncodeDraft = raw.gpuEncodeDraft;
  if (typeof raw.gpuEncodeFinal === "boolean") base.gpuEncodeFinal = raw.gpuEncodeFinal;
  if (typeof raw.fastCapture === "boolean") base.fastCapture = raw.fastCapture;
  if (typeof raw.remotionConcurrency === "number") {
    base.remotionConcurrency = clamp(Math.round(raw.remotionConcurrency), 0, maxWorkers);
  }
  if (typeof raw.queueConcurrency === "number") {
    base.queueConcurrency = clamp(Math.round(raw.queueConcurrency), 1, 4);
  }
  if (raw.draftFps === null) base.draftFps = null;
  else if (typeof raw.draftFps === "number") base.draftFps = clamp(Math.round(raw.draftFps), 10, 60);
  return base;
}

export function readRenderSettings(): RenderSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Record<string, unknown>;
    return normalizeSettings(raw);
  } catch {
    /* file chưa có / hỏng → default */
    return { ...DEFAULT_RENDER_SETTINGS };
  }
}

export function writeRenderSettings(patch: Partial<RenderSettings>): RenderSettings {
  // Clamp TRƯỚC khi ghi — file trên đĩa không còn chứa giá trị ngoài range
  const next = normalizeSettings({ ...readRenderSettings(), ...patch });
  ensureDir(paths.dataDir);
  fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

// ---------------------------------------------------------------- Phần cứng

export interface HardwareInfo {
  platform: string;
  cores: number;
  ramGb: number;
  gpuName: string | null;
  /** NVENC khả dụng (NVIDIA) */
  nvenc: boolean;
  /** VideoToolbox + fast-capture (macOS) */
  videotoolbox: boolean;
  // ---- Chi tiết hiển thị trên tab Cấu hình ----
  /** Tên đầy đủ CPU, vd "Intel(R) Core(TM) i5-9400F CPU @ 2.90GHz" (đã dọn (R)/(TM)) */
  cpuModel: string;
  /** Số core vật lý (null nếu không tra được — UI rơi về threads) */
  cpuCores: number | null;
  /** Số luồng logic */
  cpuThreads: number;
  /** Xung tối đa (GHz, null nếu không tra được) */
  cpuMaxGhz: number | null;
  /** Loại RAM: DDR3/DDR4/DDR5/Unified Memory... */
  ramType: string | null;
  /** Bus RAM (MHz) */
  ramSpeedMhz: number | null;
  /** VRAM của GPU (GB) — hiện chỉ tra được với NVIDIA */
  gpuVramGb: number | null;
}

let hardwareCache: HardwareInfo | null = null;

/** Chạy PowerShell CIM trả JSON — fallback khi wmic không có (Win11 mới bỏ wmic) */
async function psCimJson(className: string, props: string[]): Promise<Record<string, unknown>[]> {
  const cmd =
    `Get-CimInstance ${className} | Select-Object ${props.join(",")} | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", cmd],
    { windowsHide: true, timeout: 10_000 },
  );
  const parsed = JSON.parse(stdout.trim()) as unknown;
  return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [parsed as Record<string, unknown>];
}

/** SMBIOSMemoryType → tên chuẩn (Win32_PhysicalMemory) */
const RAM_TYPE_BY_SMBIOS: Record<number, string> = {
  20: "DDR",
  21: "DDR2",
  24: "DDR3",
  26: "DDR4",
  34: "DDR5",
  35: "LPDDR5",
};

export async function detectHardware(): Promise<HardwareInfo> {
  if (hardwareCache) return hardwareCache;
  const cpus = os.cpus();
  const info: HardwareInfo = {
    platform: process.platform,
    cores: cpus.length,
    ramGb: Math.round(os.totalmem() / 1024 ** 3),
    gpuName: null,
    nvenc: false,
    videotoolbox: process.platform === "darwin",
    cpuModel: (cpus[0]?.model ?? "CPU").replace(/\((R|TM)\)/gi, "").replace(/\s+/g, " ").trim(),
    cpuCores: null,
    cpuThreads: cpus.length,
    cpuMaxGhz: null,
    ramType: null,
    ramSpeedMhz: null,
    gpuVramGb: null,
  };

  // NVIDIA? — lấy luôn cả VRAM
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
      { windowsHide: true, timeout: 5000 },
    );
    const first = stdout.trim().split("\n")[0]?.trim();
    if (first) {
      const [name, memMb] = first.split(",").map((s) => s.trim());
      if (name) {
        info.gpuName = name;
        info.nvenc = true;
      }
      const mb = Number(memMb);
      if (Number.isFinite(mb) && mb > 0) info.gpuVramGb = Math.round(mb / 1024);
    }
  } catch {
    /* không có NVIDIA */
  }

  if (process.platform === "win32") {
    // CPU: core vật lý + xung tối đa (CIM — wmic đã deprecated trên Win11 mới)
    try {
      const rows = await psCimJson("Win32_Processor", ["NumberOfCores", "MaxClockSpeed"]);
      const cores = rows.reduce((acc, r) => acc + (Number(r.NumberOfCores) || 0), 0);
      if (cores > 0) info.cpuCores = cores;
      const mhz = Number(rows[0]?.MaxClockSpeed);
      if (Number.isFinite(mhz) && mhz > 0) info.cpuMaxGhz = Math.round(mhz / 100) / 10;
    } catch {
      /* thôi — UI rơi về threads */
    }
    // RAM: loại + bus
    try {
      const rows = await psCimJson("Win32_PhysicalMemory", [
        "SMBIOSMemoryType",
        "Speed",
        "ConfiguredClockSpeed",
      ]);
      const smbios = Number(rows[0]?.SMBIOSMemoryType);
      if (RAM_TYPE_BY_SMBIOS[smbios]) info.ramType = RAM_TYPE_BY_SMBIOS[smbios];
      const speed = Number(rows[0]?.ConfiguredClockSpeed) || Number(rows[0]?.Speed);
      if (Number.isFinite(speed) && speed > 0) info.ramSpeedMhz = speed;
    } catch {
      /* thôi */
    }
    // Tên GPU tổng quát nếu không có NVIDIA
    if (!info.gpuName) {
      try {
        const rows = await psCimJson("Win32_VideoController", ["Name"]);
        const name = typeof rows[0]?.Name === "string" ? (rows[0].Name as string).trim() : "";
        if (name) info.gpuName = name;
      } catch {
        /* thôi */
      }
    }
  }

  if (process.platform === "darwin") {
    // Apple Silicon: RAM hợp nhất; core vật lý qua sysctl
    try {
      const { stdout } = await execFileAsync("sysctl", ["-n", "hw.physicalcpu"], { timeout: 5000 });
      const n = Number(stdout.trim());
      if (Number.isFinite(n) && n > 0) info.cpuCores = n;
    } catch {
      /* thôi */
    }
    if (/apple/i.test(info.cpuModel)) info.ramType = "Unified Memory";
    if (!info.gpuName) info.gpuName = "Apple GPU (Metal)";
  }

  hardwareCache = info;
  return info;
}

// ---------------------------------------------------------------- Flags builder

/** Chuỗi flags tăng tốc cho `hyperframes render` — job đọc mỗi lần chạy */
export function hyperframesSpeedFlags(draft: boolean): string {
  const s = readRenderSettings();
  const parts: string[] = [];
  if (s.workers > 0) parts.push(`-w ${s.workers}`);
  if (s.browserGpu) parts.push("--browser-gpu");
  if (s.fastCapture) parts.push("--experimental-fast-capture");
  if (draft ? s.gpuEncodeDraft : s.gpuEncodeFinal) parts.push("--gpu");
  if (draft && s.draftFps) parts.push(`-f ${s.draftFps}`);
  return parts.join(" ");
}

/** Flag --concurrency cho `remotion render/still` ("" nếu để mặc định Remotion) */
export function remotionConcurrencyFlag(): string {
  const c = readRenderSettings().remotionConcurrency;
  return c > 0 ? ` --concurrency ${c}` : "";
}

/**
 * Flag --gl cho Chrome của Remotion — mặc định Remotion dùng SwANGLE (software, CPU thuần).
 * Bật "GPU cho capture" → angle (Windows/macOS) / angle-egl (Linux) để dựng hình bằng GPU thật.
 */
export function remotionGlFlag(): string {
  if (!readRenderSettings().browserGpu) return "";
  return process.platform === "linux" ? " --gl angle-egl" : " --gl angle";
}

/** Bộ flags tăng tốc đầy đủ cho `remotion render` */
export function remotionSpeedFlags(): string {
  return `${remotionConcurrencyFlag()}${remotionGlFlag()}`;
}

/** Số job queue chạy đồng thời — queue đọc mỗi tick nên đổi là ăn ngay */
export function queueConcurrency(): number {
  return readRenderSettings().queueConcurrency;
}
