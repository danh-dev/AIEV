"use client";

/**
 * Thanh timeline giai đoạn pipeline của một video project — stepper ngang
 * 6 giai đoạn, gọn để nằm cùng hàng header. Giai đoạn suy ra HOÀN TOÀN phía
 * client từ dữ liệu trang đã có (meta + jobs + session AI) — backend vẫn là
 * nguồn sự thật về job, component chỉ đọc.
 */

import type { FileInfo, Job, ProjectStatus, SceneMeta } from "@/lib/api";

const STEPS = [
  "Phân tích",
  "Dựng scene",
  "Render draft",
  "Lắp draft",
  "Render final",
  "Hoàn thành",
] as const;

export interface PipelineStageInput {
  metaStatus: ProjectStatus | undefined;
  hasOutput: boolean;
  scenes: SceneMeta[];
  renders: FileInfo[];
  /** Jobs của project này (mọi trạng thái) — cập nhật sống qua SSE. */
  jobs: Job[];
  /** Có phiên AI của project đang chạy. */
  sessionRunning: boolean;
}

/** Kết quả suy giai đoạn: stage 1-6 + active (đang có việc chạy → pulse). */
export interface PipelineStage {
  stage: number;
  active: boolean;
}

/** Mốc "đã qua" suy từ job done — nâng floor khi không có gì đang chạy rõ hơn. */
function doneJobFloor(jobs: Job[]): number {
  let floor = 0;
  for (const j of jobs) {
    if (j.status !== "done") continue;
    const f =
      j.type === "scene-draft"
        ? 3
        : j.type === "assemble-draft"
          ? 4
          : j.type === "scene-final" || j.type === "assemble-final"
            ? 5
            : 0;
    if (f > floor) floor = f;
  }
  return floor;
}

/**
 * Suy giai đoạn hiện tại của pipeline — thuần, không side effect.
 * Trả null = chưa bắt đầu gì (project draft trống) → ẩn timeline.
 */
export function deriveStage(input: PipelineStageInput): PipelineStage | null {
  const { metaStatus, hasOutput, scenes, renders, jobs, sessionRunning } =
    input;

  // 6 — final đã xuất, meta chốt done
  if (metaStatus === "done" && hasOutput) return { stage: 6, active: false };

  // Job đang chạy/chờ quyết định giai đoạn trực tiếp
  const activeTypes = new Set(
    jobs
      .filter((j) => j.status === "running" || j.status === "queued")
      .map((j) => j.type)
  );
  if (activeTypes.has("scene-final") || activeTypes.has("assemble-final"))
    return { stage: 5, active: true };
  if (activeTypes.has("assemble-draft")) return { stage: 4, active: true };
  if (activeTypes.has("scene-draft")) return { stage: 3, active: true };

  // Mốc suy từ sản phẩm đã có trên đĩa: có file draft render → 3, có scene → 2
  const hasDraftRender = renders.some((f) => f.kind === "video");
  const artifactFloor = hasDraftRender ? 3 : scenes.length > 0 ? 2 : 0;
  const floor = Math.max(artifactFloor, doneJobFloor(jobs));

  if (sessionRunning) {
    // AI đang chạy nhưng chưa có job render nào — đang phân tích/dựng scene
    return { stage: Math.max(floor, 1), active: true };
  }

  // Không gì chạy, chưa done: giữ mốc cao nhất đã đạt; chưa có gì → ẩn
  if (floor === 0) return null;
  return { stage: floor, active: false };
}

export function PipelineTimeline(props: PipelineStageInput) {
  const derived = deriveStage(props);
  if (!derived) return null;
  const { stage, active } = derived;

  return (
    <ol
      className="flex min-w-0 flex-wrap items-center gap-y-1"
      aria-label={`Tiến trình pipeline — giai đoạn ${stage}/6: ${STEPS[stage - 1]}`}
    >
      {STEPS.map((label, i) => {
        const n = i + 1;
        const passed = n < stage;
        const current = n === stage;
        const dotCls = passed
          ? "bg-[var(--primary)]"
          : current
            ? `bg-[var(--primary)] ring-[3px] ring-[var(--primary-soft)]${
                active ? " animate-pulse" : ""
              }`
            : "border border-[var(--border)]";
        const labelCls = current
          ? "font-semibold text-[var(--text)]"
          : passed
            ? "text-[var(--text-muted)]"
            : "text-[var(--text-muted)] opacity-60";
        return (
          <li key={label} className="flex items-center">
            {i > 0 && (
              <span
                aria-hidden="true"
                className={`mx-1.5 h-px w-3 shrink-0 ${
                  n <= stage ? "bg-[var(--primary)]" : "bg-[var(--border)]"
                }`}
              />
            )}
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${dotCls}`}
            />
            <span
              className={`ml-1.5 whitespace-nowrap text-[11px] leading-none ${labelCls}`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
