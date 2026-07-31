"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useT } from "@/lib/i18n";

export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** true = modal rộng (lưới preview nhiều cột) — max-w 960px thay vì 640px. */
  wide?: boolean;
}) {
  const { t } = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--text)]/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Form đơn lẻ giữ giới hạn chiều rộng cho dễ đọc (quy tắc full-width chỉ áp cho trang) */}
      <div
        className={`card max-h-[90vh] w-full overflow-y-auto ${
          wide ? "max-w-[960px]" : "max-w-[640px]"
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-[var(--radius)] p-1 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="flex flex-col gap-3">{children}</div>
        {footer && (
          <div className="mt-5 flex justify-end gap-2">{footer}</div>
        )}
      </div>
    </div>
  );
}
