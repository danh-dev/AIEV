"use client";

import { useEffect, useState } from "react";

/**
 * Error boundary toàn app. Nguyên nhân phổ biến nhất: tab đang mở bản build cũ
 * trong khi server đã thay bản mới → chunk JS cũ không còn → điều hướng lỗi.
 * Tự reload MỘT lần để lấy bản mới (guard chống vòng lặp reload).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [autoReloading, setAutoReloading] = useState(true);

  useEffect(() => {
    const KEY = "auto-reload-at";
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last > 15_000) {
      sessionStorage.setItem(KEY, String(Date.now()));
      window.location.reload();
    } else {
      // Vừa auto-reload xong mà vẫn lỗi → lỗi thật, hiện UI cho người dùng
      setAutoReloading(false);
    }
  }, []);

  if (autoReloading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <div className="progress-indeterminate w-56" />
        <p className="text-sm text-[var(--text-muted)]">Đang tải bản mới của giao diện…</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-base font-semibold">Trang gặp lỗi</p>
      <p className="max-w-md text-sm text-[var(--text-muted)]">
        {error.message || "Lỗi không xác định."}
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Tải lại trang
        </button>
        <button type="button" className="btn btn-secondary" onClick={reset}>
          Thử lại
        </button>
      </div>
    </div>
  );
}
