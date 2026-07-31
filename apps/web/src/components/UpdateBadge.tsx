"use client";

import { ArrowDownCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, applyUpdate, checkUpdate, type UpdateStatus } from "@/lib/api";

const CHECK_MS = 30 * 60 * 1000; // check bản mới mỗi 30 phút
const HEALTH_POLL_MS = 5_000; // poll /api/health trong lúc update

/**
 * Badge cuối sidebar: báo có bản cập nhật từ GitHub + nút bấm tự kéo về.
 * Sau khi apply: chờ server CHẾT (script update kill) rồi SỐNG lại → reload trang.
 */
export function UpdateBadge() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [updating, setUpdating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const s = await checkUpdate();
        if (alive) setStatus(s);
      } catch {
        // Không kết nối được backend — im lặng, sidebar không được vỡ
      }
    }
    check();
    const timer = setInterval(check, CHECK_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Đang update: chờ health chết trước rồi sống lại → reload
  useEffect(() => {
    if (!updating) return;
    let alive = true;
    let sawDown = false;
    const timer = setInterval(async () => {
      let up = false;
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        up = res.ok;
      } catch {
        up = false;
      }
      if (!alive) return;
      if (!up) {
        sawDown = true;
      } else if (sawDown) {
        location.reload();
      }
    }, HEALTH_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [updating]);

  async function onApply() {
    const ok = window.confirm(
      "Hệ thống sẽ dừng, kéo bản mới và khởi động lại (~1-3 phút). Tiếp tục?"
    );
    if (!ok) return;
    setNotice(null);
    try {
      await applyUpdate();
      setUpdating(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "JOB_RUNNING") {
        setNotice("Đang có job render — chờ xong rồi cập nhật.");
      } else {
        setNotice(
          err instanceof ApiError ? err.message : "Không gửi được lệnh cập nhật."
        );
      }
    }
  }

  if (updating) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="text-xs font-medium">Đang cập nhật…</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Trang sẽ tự tải lại
        </p>
        <div className="progress-indeterminate mt-2" aria-label="Đang cập nhật" />
      </div>
    );
  }

  if (!status) return null;

  if (status.upToDate) {
    return (
      <p className="px-2 text-xs text-[var(--text-muted)]">
        Bản mới nhất{status.current ? ` · ${status.current}` : ""}
      </p>
    );
  }

  const message = status.latestMessage
    ? status.latestMessage.length > 60
      ? `${status.latestMessage.slice(0, 60)}…`
      : status.latestMessage
    : null;

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-center gap-2">
        <ArrowDownCircle
          size={16}
          strokeWidth={1.75}
          className="shrink-0 text-[var(--primary)]"
        />
        <span className="text-xs font-medium">Có bản cập nhật</span>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {status.behind} thay đổi{message ? ` — ${message}` : ""}
      </p>
      {notice && <p className="mt-1 text-xs text-[var(--danger)]">{notice}</p>}
      <button
        type="button"
        onClick={onApply}
        className="btn btn-primary btn-sm mt-2 w-full"
      >
        Cập nhật
      </button>
    </div>
  );
}
