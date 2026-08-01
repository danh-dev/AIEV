"use client";

/**
 * Chi tiết một phiên "Auto cut videos": kế hoạch cắt (duyệt/sửa từng đoạn),
 * tiến trình realtime của job và kết quả (link tới project con đã tạo).
 *
 * Vì bước cắt tốn thời gian encode, người dùng được DUYỆT danh sách đoạn trước:
 * bỏ tích đoạn không cần, sửa tiêu đề (tiêu đề này thành tên project con).
 */

import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  RefreshCw,
  Scissors,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cutAutoCut,
  deleteAutoCut,
  getAutoCutSession,
  getJobs,
  isAutoCutJob,
  planAutoCut,
  updateAutoCut,
  type AutoCutMeta,
  type AutoCutSegment,
  type AutoCutSegmentPatch,
  type Brief,
  type Job,
} from "@/lib/api";
import { useJobEvents } from "@/lib/useEvents";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { PageHeader } from "@/components/PageHeader";
import { ProgressBar } from "@/components/ProgressBar";
import {
  AutoCutStatusBadge,
  LAYOUT_LABEL,
  MODE_LABEL,
  aspectLabel,
  clock,
  duration,
} from "@/components/AutoCutCommon";
import { BriefFields, DEFAULT_BRIEF } from "@/components/BriefFields";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

/** Gộp nhiều lần gõ phím thành một PATCH - không bắn request mỗi ký tự. */
const PATCH_DEBOUNCE_MS = 700;

/** Tên file từ đường dẫn tương đối (imports/abc.mp4 → abc.mp4). */
function baseName(relPath: string): string {
  const parts = relPath.split(/[\\/]/);
  return parts[parts.length - 1] || relPath;
}

export default function AutoCutDetailPage() {
  const { t, tf } = useT();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<AutoCutMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bản nháp các đoạn ở client - người dùng gõ tiêu đề / bỏ tích thấy ngay,
  // PATCH đi sau (debounce). Chỉ đồng bộ lại từ server khi CHƯA có sửa đổi
  // đang chờ gửi, để không nuốt mất chữ người dùng vừa gõ.
  const [segments, setSegments] = useState<AutoCutSegment[]>([]);
  const pending = useRef(new Map<number, AutoCutSegmentPatch>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Kịch bản edit của cả phiên - cùng cơ chế nháp + debounce như các đoạn, và đi
  // chung một PATCH để hai thứ sửa cùng lúc không đè nhau.
  const [brief, setBrief] = useState<Brief | null>(null);
  const pendingBrief = useRef<Partial<Brief> | null>(null);

  // Job auto-cut mới nhất của phiên - nguồn hiển thị % và tên bước
  const [job, setJob] = useState<Job | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await getAutoCutSession(sessionId);
      setSession(s);
      if (pending.current.size === 0) setSegments(s.segments);
      // Phiên tạo trước khi backend có brief → thiếu field, lấp bằng default
      if (!pendingBrief.current) setBrief({ ...DEFAULT_BRIEF, ...(s.brief ?? {}) });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  // Seed job đang chạy (mở trang giữa chừng vẫn thấy tiến trình)
  useEffect(() => {
    let alive = true;
    getJobs(50)
      .then((list) => {
        const mine = list.filter((j) => isAutoCutJob(j, sessionId));
        if (alive && mine.length > 0) setJob(mine[0]);
      })
      .catch(() => {
        // không lấy được jobs cũng không chặn trang - SSE vẫn cập nhật tiếp
      });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  useJobEvents((j) => {
    if (!isAutoCutJob(j, sessionId)) return;
    setJob(j);
    if (["done", "failed", "canceled"].includes(j.status)) load();
  });

  // ---- Sửa đoạn: gộp thay đổi rồi PATCH một lần ----

  const flush = useCallback(async () => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    if (pending.current.size === 0 && !pendingBrief.current) return;
    const patches = [...pending.current.values()];
    const briefPatch = pendingBrief.current;
    pending.current.clear();
    pendingBrief.current = null;
    try {
      const s = await updateAutoCut(sessionId, {
        ...(patches.length > 0 ? { segments: patches } : {}),
        ...(briefPatch ? { brief: briefPatch } : {}),
      });
      setSession(s);
      setSaveError(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId]);

  // Rời trang khi còn thay đổi chưa gửi → gửi nốt
  useEffect(() => {
    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (pending.current.size > 0 || pendingBrief.current) {
        const patches = [...pending.current.values()];
        const briefPatch = pendingBrief.current;
        pending.current.clear();
        pendingBrief.current = null;
        updateAutoCut(sessionId, {
          ...(patches.length > 0 ? { segments: patches } : {}),
          ...(briefPatch ? { brief: briefPatch } : {}),
        }).catch(() => {
          // trang đã đóng - không còn chỗ hiện lỗi
        });
      }
    };
  }, [sessionId]);

  const queuePatch = useCallback(
    (patch: AutoCutSegmentPatch, immediate = false) => {
      const cur = pending.current.get(patch.index) ?? { index: patch.index };
      pending.current.set(patch.index, { ...cur, ...patch });
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (immediate) {
        flush();
      } else {
        flushTimer.current = setTimeout(flush, PATCH_DEBOUNCE_MS);
      }
    },
    [flush]
  );

  function setTitle(index: number, title: string) {
    setSegments((prev) =>
      prev.map((s) => (s.index === index ? { ...s, title } : s))
    );
    queuePatch({ index, title });
  }

  function setSelected(index: number, selected: boolean) {
    setSegments((prev) =>
      prev.map((s) => (s.index === index ? { ...s, selected } : s))
    );
    // Tích/bỏ tích là một hành động dứt khoát - gửi ngay, không chờ debounce
    queuePatch({ index, selected }, true);
  }

  /** Sửa kịch bản edit - gộp các patch rồi gửi chung một lần như phần đoạn. */
  function patchBrief(p: Partial<Brief>) {
    setBrief((b) => (b ? { ...b, ...p } : b));
    pendingBrief.current = { ...(pendingBrief.current ?? {}), ...p };
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, PATCH_DEBOUNCE_MS);
  }

  function toggleAll(next: boolean) {
    setSegments((prev) => prev.map((s) => ({ ...s, selected: next })));
    for (const s of segments) {
      const cur = pending.current.get(s.index) ?? { index: s.index };
      pending.current.set(s.index, { ...cur, selected: next });
    }
    flush();
  }

  // ---- Chạy bước ----

  async function run(step: "plan" | "cut") {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      // Gửi nốt sửa đổi đang chờ trước khi cắt - server phải thấy đúng lựa chọn
      await flush();
      const j = step === "plan" ? await planAutoCut(sessionId) : await cutAutoCut(sessionId);
      setJob(j);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAutoCut(sessionId);
      router.push("/auto-cut");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  if (!session) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("nav.auto-cut")} />
        {loadError ? (
          <ErrorBanner message={t("autocut.not-found")} detail={loadError} />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        )}
      </div>
    );
  }

  const running = session.status === "planning" || session.status === "cutting";
  const selectedCount = segments.filter((s) => s.selected).length;
  const allSelected = segments.length > 0 && selectedCount === segments.length;
  const createdCount = segments.filter((s) => s.projectId).length;
  // Đoạn đã chọn mà CHƯA có project con - chỉ những đoạn này mới thực sự cần cắt.
  // Không tính thì phiên đã xong vẫn mời bấm "Cắt & tạo project" rồi chạy một job
  // không làm gì, người dùng tưởng hỏng.
  const pendingCount = segments.filter((s) => s.selected && !s.projectId).length;
  // Bước cần chạy lại khi lỗi: đã có đoạn thì lỗi nằm ở bước cắt
  const retryStep: "plan" | "cut" = segments.length > 0 ? "cut" : "plan";
  const src = session.source;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={session.name}
        subtitle={`${baseName(src.relPath)} · ${src.width}x${src.height} · ${src.fps}fps · ${clock(
          src.durationSec
        )}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => router.push("/auto-cut")}>
              <ArrowLeft size={15} strokeWidth={2} />
              {t("autocut.back")}
            </Button>
            <Button
              variant="destructive"
              disabled={running}
              onClick={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
            >
              <Trash2 size={15} strokeWidth={2} />
              {t("common.delete")}
            </Button>
          </>
        }
      />

      {/* Tóm tắt cấu hình phiên - nhìn một dòng biết phiên này cắt kiểu gì */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          <AutoCutStatusBadge status={session.status} />
          <span className="chip">{t(MODE_LABEL[session.mode])}</span>
          <span className="chip">{aspectLabel(session.output.aspect, t)}</span>
          {session.output.aspect !== "keep" && (
            <span className="chip">{t(LAYOUT_LABEL[session.output.layout])}</span>
          )}
          {session.transcribe && <span className="chip">{t("autocut.transcribe")}</span>}
          {session.autoEdit && <span className="chip">{t("autocut.auto-edit")}</span>}
          <span className="ml-auto">
            {t("common.updated")}: {formatDateTime(session.updatedAt)}
          </span>
        </div>
      </Card>

      {loadError && (
        <ErrorBanner message={t("autocut.load-error")} detail={loadError} />
      )}
      {actionError && (
        <ErrorBanner message={t("autocut.action-error")} detail={actionError} />
      )}
      {saveError && (
        <ErrorBanner message={t("autocut.save-error")} detail={saveError} />
      )}

      {running && (
        <Card
          title={
            session.status === "planning"
              ? t("autocut.step-plan")
              : t("autocut.step-cut")
          }
        >
          <ProgressBar progress={job?.progress ?? 0} step={job?.step} />
          <p className="mt-2 flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Loader2 size={13} strokeWidth={2} className="animate-spin" />
            {session.status === "planning"
              ? t("autocut.planning-hint")
              : t("autocut.cutting-hint")}
          </p>
        </Card>
      )}

      {session.status === "failed" && (
        <Card>
          <ErrorBanner
            message={t("autocut.failed")}
            detail={session.error ?? undefined}
          />
          <div className="mt-3 flex justify-end">
            <Button disabled={busy} onClick={() => run(retryStep)}>
              <RefreshCw size={15} strokeWidth={2} />
              {retryStep === "plan" ? t("autocut.replan") : t("autocut.cut")}
            </Button>
          </div>
        </Card>
      )}

      {/* Kịch bản edit của cả phiên - đặt TRÊN danh sách đoạn vì nó quyết định
          mọi project con sẽ được edit thế nào */}
      {brief && (
        <Card
          title={
            <span className="inline-flex items-center gap-1.5">
              {t("autocut.brief-card")}
              <InfoHint
                titleKey="help.autocut-brief.title"
                bodyKey="help.autocut-brief.body"
                size={14}
              />
            </span>
          }
        >
          <div className="mb-3 flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            <p>{running ? t("autocut.brief-locked") : t("autocut.brief-hint")}</p>
            {createdCount > 0 && <p>{t("autocut.brief-applies-next")}</p>}
            {!running && <p>{t("autocut.brief-autosave")}</p>}
          </div>
          <BriefFields
            value={brief}
            onChange={patchBrief}
            // Style của phiên nằm ở cấu hình đầu ra; mô tả từng đoạn do server tự viết
            show={{ styleId: false, sourceDescription: false }}
            disabled={running}
          />
        </Card>
      )}

      <Card
        title={
          <span className="inline-flex items-center gap-1.5">
            {t("autocut.segments")}
            <InfoHint
              titleKey="help.autocut-segments.title"
              bodyKey="help.autocut-segments.body"
              size={14}
            />
          </span>
        }
        actions={
          !running && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" small disabled={busy} onClick={() => run("plan")}>
                <RefreshCw size={14} strokeWidth={2} />
                {segments.length > 0 ? t("autocut.replan") : t("autocut.plan")}
              </Button>
              {pendingCount > 0 && (
                <Button small disabled={busy} onClick={() => run("cut")}>
                  {busy ? (
                    <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                  ) : (
                    <Scissors size={14} strokeWidth={2} />
                  )}
                  {tf("autocut.cut-n", { n: pendingCount })}
                </Button>
              )}
            </div>
          )
        }
      >
        {segments.length === 0 ? (
          <EmptyState icon={Scissors} description={t("autocut.no-segment")} />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={allSelected}
                  disabled={running}
                  onChange={() => toggleAll(!allSelected)}
                />
                {t("autocut.select-all")}
              </label>
              <span className="text-xs text-[var(--text-muted)]">
                {tf("autocut.selected-count", { n: selectedCount })}
                {createdCount > 0
                  ? ` · ${tf("autocut.created-count", { n: createdCount })}`
                  : ""}
              </span>
            </div>

            <ul className="flex flex-col gap-1.5">
              {segments.map((s) => (
                <li
                  key={s.index}
                  className="flex items-start gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-2"
                >
                  <input
                    type="checkbox"
                    className="checkbox mt-2"
                    checked={s.selected}
                    disabled={running}
                    aria-label={tf("autocut.select-aria", { title: s.title })}
                    onChange={(e) => setSelected(s.index, e.target.checked)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-xs text-[var(--text-muted)]">
                        {clock(s.start)} - {clock(s.end)} ({duration(s.end - s.start)})
                      </span>
                      {typeof s.score === "number" && (
                        <span className="chip">
                          {tf("autocut.score", { score: s.score })}
                        </span>
                      )}
                      {s.appliedLayout && (
                        <span className="chip">{t(LAYOUT_LABEL[s.appliedLayout])}</span>
                      )}
                      {s.projectId && (
                        <Link
                          href={`/projects/${s.projectId}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                        >
                          <ExternalLink size={12} strokeWidth={2} />
                          {t("autocut.open-project")}
                        </Link>
                      )}
                    </div>
                    <input
                      className="input mt-1 h-8 text-[13px] font-semibold"
                      value={s.title}
                      disabled={running}
                      aria-label={tf("autocut.title-aria", { n: s.index + 1 })}
                      onChange={(e) => setTitle(s.index, e.target.value)}
                      onBlur={() => flush()}
                    />
                    {s.hook && (
                      <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-[var(--text-muted)]">
                        {s.hook}
                      </p>
                    )}
                    {s.reason && (
                      <p className="line-clamp-2 text-xs leading-snug text-[var(--text-muted)]">
                        {s.reason}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("autocut.delete-title")}
        description={<p>{t("autocut.delete-desc")}</p>}
        items={[`${session.name} - ${session.source.relPath}`]}
        busy={deleting}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDelete}
      />
    </div>
  );
}
