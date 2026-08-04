"use client";

/**
 * Chi tiết một phiên "Auto cut videos" - lắp bằng bộ khối workspace 3 cột dùng
 * chung (`components/Workspace.tsx`), chia theo NHỊP LÀM VIỆC chứ không theo số
 * bước:
 *
 * - Cột `source`: video dài gốc và thông số đo được của nó - thứ mình BẮT ĐẦU
 *   TỪ ĐÓ.
 * - Cột `setup`: cách cắt + tham số, kịch bản edit áp cho MỌI project con, và
 *   kế hoạch cắt (duyệt/sửa/bỏ tích từng đoạn) - "mình muốn ra cái gì".
 * - Cột `output`: khối kết quả ĐỨNG ĐẦU rồi mới tới nhật ký job.
 *
 * Khác mọi trang chi tiết còn lại: phiên này KHÔNG đẻ ra một video thành phẩm mà
 * đẻ ra NHIỀU Videos Project con. Nên khối đầu cột kết quả không dùng
 * `OutputBlock` (khung video + nút tải) mà là một khối cùng vai trò: đang chạy
 * thì thanh tiến trình + chữ chờ, xong thì danh sách project con bấm vào mở được
 * ngay. Dùng OutputBlock ở đây sẽ hiện "Đã xong nhưng chưa có file video" - đúng
 * kỹ thuật nhưng sai hoàn toàn về nghĩa.
 *
 * Vì bước cắt tốn thời gian encode, người dùng được DUYỆT danh sách đoạn trước:
 * bỏ tích đoạn không cần, sửa tiêu đề (tiêu đề này thành tên project con).
 *
 * Phiên xong (status "done") thì các khối khác tự gấp lại còn một dòng tóm tắt,
 * riêng khối kết quả vẫn mở. Gấp/mở vẫn bấm tay được và ý người dùng luôn thắng
 * mặc định - xem `useCollapseGroup`.
 */

import {
  ArrowLeft,
  Clapperboard,
  ExternalLink,
  FileText,
  FileVideo,
  Loader2,
  RefreshCw,
  Scissors,
  ScrollText,
  Settings2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cutAutoCut,
  deleteAutoCut,
  getAutoCutSession,
  getJob,
  getJobs,
  isAutoCutJob,
  mediaUrl,
  planAutoCut,
  updateAutoCut,
  type AutoCutMeta,
  type AutoCutSegment,
  type AutoCutSegmentPatch,
  type Brief,
  type Job,
} from "@/lib/api";
import { useEvents, useJobEvents, useJobLogEvents } from "@/lib/useEvents";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { PageHeader } from "@/components/PageHeader";
import { ProgressBar } from "@/components/ProgressBar";
import {
  useCollapseGroup,
  Workspace,
  WorkspaceBlock,
  WorkspaceColumn,
} from "@/components/Workspace";
import {
  AutoCutStatusBadge,
  BACKGROUND_LABEL,
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

/** Các khối của phiên - key vừa là id state gấp/mở vừa là id vùng nội dung. */
const AC_BLOCKS = ["source", "config", "brief", "plan", "result", "job"] as const;
type BlockKey = (typeof AC_BLOCKS)[number];

/**
 * Khối vẫn MỞ khi phiên xong: danh sách project con. Xong việc thì người dùng vào
 * trang là để mở các project vừa cắt ra, không phải để sửa kế hoạch nữa.
 */
const AC_KEEP_EXPANDED: readonly BlockKey[] = ["result"];

/** Tên file từ đường dẫn tương đối (imports/abc.mp4 → abc.mp4). */
function baseName(relPath: string): string {
  const parts = relPath.split(/[\\/]/);
  return parts[parts.length - 1] || relPath;
}

/**
 * Khối log của job - đúng nội dung trang Render Queue hiển thị: tiến trình + từng
 * dòng log chảy về qua SSE `joblog`.
 */
function JobLogBlock({ job }: { job: Job }) {
  const { t } = useT();
  const jobId = job.id;
  // SSE nối lại sau khi đứt → refetch log để lấp các dòng đã lỡ
  const { resyncTick } = useEvents();
  const [log, setLog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let alive = true;
    setLog("");
    setError(null);
    getJob(jobId)
      .then((j) => {
        if (!alive) return;
        const fetched = j.log ?? "";
        // Trong lúc chờ fetch, SSE có thể đã đổ thêm dòng vào state - GHÉP chứ
        // không ghi đè, kẻo mất đúng những dòng mới nhất người dùng đang nhìn.
        setLog((prev) => {
          if (!prev) return fetched;
          if (!fetched) return prev;
          // Bản fetch thường đã chứa các dòng SSE vừa tới (fetch trả sau)
          if (fetched === prev || fetched.endsWith(prev)) return fetched;
          return `${fetched}\n${prev}`;
        });
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [jobId, resyncTick]);

  // Dòng log mới qua SSE
  useJobLogEvents((e) => {
    if (e.jobId !== jobId) return;
    setLog((prev) => (prev ? `${prev}\n${e.line}` : e.line));
  });

  // Auto-scroll xuống cuối
  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">{t("autocut.job")}</span>
        <span className="text-xs text-[var(--text-muted)]">{job.status}</span>
      </div>
      <ProgressBar progress={job.progress} step={job.step} />
      {error && <ErrorBanner message={t("autocut.job-log-error")} detail={error} />}
      {/* break-anywhere BẮT BUỘC: log ffmpeg/whisper có những chuỗi dài không một
          khoảng trắng (đường dẫn, filtergraph), mà `pre-wrap` chỉ ngắt ở khoảng
          trắng nên chúng đẩy toác cả cột. */}
      <pre
        ref={preRef}
        className="max-h-48 min-h-16 min-w-0 overflow-auto rounded-[var(--radius)] bg-[var(--bg-subtle)] p-2 font-mono text-[11px] whitespace-pre-wrap [overflow-wrap:anywhere]"
      >
        {log || t("autocut.job-no-log")}
      </pre>
    </div>
  );
}

/** Một dòng "nhãn - giá trị" trong khối cấu hình phiên. */
function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-32 shrink-0 text-[var(--text-muted)]">{label}</span>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}

export default function AutoCutDetailPage() {
  const { t, tf } = useT();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  // SSE đứt rồi nối lại → refetch dữ liệu seed để status không kẹt "đang chạy"
  const { resyncTick } = useEvents();

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

  // Gấp/mở từng khối. Mặc định suy từ "phiên đã xong chưa" NGAY TRONG LÚC RENDER,
  // cố tình KHÔNG có useEffect nào đồng bộ trạng thái gấp theo status: trang này
  // bám SSE job, mỗi dòng log hay mỗi lần job đổi tiến trình là một lần render
  // mới. Effect kiểu đó sẽ đóng sập đúng cái khối người dùng vừa mở ra, mà lỗi ấy
  // trông như trang tự nhiên "nhảy" chứ không ai đoán ra là do SSE.
  //
  // Gọi trước mọi lối thoát sớm (loading/lỗi) - thứ tự hook phải giống nhau ở
  // mọi lần render.
  const group = useCollapseGroup({
    keys: AC_BLOCKS,
    finished: session?.status === "done",
    keepExpanded: AC_KEEP_EXPANDED,
  });

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
  }, [load, resyncTick]);

  // Seed job đang chạy (mở trang giữa chừng vẫn thấy tiến trình).
  // resyncTick: refetch sau khi SSE nối lại để bắt kịp job đã đổi trạng thái.
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
  }, [sessionId, resyncTick]);

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
  // Server chỉ nhận PATCH segments ở trạng thái draft/planned - các trạng thái
  // khác (done/failed/đang chạy) mà cho sửa là banner lỗi + state lệch server.
  const canEditSegments =
    session.status === "draft" || session.status === "planned";
  const selectedCount = segments.filter((s) => s.selected).length;
  const allSelected = segments.length > 0 && selectedCount === segments.length;
  const created = segments.filter((s) => s.projectId);
  const createdCount = created.length;
  // Đoạn đã chọn mà CHƯA có project con - chỉ những đoạn này mới thực sự cần cắt.
  // Không tính thì phiên đã xong vẫn mời bấm "Cắt & tạo project" rồi chạy một job
  // không làm gì, người dùng tưởng hỏng.
  const pendingCount = segments.filter((s) => s.selected && !s.projectId).length;
  // Bước cần chạy lại khi lỗi: server ghi rõ failedStep - chỉ lỗi ở bước cắt
  // mới cắt lại được ngay; re-plan lỗi thì segments là của kế hoạch CŨ, phải plan lại
  const retryStep: "plan" | "cut" =
    session.failedStep === "cut" && segments.length > 0 ? "cut" : "plan";
  const src = session.source;
  const sourceUrl = `${mediaUrl(src.relPath)}?v=${encodeURIComponent(
    session.updatedAt
  )}`;
  const params_ = session.params;

  // ---- Một dòng tóm tắt cho từng khối lúc gấp ----

  const sourceSummary = [
    baseName(src.relPath),
    `${src.width}x${src.height}`,
    clock(src.durationSec),
    `${src.fps}fps`,
  ].join(" · ");
  const configSummary = [
    t(MODE_LABEL[session.mode]),
    aspectLabel(session.output.aspect, t),
    session.output.aspect !== "keep" ? t(LAYOUT_LABEL[session.output.layout]) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const briefSummary =
    brief?.notes.trim().slice(0, 120) || t("brief.none");
  const planSummary =
    segments.length > 0
      ? tf("autocut.selected-count", { n: selectedCount })
      : t("autocut.no-segment-short");
  const resultSummary =
    createdCount > 0
      ? tf("autocut.created-count", { n: createdCount })
      : t("autocut.no-project-yet-short");
  const jobSummary = job ? `${job.type} · ${job.status}` : t("autocut.job-no-log");

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
          {createdCount > 0 && (
            <span className="chip">
              {tf("autocut.created-count", { n: createdCount })}
            </span>
          )}
          {session.status === "done" && group.anyCollapsed && (
            <span className="min-w-0">{t("workspace.done-collapsed")}</span>
          )}
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
      {session.status === "failed" && (
        <ErrorBanner
          message={t("autocut.failed")}
          detail={session.error ?? undefined}
        />
      )}

      {/* Ba cột theo nhịp làm việc: nguồn → yêu cầu & thiết lập → tiến trình &
          kết quả. Số cột do container query trong globals.css lo, trang không tự
          tính pixel. */}
      <Workspace>
        {/* ================= Cột 1: nguồn ================= */}
        <WorkspaceColumn role="source" title={t("workspace.col.source")}>
          <WorkspaceBlock
            id="ac-block-source"
            icon={FileVideo}
            collapsed={group.isCollapsed("source")}
            onToggle={() => group.toggle("source")}
            summary={sourceSummary}
            title={t("autocut.source")}
          >
            <div className="flex flex-col gap-3">
              <video
                controls
                preload="metadata"
                src={sourceUrl}
                className="max-h-[360px] w-full rounded-[var(--radius)] bg-[var(--bg-subtle)]"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="chip">
                  {src.width}x{src.height}
                </span>
                <span className="chip">{clock(src.durationSec)}</span>
                <span className="chip">{src.fps} fps</span>
                {src.rotation !== 0 && (
                  <span className="chip">{src.rotation}°</span>
                )}
              </div>
              <p className="min-w-0 text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">
                {src.relPath}
              </p>
              {session.transcriptRel && (
                <span className="chip w-fit min-w-0">
                  <span className="min-w-0 truncate">
                    {t("autocut.transcript-file")}: {session.transcriptRel}
                  </span>
                </span>
              )}
            </div>
          </WorkspaceBlock>
        </WorkspaceColumn>

        {/* ============ Cột 2: yêu cầu & thiết lập ============ */}
        <WorkspaceColumn role="setup" title={t("workspace.col.setup")}>
          {/* Cách cắt + khung hình: chốt lúc tạo phiên nên chỉ ĐỌC ở đây - bày ô
              sửa mà server không nhận thì tệ hơn là không bày */}
          <WorkspaceBlock
            id="ac-block-config"
            icon={Settings2}
            collapsed={group.isCollapsed("config")}
            onToggle={() => group.toggle("config")}
            summary={configSummary}
            title={t("autocut.card-config")}
          >
            <div className="flex flex-col gap-2">
              <ConfigRow label={t("autocut.how")} value={t(MODE_LABEL[session.mode])} />
              {session.mode === "time" && (
                <>
                  {params_.minutes !== undefined && (
                    <ConfigRow
                      label={t("autocut.minutes")}
                      value={String(params_.minutes)}
                    />
                  )}
                  {params_.overlapSec !== undefined && (
                    <ConfigRow
                      label={t("autocut.overlap")}
                      value={String(params_.overlapSec)}
                    />
                  )}
                </>
              )}
              {session.mode !== "time" && (
                <>
                  {params_.count !== undefined && (
                    <ConfigRow
                      label={t("autocut.count")}
                      value={String(params_.count)}
                    />
                  )}
                  {params_.minSec !== undefined && (
                    <ConfigRow
                      label={t("autocut.min-sec")}
                      value={String(params_.minSec)}
                    />
                  )}
                  {params_.maxSec !== undefined && (
                    <ConfigRow
                      label={t("autocut.max-sec")}
                      value={String(params_.maxSec)}
                    />
                  )}
                  {params_.request && (
                    <ConfigRow
                      label={t("autocut.request")}
                      value={params_.request}
                    />
                  )}
                </>
              )}
              <ConfigRow
                label={t("autocut.aspect")}
                value={aspectLabel(session.output.aspect, t)}
              />
              {session.output.aspect !== "keep" && (
                <>
                  <ConfigRow
                    label={t("autocut.layout")}
                    value={t(LAYOUT_LABEL[session.output.layout])}
                  />
                  <ConfigRow
                    label={t("autocut.background")}
                    value={t(BACKGROUND_LABEL[session.output.background])}
                  />
                </>
              )}
              <ConfigRow
                label={t("autocut.transcribe")}
                value={session.transcribe ? t("common.yes") : t("common.no")}
              />
              <ConfigRow
                label={t("autocut.auto-edit")}
                value={session.autoEdit ? t("common.yes") : t("common.no")}
              />
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {t("autocut.config-readonly")}
              </p>
            </div>
          </WorkspaceBlock>

          {/* Kịch bản edit của cả phiên - đặt TRÊN kế hoạch cắt vì nó quyết định
              mọi project con sẽ được edit thế nào */}
          <WorkspaceBlock
            id="ac-block-brief"
            icon={FileText}
            collapsed={group.isCollapsed("brief")}
            onToggle={() => group.toggle("brief")}
            summary={briefSummary}
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
            {brief ? (
              <>
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
              </>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">
                {t("common.loading")}
              </p>
            )}
          </WorkspaceBlock>

          {/* Kế hoạch cắt: duyệt/sửa/bỏ tích từng đoạn rồi bấm cắt */}
          <WorkspaceBlock
            id="ac-block-plan"
            icon={Scissors}
            collapsed={group.isCollapsed("plan")}
            onToggle={() => group.toggle("plan")}
            summary={planSummary}
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
                  <Button
                    variant="secondary"
                    small
                    disabled={busy}
                    onClick={() => run("plan")}
                  >
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
                      disabled={!canEditSegments}
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
                        disabled={!canEditSegments}
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
                          disabled={!canEditSegments}
                          aria-label={tf("autocut.title-aria", { n: s.index + 1 })}
                          onChange={(e) => setTitle(s.index, e.target.value)}
                          onBlur={() => flush()}
                        />
                        {/* hook/reason là chữ tự do của AI - phải cho ngắt giữa từ,
                            không thì một chuỗi dài đẩy toác cả cột */}
                        {s.hook && (
                          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-[var(--text-muted)] [overflow-wrap:anywhere]">
                            {s.hook}
                          </p>
                        )}
                        {s.reason && (
                          <p className="line-clamp-2 text-xs leading-snug text-[var(--text-muted)] [overflow-wrap:anywhere]">
                            {s.reason}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </WorkspaceBlock>
        </WorkspaceColumn>

        {/* ============ Cột 3: tiến trình & kết quả ============ */}
        <WorkspaceColumn role="output" title={t("workspace.col.output")}>
          {/* Khối ĐẦU TIÊN của cột - vai trò của OutputBlock ở các trang khác:
              đang chạy thì thanh tiến trình + chữ chờ, xong thì chính "thành
              phẩm" của phiên này, tức là danh sách project con bấm vào mở được. */}
          <WorkspaceBlock
            id="ac-block-result"
            icon={Clapperboard}
            collapsed={group.isCollapsed("result")}
            onToggle={() => group.toggle("result")}
            summary={resultSummary}
            title={t("autocut.card-result")}
            actions={
              session.status === "failed" ? (
                <Button small disabled={busy} onClick={() => run(retryStep)}>
                  <RefreshCw size={14} strokeWidth={2} />
                  {retryStep === "plan" ? t("autocut.replan") : t("autocut.cut")}
                </Button>
              ) : undefined
            }
          >
            <div className="flex flex-col gap-3">
              {running && (
                <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
                  <span className="text-xs font-semibold">
                    {session.status === "planning"
                      ? t("autocut.step-plan")
                      : t("autocut.step-cut")}
                  </span>
                  <ProgressBar progress={job?.progress ?? 0} step={job?.step} />
                  <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <Loader2
                      size={13}
                      strokeWidth={2}
                      className="shrink-0 animate-spin"
                    />
                    <span className="min-w-0">
                      {session.status === "planning"
                        ? t("autocut.planning-hint")
                        : t("autocut.cutting-hint")}
                    </span>
                  </p>
                </div>
              )}

              {created.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {created.map((s) => (
                    <li
                      key={s.index}
                      className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-2"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="min-w-0 truncate text-[13px] font-semibold">
                          {s.title}
                        </span>
                        <span className="font-mono text-xs text-[var(--text-muted)]">
                          {clock(s.start)} - {clock(s.end)} (
                          {duration(s.end - s.start)})
                        </span>
                      </span>
                      <Link
                        href={`/projects/${s.projectId}`}
                        className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                      >
                        <ExternalLink size={12} strokeWidth={2} />
                        {t("autocut.open-project")}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                !running && (
                  <EmptyState
                    icon={Clapperboard}
                    description={t("autocut.no-project-yet")}
                  />
                )
              )}
            </div>
          </WorkspaceBlock>

          {/* Nhật ký job phân tích/cắt - thứ SINH RA trong lúc chạy, đúng chỗ */}
          <WorkspaceBlock
            id="ac-block-job"
            icon={ScrollText}
            collapsed={group.isCollapsed("job")}
            onToggle={() => group.toggle("job")}
            summary={jobSummary}
            title={t("autocut.card-job")}
          >
            {job ? (
              <JobLogBlock job={job} />
            ) : (
              <p className="text-xs text-[var(--text-muted)]">
                {t("autocut.job-no-log")}
              </p>
            )}
          </WorkspaceBlock>
        </WorkspaceColumn>
      </Workspace>

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
