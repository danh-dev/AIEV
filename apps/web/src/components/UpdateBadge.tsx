"use client";

import { ArrowDownCircle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, applyUpdate, checkUpdate, type UpdateStatus } from "@/lib/api";
import { useT } from "@/lib/i18n";

const CHECK_MS = 5 * 60 * 1000; // check bản mới mỗi 5 phút
const HEALTH_POLL_MS = 5_000; // poll /api/health trong lúc update

/**
 * Badge cuối sidebar: báo có bản cập nhật từ GitHub + nút bấm tự kéo về.
 * Sau khi apply: chờ server CHẾT (script update kill) rồi SỐNG lại → reload trang.
 */
export function UpdateBadge() {
  const { t, tf } = useT();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [updating, setUpdating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
      // Không kết nối được backend — im lặng, sidebar không được vỡ
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
    const ok = window.confirm(t("update.confirm"));
    if (!ok) return;
    setNotice(null);
    try {
      await applyUpdate();
      setUpdating(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "JOB_RUNNING") {
        setNotice(t("update.job-running"));
      } else {
        setNotice(
          err instanceof ApiError ? err.message : t("update.send-failed")
        );
      }
    }
  }

  if (updating) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="text-xs font-medium">{t("update.updating")}</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t("update.will-reload")}
        </p>
        <div className="progress-indeterminate mt-2" aria-label={t("update.updating")} />
      </div>
    );
  }

  if (!status) return null;

  // Ưu tiên card cập nhật: dù fetch lỗi, refs cũ vẫn có thể biết behind > 0
  if (status.upToDate) {
    const checkFailed = Boolean(status.error) || status.fetchOk === false;
    if (checkFailed) {
      return (
        <div className="flex items-center gap-1 px-2">
          <span
            className="text-xs text-[var(--danger)] opacity-80"
            title={status.error ?? t("update.check-failed")}
          >
            {t("update.check-failed")}
          </span>
          <button
            type="button"
            onClick={() => check(true)}
            disabled={checking}
            className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--text-muted)] underline transition-colors hover:text-[var(--text)] disabled:opacity-60"
            title={t("update.check-now")}
          >
            {checking && (
              <Loader2 size={12} strokeWidth={2} className="animate-spin" />
            )}
            {t("common.retry")}
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => check(true)}
        disabled={checking}
        title={t("update.click-check")}
        className="inline-flex items-center gap-1 px-2 text-left text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)] disabled:opacity-60"
      >
        {checking && (
          <Loader2 size={12} strokeWidth={2} className="animate-spin" />
        )}
        {t("update.up-to-date")}{status.current ? ` · ${status.current}` : ""}
      </button>
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
        <span className="text-xs font-medium">{t("update.available")}</span>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {tf("update.behind", { n: status.behind })}{message ? ` — ${message}` : ""}
      </p>
      {notice && <p className="mt-1 text-xs text-[var(--danger)]">{notice}</p>}
      <button
        type="button"
        onClick={onApply}
        className="btn btn-primary btn-sm mt-2 w-full"
      >
        {t("update.apply")}
      </button>
    </div>
  );
}
