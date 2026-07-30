import type { ChatSessionStatus } from "@/lib/api";

/**
 * Badge trạng thái phiên AI — dùng ở panel AI của project, header ChatThread
 * và mọi nơi liệt kê session. running có chấm nhấp nháy để thấy ngay là
 * phiên còn sống.
 */

const LABEL: Record<ChatSessionStatus, string> = {
  idle: "Chờ",
  running: "Đang làm việc",
  done: "Hoàn thành",
  error: "Lỗi",
  interrupted: "Tạm dừng",
};

const TONE: Record<ChatSessionStatus, string> = {
  idle: "badge-muted",
  running: "badge-running",
  done: "badge-success",
  error: "badge-danger",
  interrupted: "badge-muted",
};

/** Label thuần chữ — dùng trong <option> của dropdown (không render JSX được). */
export function sessionStatusLabel(status: ChatSessionStatus): string {
  return LABEL[status] ?? String(status);
}

export function SessionStatusBadge({
  status,
  large = false,
}: {
  status: ChatSessionStatus;
  large?: boolean;
}) {
  const tone = TONE[status] ?? "badge-muted";
  return (
    <span
      className={`badge ${tone} ${large ? "px-3 py-1 text-[13px]" : ""}`}
    >
      <span
        className={`badge-dot ${status === "running" ? "badge-dot-pulse" : ""}`}
      />
      {sessionStatusLabel(status)}
    </span>
  );
}
