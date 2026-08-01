"use client";

import { AlertTriangle, ArrowDownCircle, Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { UpdateModal } from "@/components/UpdateModal";
import { checkUpdate, type UpdateStatus } from "@/lib/api";
import { useT } from "@/lib/i18n";

const CHECK_MS = 5 * 60 * 1000; // check bản mới mỗi 5 phút

/**
 * Chip cuối sidebar: đã mới nhất / có bản cập nhật / lỗi kiểm tra.
 * Bấm vào mở UpdateModal - toàn bộ luồng apply + poll tiến trình nằm trong đó,
 * badge chỉ giữ việc check định kỳ và trạng thái mới nhất.
 */
export function UpdateBadge() {
  const { t, tf } = useT();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const check = useCallback(async (force = false) => {
    if (aliveRef.current) setChecking(true);
    try {
      const s = await checkUpdate(force);
      if (aliveRef.current) setStatus(s);
    } catch {
      // Không kết nối được backend - im lặng, sidebar không được vỡ
    } finally {
      if (aliveRef.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
    const timer = setInterval(() => check(), CHECK_MS);
    // Tab được focus lại → check ngay (dùng cache server, không force)
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [check]);

  // Chưa check được lần nào → không chiếm chỗ trong sidebar
  if (!status) return null;

  const checkFailed = Boolean(status.error) || status.fetchOk === false;
  // Ưu tiên báo có bản mới: dù fetch lỗi, refs cũ vẫn có thể biết behind > 0
  const hasUpdate = !status.upToDate;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("update.badge-open")}
        className={`flex w-full items-center gap-2 rounded-[var(--radius)] border px-2.5 py-2 text-left text-xs transition-colors duration-150 ${
          hasUpdate
            ? "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg-subtle)]"
            : "border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
        }`}
      >
        {checking ? (
          <Loader2
            size={14}
            strokeWidth={2}
            className="shrink-0 animate-spin text-[var(--text-muted)]"
          />
        ) : hasUpdate ? (
          <ArrowDownCircle
            size={14}
            strokeWidth={1.75}
            className="shrink-0 text-[var(--primary)]"
          />
        ) : checkFailed ? (
          <AlertTriangle
            size={14}
            strokeWidth={1.75}
            className="shrink-0 text-[var(--danger)]"
          />
        ) : (
          <Check
            size={14}
            strokeWidth={2.5}
            className="shrink-0 text-[var(--success)]"
          />
        )}
        {/* Sidebar chỉ rộng 220px: nhãn + số thay đổi nằm cùng hàng thì nhãn bị
            cắt giữa từ ("Có bản cập..."). Xếp chồng hai dòng đọc được trọn vẹn. */}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate">
            {hasUpdate
              ? t("update.available")
              : checkFailed
                ? t("update.check-failed")
                : t("update.up-to-date")}
          </span>
          <span className="truncate font-mono text-[11px] text-[var(--text-muted)]">
            {hasUpdate
              ? tf("update.behind", { n: status.behind })
              : status.current}
          </span>
        </span>
      </button>

      <UpdateModal
        open={open}
        status={status}
        checking={checking}
        onClose={() => setOpen(false)}
        onRecheck={() => check(true)}
      />
    </>
  );
}
