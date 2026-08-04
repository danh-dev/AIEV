"use client";

import { Check, Loader2, Pencil, X } from "lucide-react";
import { useState } from "react";

/**
 * Tiêu đề trang sửa được tại chỗ - dùng cho tên project (video và ảnh).
 *
 * VÌ SAO SỬA NGAY TRÊN TIÊU ĐỀ chứ không phải một field trong form cài đặt: tên
 * là thứ người ta nhìn thấy đầu tiên và cũng là thứ họ muốn sửa khi thấy nó sai.
 * Đặt trong form thì đổi tên bị trói vào nút Lưu chung, phải lưu cả những thứ
 * đang sửa dở khác mới đổi được tên.
 *
 * ID KHÔNG ĐỔI - đó là tên thư mục, bị tham chiếu ở đường dẫn asset, tên file
 * trong outputs/, thư mục staging của Remotion và cột projectId của job. Đổi id
 * là một cuộc di trú chứ không phải một phép sửa tên.
 *
 * Lỗi báo ra ngoài qua `onError` thay vì tự hiện: trang đã có chỗ đặt banner lỗi
 * rồi, chen thêm một dòng đỏ vào giữa tiêu đề sẽ đẩy cả bố cục nhảy xuống.
 */
export function EditableTitle({
  value,
  fallback,
  onSave,
  onError,
  editLabel,
  emptyError,
  saveLabel,
  cancelLabel,
}: {
  /** Tên hiện tại - null khi chưa tải xong (nút sửa bị khóa). */
  value: string | null;
  /** Hiện tạm khi chưa có tên - thường là id. */
  fallback: string;
  /** Gọi API đổi tên và cập nhật state của trang; ném lỗi thì component bắt. */
  onSave: (next: string) => Promise<void>;
  onError: (message: string | null) => void;
  editLabel: string;
  emptyError: string;
  saveLabel: string;
  cancelLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function start() {
    onError(null);
    setDraft(value ?? fallback);
  }

  function cancel() {
    onError(null);
    setDraft(null);
  }

  async function save() {
    if (draft === null || saving) return;
    const next = draft.trim();
    // Xóa trắng tên rồi lưu: báo lỗi rõ ràng thay vì lặng lẽ giữ tên cũ
    if (!next) {
      onError(emptyError);
      return;
    }
    if (next === value) {
      cancel();
      return;
    }
    setSaving(true);
    onError(null);
    try {
      await onSave(next);
      setDraft(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (draft === null) {
    return (
      <span className="inline-flex max-w-full items-center gap-1.5">
        {value ?? fallback}
        <button
          type="button"
          title={editLabel}
          aria-label={editLabel}
          disabled={value === null}
          onClick={start}
          className="rounded-[var(--radius)] p-1.5 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pencil size={15} strokeWidth={2} />
        </button>
      </span>
    );
  }

  // Đang sửa tên: Enter/nút check lưu, Escape/nút X bỏ - id không đổi
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <input
        className="input w-72 max-w-full"
        autoFocus
        value={draft}
        disabled={saving}
        aria-label={editLabel}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            cancel();
          }
        }}
      />
      <button
        type="button"
        title={saveLabel}
        aria-label={saveLabel}
        disabled={saving}
        onClick={save}
        className="rounded-[var(--radius)] p-1.5 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? (
          <Loader2 size={15} strokeWidth={2} className="animate-spin" />
        ) : (
          <Check size={15} strokeWidth={2} />
        )}
      </button>
      <button
        type="button"
        title={cancelLabel}
        aria-label={cancelLabel}
        disabled={saving}
        onClick={cancel}
        className="rounded-[var(--radius)] p-1.5 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X size={15} strokeWidth={2} />
      </button>
    </span>
  );
}
