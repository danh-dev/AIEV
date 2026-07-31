"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { useT } from "@/lib/i18n";

/** Chuỗi bắt buộc gõ đúng để mở khóa nút Xóa. */
const CONFIRM_TEXT = "DELETE";

/**
 * Modal xác nhận xóa dùng chung cho MỌI hành động xóa phá hủy dữ liệu:
 * bắt gõ đúng chữ DELETE mới cho bấm Xóa — thay thế window.confirm.
 *
 * Lưu ý: hành động không phá hủy dữ liệu nguồn (vd "Xóa file rác") KHÔNG
 * dùng modal này — giữ confirm thường.
 */
export function ConfirmDeleteModal({
  open,
  title,
  description,
  items,
  busy = false,
  busyLabel,
  confirmLabel,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** Tiêu đề modal — hiển thị màu đỏ (danger). Mặc định t("confirm.title"). */
  title?: string;
  /** Mô tả đối tượng sắp xóa + hậu quả. */
  description?: ReactNode;
  /** Danh sách tên khi xóa nhiều mục. */
  items?: string[];
  /** true = đang xóa: khóa input/nút, hiện busyLabel. */
  busy?: boolean;
  busyLabel?: string;
  confirmLabel?: string;
  /** Lỗi từ lần xóa trước (nếu có) — hiển thị trong modal. */
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t, tf } = useT();
  const [text, setText] = useState("");

  // Mỗi lần mở lại modal thì input về rỗng — không "nhớ" DELETE của lần trước
  useEffect(() => {
    if (open) setText("");
  }, [open]);

  const confirmed = text === CONFIRM_TEXT;

  return (
    <Modal
      title={
        <span className="text-[var(--danger)]">
          {title ?? t("confirm.title")}
        </span>
      }
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={busy || !confirmed}
            onClick={onConfirm}
          >
            <Trash2 size={14} strokeWidth={2} />
            {busy
              ? (busyLabel ?? t("common.deleting"))
              : (confirmLabel ?? t("common.delete"))}
          </Button>
        </>
      }
    >
      {error && (
        <p className="whitespace-pre-line text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {description && <div className="text-sm">{description}</div>}
      {items && items.length > 0 && (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
          {items.map((item) => (
            <li key={item} className="break-all text-sm font-medium">
              {item}
            </li>
          ))}
        </ul>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span>
          {t("confirm.type-before")}{" "}
          <code className="rounded bg-[var(--danger-bg)] px-1 text-xs font-semibold text-[var(--danger)]">
            {CONFIRM_TEXT}
          </code>{" "}
          {t("confirm.type-after")}
        </span>
        <input
          className="input"
          autoFocus
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && confirmed && !busy) onConfirm();
          }}
          placeholder={CONFIRM_TEXT}
          aria-label={tf("confirm.type-aria", { text: CONFIRM_TEXT })}
        />
      </label>
    </Modal>
  );
}
