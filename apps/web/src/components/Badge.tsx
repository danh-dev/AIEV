import type { JobStatus, ProjectStatus } from "@/lib/api";

type Tone = "success" | "running" | "danger" | "muted";

const JOB_LABEL: Record<JobStatus, string> = {
  queued: "Chờ",
  running: "Đang chạy",
  done: "Hoàn thành",
  failed: "Lỗi",
  canceled: "Đã hủy",
};

const JOB_TONE: Record<JobStatus, Tone> = {
  queued: "muted",
  running: "running",
  done: "success",
  failed: "danger",
  canceled: "muted",
};

const PROJECT_LABEL: Record<ProjectStatus, string> = {
  draft: "Nháp",
  rendering: "Đang render",
  done: "Hoàn thành",
};

const PROJECT_TONE: Record<ProjectStatus, Tone> = {
  draft: "muted",
  rendering: "running",
  done: "success",
};

export function Badge({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" />
      {label}
    </span>
  );
}

export function JobBadge({ status }: { status: JobStatus }) {
  return <Badge tone={JOB_TONE[status]} label={JOB_LABEL[status]} />;
}

export function ProjectBadge({ status }: { status: ProjectStatus }) {
  const tone = PROJECT_TONE[status] ?? "muted";
  const label = PROJECT_LABEL[status] ?? String(status);
  return <Badge tone={tone} label={label} />;
}
