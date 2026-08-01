"use client";

import {
  Check,
  Clapperboard,
  Copy,
  ExternalLink,
  Film,
  Maximize2,
  FileQuestion,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Minus,
  MonitorPlay,
  MoreHorizontal,
  Music,
  Play,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  cleanProjectJunk,
  createJob,
  createThumbnail,
  deleteProject,
  getChatSessions,
  getJobs,
  getProject,
  getProjectJunk,
  mediaUrl,
  startProjectEdit,
  updateBrief,
  updateProjectTags,
  type AgentEffort,
  type Brief,
  type ChatSession,
  type FileInfo,
  type Job,
  type JobType,
  type ProjectDetail,
  type SceneMeta,
} from "@/lib/api";
import { useAgentEvents, useJobEvents } from "@/lib/useEvents";
import { Card } from "@/components/Card";
import { ProjectBadge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { ChatThread } from "@/components/ChatThread";
import { CloneProjectModal } from "@/components/CloneProjectModal";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import {
  AiModelBlock,
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
} from "@/components/ModelPicker";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import {
  MediaPreviewModal,
  RevealButton,
  canPreview,
} from "@/components/MediaPreviewModal";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { deriveStage, PipelineTimeline } from "@/components/PipelineTimeline";
import {
  DEFAULT_BRIEF,
  ProjectBriefCard,
  SFX_MODE_LABEL,
} from "@/components/ProjectBriefCard";
import { ProjectAssetsCard } from "@/components/ProjectAssetsCard";
import { ProjectClipsCard } from "@/components/ProjectClipsCard";
import { ProjectReviewCard } from "@/components/ProjectReviewCard";
import { ProjectPublishCard } from "@/components/ProjectPublishCard";
import { ProjectQcCard } from "@/components/ProjectQcCard";
import { styleDisplayName, useStyles } from "@/components/StyleSelect";
import { formatBytes, formatRelative, isRecentFile } from "@/lib/format";
import {
  SessionStatusBadge,
  sessionStatusLabel,
} from "@/components/SessionStatusBadge";
import { useT } from "@/lib/i18n";

function KindIcon({ kind }: { kind: FileInfo["kind"] }) {
  const cls = "shrink-0 text-[var(--text-muted)]";
  switch (kind) {
    case "video":
      return <Film size={15} strokeWidth={1.75} className={cls} />;
    case "audio":
      return <Music size={15} strokeWidth={1.75} className={cls} />;
    case "image":
      return <ImageIcon size={15} strokeWidth={1.75} className={cls} />;
    default:
      return <FileText size={15} strokeWidth={1.75} className={cls} />;
  }
}

/** File render của một scene - ưu tiên bản final trước draft. */
function sceneRenderFile(scene: SceneMeta, renders: FileInfo[]): FileInfo | null {
  return (
    renders.find((f) => f.name === `${scene.id}.mp4`) ??
    renders.find((f) => f.name === `${scene.id}.draft.mp4`) ??
    null
  );
}

/** Bảng file render - click hàng mở modal preview lớn, nút Mở file reveal trong Explorer */
function FileTable({ files }: { files: FileInfo[] }) {
  const { t, tf } = useT();
  const [preview, setPreview] = useState<FileInfo | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  if (files.length === 0) {
    return (
      <EmptyState icon={FileQuestion} description={t("project.no-files")} />
    );
  }
  return (
    <>
      {revealError && (
        <p className="mb-2 text-xs text-[var(--danger)]">{revealError}</p>
      )}
      {/* Bảng rộng hơn card trên màn nhỏ → cuộn ngang trong khối, không tràn */}
      <div className="overflow-x-auto">
      <table className="table min-w-[420px]">
        <thead>
          <tr>
            <th>File</th>
            <th>{t("common.size")}</th>
            <th>{t("common.modified")}</th>
            <th aria-label={t("project.actions-aria")} />
          </tr>
        </thead>
        <tbody>
          {files.map((f) => {
            const previewable = canPreview(f.kind);
            return (
              <tr
                key={f.relPath}
                className={previewable ? "row-click" : undefined}
                onClick={previewable ? () => setPreview(f) : undefined}
              >
                <td>
                  <span className="flex items-center gap-2">
                    <KindIcon kind={f.kind} />
                    {f.name}
                    {isRecentFile(f.mtime) && (
                      <span className="rounded-full bg-[var(--primary-soft)] px-1.5 py-0.5 text-[11px] font-medium leading-none text-[var(--primary)]">
                        {t("common.new")}
                      </span>
                    )}
                  </span>
                </td>
                <td className="text-[var(--text-muted)]">{formatBytes(f.size)}</td>
                <td className="text-[var(--text-muted)]">{formatRelative(f.mtime)}</td>
                <td className="text-right">
                  <RevealButton
                    relPath={f.relPath}
                    onError={setRevealError}
                    className="ml-auto"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <MediaPreviewModal file={preview} onClose={() => setPreview(null)} />
    </>
  );
}

/**
 * Card Video output - trạng thái "AI đang tạo video" (phiên running) hiện TRÊN,
 * video đã có (project.output) hiện DƯỚI; chưa có gì thì empty state nhỏ.
 * Kèm khu Thumbnail: ảnh bìa đã tạo + nút "Tạo thumbnail" (POST đồng bộ ~1 phút).
 */
function VideoOutputCard({
  projectId,
  projectName,
  output,
  thumbnail,
  aiRunning,
  version,
  onChanged,
}: {
  projectId: string;
  projectName?: string;
  output: string | null | undefined;
  /** "thumbnail.png" nếu đã có - null/undefined = chưa tạo */
  thumbnail?: string | null;
  aiRunning: boolean;
  /** updatedAt của project - cache-bust vì file draft ghi đè cùng tên */
  version?: string;
  /** Gọi sau khi tạo thumbnail xong để reload project */
  onChanged: () => void;
}) {
  const { t, tf } = useT();
  const fileName = output ? output.split(/[\\/]/).pop() : null;
  const outputUrl = output
    ? mediaUrl(output) + (version ? `?v=${encodeURIComponent(version)}` : "")
    : "";
  const [zoomed, setZoomed] = useState(false);

  // ---- Thumbnail ----------------------------------------------------------
  const thumbRel = `video-projects/${projectId}/${thumbnail ?? "thumbnail.png"}`;
  const thumbUrl =
    mediaUrl(thumbRel) + (version ? `?v=${encodeURIComponent(version)}` : "");
  // FileInfo tối thiểu cho MediaPreviewModal (mtime chỉ dùng cache-bust)
  const thumbFile: FileInfo = {
    name: "thumbnail.png",
    relPath: thumbRel,
    size: 0,
    mtime: version ?? "",
    kind: "image",
  };
  const [thumbPreview, setThumbPreview] = useState(false);
  const [thumbRevealError, setThumbRevealError] = useState<string | null>(null);
  // Modal "Tạo thumbnail"
  const [thumbOpen, setThumbOpen] = useState(false);
  const [thumbTitle, setThumbTitle] = useState("");
  const [thumbFrameAt, setThumbFrameAt] = useState("1");
  const [thumbPrompt, setThumbPrompt] = useState("");
  const [thumbBusy, setThumbBusy] = useState(false);
  const [thumbError, setThumbError] = useState<string | null>(null);

  function openThumbModal() {
    setThumbTitle(projectName ?? projectId);
    setThumbFrameAt("1");
    setThumbPrompt("");
    setThumbError(null);
    setThumbOpen(true);
  }

  async function onCreateThumb() {
    const title = thumbTitle.trim();
    if (!title || thumbBusy) return;
    setThumbBusy(true);
    setThumbError(null);
    try {
      const frameAt = Number(thumbFrameAt);
      await createThumbnail(projectId, {
        title,
        ...(Number.isFinite(frameAt) && frameAt >= 0 ? { frameAt } : {}),
        ...(thumbPrompt.trim() ? { bgPrompt: thumbPrompt.trim() } : {}),
      });
      setThumbOpen(false);
      onChanged();
    } catch (e) {
      setThumbError(e instanceof Error ? e.message : String(e));
    } finally {
      setThumbBusy(false);
    }
  }

  // Đóng lightbox bằng Escape
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-1.5">
          {t("project.video-output")}
          <InfoHint
            titleKey="help.video-output.title"
            bodyKey="help.video-output.body"
            size={14}
          />
        </span>
      }
    >
      {aiRunning && (
        <div
          className={`flex flex-col gap-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 ${
            output ? "mb-3" : ""
          }`}
        >
          <div className="progress-indeterminate" aria-label={t("project.ai-making")} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-[var(--text-muted)]">
              {t("project.ai-making-ellipsis")}
            </span>
            <SessionStatusBadge status="running" />
          </div>
        </div>
      )}
      {output ? (
        <div className="flex flex-col gap-2">
          <video
            controls
            src={outputUrl}
            className="mx-auto max-h-[300px] max-w-full rounded-[var(--radius)] bg-[var(--bg-subtle)]"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-muted)]">
              {fileName}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setZoomed(true)}
                className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
              >
                <Maximize2 size={13} strokeWidth={2} />
                {t("common.zoom")}
              </button>
              <a
                href={outputUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
              >
                <ExternalLink size={13} strokeWidth={2} />
                {t("common.open-file")}
              </a>
            </span>
          </div>
        </div>
      ) : !aiRunning ? (
        <EmptyState icon={MonitorPlay} description={t("project.no-output")} />
      ) : null}

      {/* Khu Thumbnail - ảnh bìa của video (POST /api/projects/:id/thumbnail) */}
      {(output || thumbnail) && (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--text-muted)]">
              Thumbnail
            </span>
            {/* (i) đặt NGOÀI nút - lồng button trong button là HTML không hợp lệ */}
            <span className="flex shrink-0 items-center gap-1.5">
              <Button variant="secondary" small onClick={openThumbModal}>
                <ImageIcon size={13} strokeWidth={2} />
                {t("project.create-thumb")}
              </Button>
              <InfoHint
                titleKey="help.thumbnail.title"
                bodyKey="help.thumbnail.body"
              />
            </span>
          </div>
          {thumbRevealError && (
            <p className="mt-2 text-xs text-[var(--danger)]">{thumbRevealError}</p>
          )}
          {thumbnail ? (
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setThumbPreview(true)}
                title={t("project.view-thumb")}
                className="shrink-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbUrl}
                  alt={t("project.thumb-alt")}
                  className="h-24 w-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] object-contain transition-opacity duration-150 hover:opacity-85"
                />
              </button>
              <RevealButton
                relPath={thumbRel}
                onError={setThumbRevealError}
              />
            </div>
          ) : (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              {t("project.no-thumb")}
            </p>
          )}
        </div>
      )}

      {/* Preview thumbnail lớn */}
      <MediaPreviewModal
        file={thumbPreview ? thumbFile : null}
        onClose={() => setThumbPreview(false)}
      />

      {/* Modal "Tạo thumbnail" - chạy đồng bộ ~1 phút */}
      <Modal
        title={t("project.create-thumb")}
        open={thumbOpen}
        onClose={() => {
          if (!thumbBusy) setThumbOpen(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setThumbOpen(false)}
              disabled={thumbBusy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={onCreateThumb}
              disabled={thumbBusy || !thumbTitle.trim()}
            >
              {thumbBusy ? (
                <>
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                  {t("project.thumb-creating")}
                </>
              ) : (
                <>
                  <ImageIcon size={14} strokeWidth={2} />
                  {t("project.create-thumb")}
                </>
              )}
            </Button>
          </>
        }
      >
        <label className="flex flex-col gap-1 text-sm">
          {t("project.thumb-title")}
          <input
            className="input"
            value={thumbTitle}
            onChange={(e) => setThumbTitle(e.target.value)}
            placeholder={t("project.thumb-title-placeholder")}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("project.thumb-frame")}
          <input
            className="input"
            type="number"
            min={0}
            step={0.5}
            value={thumbFrameAt}
            onChange={(e) => setThumbFrameAt(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("project.thumb-bg-prompt")}
          <input
            className="input"
            value={thumbPrompt}
            onChange={(e) => setThumbPrompt(e.target.value)}
            placeholder={t("project.thumb-bg-placeholder")}
          />
        </label>
        <p className="text-xs text-[var(--text-muted)]">
          {t("project.thumb-desc")}
        </p>
        {thumbError && (
          <p className="text-xs text-[var(--danger)]">
            {tf("project.thumb-error", { error: thumbError })}
          </p>
        )}
      </Modal>

      {/* Lightbox phóng to - click nền hoặc Escape để đóng */}
      {zoomed && output && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--text)]/80 p-6"
          onClick={() => setZoomed(false)}
          role="dialog"
          aria-label={t("project.zoom-video-aria")}
        >
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setZoomed(false)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg)] text-[var(--text)] shadow-[var(--shadow-card)] transition-colors duration-150 hover:bg-[var(--bg-subtle)]"
          >
            <X size={16} strokeWidth={2} />
          </button>
          <video
            controls
            autoPlay
            src={outputUrl}
            className="max-h-[92vh] max-w-full rounded-[var(--radius-lg)]"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </Card>
  );
}

function BriefSummaryRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-32 shrink-0 text-[var(--text-muted)]">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function YesNo({ value }: { value: boolean }) {
  const { t } = useT();
  return value ? (
    <span className="inline-flex items-center gap-1 text-[var(--success)]">
      <Check size={14} strokeWidth={2} /> {t("common.yes")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">
      <Minus size={14} strokeWidth={2} /> {t("common.no")}
    </span>
  );
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const router = useRouter();
  const { t, tf } = useT();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  // Jobs của project - nguồn suy giai đoạn cho PipelineTimeline; seed từ
  // /api/jobs rồi cập nhật sống qua SSE (backend là nguồn sự thật)
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobNotice, setJobNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Tags của project - sửa optimistic, lỗi thì revert
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);

  // Modal "Nhân bản project"
  const [cloneOpen, setCloneOpen] = useState(false);

  // Preview file render của scene + lỗi "Mở file" trong card Scenes
  const [scenePreview, setScenePreview] = useState<FileInfo | null>(null);
  const [sceneRevealError, setSceneRevealError] = useState<string | null>(null);

  // Modal "Bắt đầu edit bằng AI"
  const [editOpen, setEditOpen] = useState(false);
  const [extraNotes, setExtraNotes] = useState("");
  // Model + mode cho phiên edit - giữ lựa chọn giữa các lần mở modal
  const [editModel, setEditModel] = useState(DEFAULT_MODEL);
  const [editEffort, setEditEffort] = useState<AgentEffort>(DEFAULT_EFFORT);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Bản nháp brief đang gõ trong form (chưa cần bấm Lưu) - modal + start edit dùng bản này
  const [briefDraft, setBriefDraft] = useState<Brief | null>(null);

  // Style Design - tên style hiển thị trong tóm tắt modal "Bắt đầu edit"
  const { data: stylesData } = useStyles();

  // Panel AI của project (chat đi theo project)
  const [panelOpen, setPanelOpen] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSession[] | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Vừa bấm "Bắt đầu edit" thành công → coi là đã started ngay, không chờ reload
  const [startedOverride, setStartedOverride] = useState(false);

  // Dropdown "Xem thêm" trong hàng nút của panel AI
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  const loadSessions = useCallback(async () => {
    try {
      const list = await getChatSessions(projectId);
      list.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setChatSessions(list);
      // Chưa chọn phiên nào → tự chọn phiên mới nhất
      setActiveSessionId((cur) => cur ?? list[0]?.sessionId ?? null);
    } catch {
      // panel vẫn hoạt động được (empty state) - không chặn trang
      setChatSessions((s) => s ?? []);
    }
  }, [projectId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const load = useCallback(async () => {
    try {
      setProject(await getProject(projectId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // Tập sessionId thuộc project này - để lọc event agent
  const sessionIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    sessionIdsRef.current = new Set(
      (chatSessions ?? []).map((s) => s.sessionId)
    );
  }, [chatSessions]);

  // AI đang edit → asset/render/scene cập nhật sống: refresh khi AI ghi file
  // (Write/Edit/Bash), throttle 3s để không dội API; refresh lần cuối khi done.
  const lastAutoRefreshRef = useRef(0);
  useAgentEvents((e) => {
    const belongs =
      sessionIdsRef.current.has(e.sessionId) ||
      e.sessionId === activeSessionId;
    if (e.kind === "done") {
      // cập nhật status/title trong danh sách phiên + dữ liệu project
      loadSessions();
      if (belongs) load();
      return;
    }
    if (!belongs || e.kind !== "tool") return;
    const name = e.tool?.name;
    if (name === "Write" || name === "Edit" || name === "Bash") {
      const now = Date.now();
      if (now - lastAutoRefreshRef.current >= 3000) {
        lastAutoRefreshRef.current = now;
        load();
      }
    }
  });

  // Seed danh sách job của project (timeline giai đoạn cần cả job đã done)
  useEffect(() => {
    let alive = true;
    getJobs(50)
      .then((list) => {
        if (alive) setJobs(list.filter((j) => j.projectId === projectId));
      })
      .catch(() => {
        // không có jobs cũng không chặn trang - timeline tự ẩn/suy từ file
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  // Refetch khi có job của project này đổi trạng thái kết thúc
  // + upsert vào state jobs để timeline giai đoạn cập nhật sống
  useJobEvents((job) => {
    if (job.projectId !== projectId) return;
    setJobs((prev) => {
      const i = prev.findIndex((j) => j.id === job.id);
      if (i === -1) return [job, ...prev];
      const next = prev.slice();
      next[i] = job;
      return next;
    });
    if (["done", "failed", "canceled"].includes(job.status)) load();
  });

  async function submitJob(type: JobType, sceneId?: string) {
    setSubmitting(true);
    setJobError(null);
    setJobNotice(null);
    try {
      const job = await createJob({ projectId, type, sceneId });
      setJobNotice(tf("project.job-queued", { id: job.id, type }));
    } catch (e) {
      setJobError(
        tf("project.job-error", {
          error: e instanceof Error ? e.message : String(e),
        })
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Xóa file rác - file trung gian sau khi xuất final (renders/verify/cache,
  // props.resolved.json, draft lắp ráp, staging Remotion); file nguồn giữ nguyên
  const [cleaning, setCleaning] = useState(false);
  async function onCleanJunk() {
    if (cleaning) return;
    setCleaning(true);
    setJobError(null);
    setJobNotice(null);
    try {
      const junk = await getProjectJunk(projectId);
      if (junk.items.length === 0) {
        setJobNotice(t("junk.none"));
        return;
      }
      if (
        !window.confirm(
          tf("project.junk-confirm", {
            items: junk.items.length,
            size: formatBytes(junk.totalBytes),
          })
        )
      )
        return;
      const result = await cleanProjectJunk(projectId);
      setJobNotice(
        tf("project.junk-freed", {
          size: formatBytes(result.freedBytes),
          items: result.deleted,
        })
      );
      load();
    } catch (e) {
      setJobError(
        tf("project.junk-error", {
          error: e instanceof Error ? e.message : String(e),
        })
      );
    } finally {
      setCleaning(false);
    }
  }

  /** Thay toàn bộ tags - optimistic: cập nhật UI trước, lỗi thì revert. */
  async function saveTags(next: string[]) {
    if (!project) return;
    const prev = project.tags ?? [];
    setTagError(null);
    setProject((p) => (p ? { ...p, tags: next } : p));
    try {
      const { tags } = await updateProjectTags(projectId, next);
      setProject((p) => (p ? { ...p, tags } : p));
    } catch (e) {
      setProject((p) => (p ? { ...p, tags: prev } : p));
      setTagError(e instanceof Error ? e.message : String(e));
    }
  }

  function addTag() {
    const tag = tagInput.trim();
    setTagInput("");
    setAddingTag(false);
    if (!tag || !project) return;
    const cur = project.tags ?? [];
    if (cur.includes(tag)) return;
    saveTags([...cur, tag]);
  }

  // Modal xác nhận xóa project - bắt gõ DELETE (thay window.confirm)
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteProject(projectId);
      router.push("/projects");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  async function onStartEdit() {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    try {
      // Tự lưu brief đang gõ trước khi bắt đầu - người dùng không cần nhớ bấm "Lưu brief"
      if (briefDraft) {
        const saved = await updateBrief(projectId, briefDraft);
        setProject((p) => (p ? { ...p, brief: saved } : p));
      }
      const { sessionId } = await startProjectEdit(projectId, extraNotes, {
        model: editModel,
        effort: editEffort,
      });
      // Không rời trang - mở panel AI, chọn phiên vừa tạo, log stream ngay tại chỗ
      setEditOpen(false);
      setActiveSessionId(sessionId);
      setPanelOpen(true);
      setStartedOverride(true);
      loadSessions();
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  const scenes = project?.scenes ?? [];
  const renders = project?.files?.renders ?? [];
  const assets = project?.files?.assets ?? [];
  // Ưu tiên bản nháp đang gõ; fallback bản đã lưu trong meta.json
  const brief: Brief = briefDraft ?? { ...DEFAULT_BRIEF, ...(project?.brief ?? {}) };

  const activeSession =
    chatSessions?.find((s) => s.sessionId === activeSessionId) ?? null;

  // Hai trạng thái layout: chưa started = đang nhập liệu (form to, ẩn card rỗng);
  // đã started = đang chạy hoặc có kết quả (card compact + output/scenes/renders)
  const started =
    startedOverride ||
    (chatSessions?.length ?? 0) > 0 ||
    project?.output != null ||
    renders.length > 0;

  // Phiên AI của project đang chạy → card Video output hiện trạng thái sống
  const aiRunning = (chatSessions ?? []).some((s) => s.status === "running");

  // Timeline tự ẩn khi chưa có gì để hiện (deriveStage trả null). Tính trước ở
  // đây để nút (i) đi kèm cũng ẩn theo - không để icon lơ lửng một mình.
  const pipelineInput = project
    ? {
        metaStatus: project.status,
        hasOutput: project.output != null,
        scenes,
        renders,
        jobs,
        sessionRunning: aiRunning,
      }
    : null;
  const showPipeline =
    pipelineInput !== null && deriveStage(pipelineInput) !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header chừa chỗ panel AI ghim phải như vùng nội dung - không thì timeline chui xuống dưới panel */}
      <div className="xl:pr-[452px]">
      <PageHeader
        title={project?.name ?? projectId}
        subtitle={
          project
            ? `${project.width}×${project.height} · ${project.fps}fps · ${tf("project.updated", { time: formatRelative(project.updatedAt) })}`
            : undefined
        }
        center={
          pipelineInput && showPipeline ? (
            <div className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1">
                <PipelineTimeline {...pipelineInput} />
              </div>
              <InfoHint
                titleKey="help.pipeline.title"
                bodyKey="help.pipeline.body"
                className="mt-px"
              />
            </div>
          ) : undefined
        }
        actions={
          /* Nút job/Xóa đã chuyển vào panel AI (panel ghim phải che mất chỗ này)
             - chỉ giữ nút toggle panel cho màn nhỏ */
          <Button
            variant="secondary"
            className="xl:hidden"
            onClick={() => setPanelOpen((o) => !o)}
            aria-expanded={panelOpen}
          >
            <MessageSquare size={15} strokeWidth={2} />
            AI
            {chatSessions && chatSessions.length > 0 && (
              <span className="rounded-full bg-[var(--primary-soft)] px-1.5 py-0.5 text-xs font-semibold leading-none text-[var(--primary)]">
                {chatSessions.length}
              </span>
            )}
          </Button>
        }
      />
      </div>

      {project && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)] xl:pr-[452px]">
          <ProjectBadge status={project.status} />
          <span>ID: {project.id}</span>
          <span
            className="h-4 w-px bg-[var(--border)]"
            aria-hidden="true"
          />
          {(project.tags ?? []).map((tag) => (
            <span key={tag} className="chip">
              {tag}
              <button
                type="button"
                aria-label={tf("taginput.remove-aria", { tag })}
                className="text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--danger)]"
                onClick={() =>
                  saveTags((project.tags ?? []).filter((x) => x !== tag))
                }
              >
                <X size={12} strokeWidth={2} />
              </button>
            </span>
          ))}
          {addingTag ? (
            <input
              className="input h-7 w-36 rounded-full px-3 text-xs"
              autoFocus
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                } else if (e.key === "Escape") {
                  setTagInput("");
                  setAddingTag(false);
                }
              }}
              onBlur={addTag}
              placeholder={t("project.new-tag-placeholder")}
              aria-label={t("project.add-tag-aria")}
            />
          ) : (
            <button
              type="button"
              className="chip transition-colors duration-150 hover:text-[var(--text)]"
              onClick={() => setAddingTag(true)}
            >
              <Plus size={12} strokeWidth={2} />
              Tag
            </button>
          )}
          {tagError && (
            <span className="text-xs text-[var(--danger)]">
              {tf("project.tags-error", { error: tagError })}
            </span>
          )}
          {/* (i) luôn nằm NGOÀI nút - lồng button trong button là HTML không hợp lệ */}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button variant="secondary" small onClick={() => setCloneOpen(true)}>
              <Copy size={14} strokeWidth={2} />
              {t("clone.action")}
            </Button>
            <InfoHint
              titleKey="help.clone.title"
              bodyKey="help.clone.body"
            />
          </span>
          {started && (
            <span className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="secondary"
                small
                onClick={() => {
                  setStartError(null);
                  setExtraNotes("");
                  setEditOpen(true);
                }}
              >
                <Sparkles size={14} strokeWidth={2} />
                {t("project.start-edit-new-session")}
              </Button>
              <InfoHint
                titleKey="help.start-edit.title"
                bodyKey="help.start-edit.body"
              />
            </span>
          )}
        </div>
      )}

      {error && (
        <ErrorBanner message={t("project.load-error")} detail={error} />
      )}

      {/* Main content - panel AI ghim cố định bên phải (xl+), nội dung chính
          chừa chỗ bằng padding-right. Hai trạng thái layout theo `started`. */}
      <div className="flex flex-col gap-4 xl:pr-[452px]">
        {!started ? (
          /* Chưa started: đang nhập liệu - Asset + Brief full, ẩn card rỗng */
          <>
            <div className="grid items-start gap-4 xl:grid-cols-5">
              <div className="flex flex-col gap-4 xl:col-span-2">
                <ProjectAssetsCard
                  projectId={projectId}
                  assets={assets.filter(
                    (f) => f.kind === "video" || f.kind === "image"
                  )}
                  onChanged={load}
                />
                {assets.some((f) => f.kind === "audio") && (
                  <ProjectAssetsCard
                    title={t("project.sfx-title")}
                    showUpload={false}
                    projectId={projectId}
                    assets={assets.filter((f) => f.kind === "audio")}
                    onChanged={load}
                  />
                )}
                {assets.some((f) => f.kind === "other") && (
                  <ProjectAssetsCard
                    title={t("project.other-title")}
                    showUpload={false}
                    projectId={projectId}
                    assets={assets.filter((f) => f.kind === "other")}
                    onChanged={load}
                  />
                )}
              </div>
              <div className="xl:col-span-3">
                <ProjectBriefCard
                  projectId={projectId}
                  brief={project?.brief}
                  onDraftChange={setBriefDraft}
                  onSaved={(b) =>
                    setProject((p) => (p ? { ...p, brief: b } : p))
                  }
                />
              </div>
            </div>

            {/* Nút CTA vẫn kéo hết bề ngang (flex-1), (i) đứng riêng bên cạnh */}
            <div className="flex items-center gap-2">
              <Button
                className="h-12 flex-1 text-[15px]"
                onClick={() => {
                  setStartError(null);
                  setExtraNotes("");
                  setEditOpen(true);
                }}
              >
                <Sparkles size={18} strokeWidth={2} />
                {t("project.start-edit")}
              </Button>
              <InfoHint
                titleKey="help.start-edit.title"
                bodyKey="help.start-edit.body"
                size={15}
              />
            </div>
          </>
        ) : (
          /* Đã started: 3 cột dọc tự xếp - mỗi cột flex-col, card nối nhau
             lấp kín (Brief/Video output ngắn không để lại khoảng trống chết) */
          <>
            <div className="grid items-start gap-4 xl:grid-cols-3">
              <div className="flex flex-col gap-4">
                <ProjectAssetsCard
                  compact
                  projectId={projectId}
                  assets={assets.filter(
                    (f) => f.kind === "video" || f.kind === "image"
                  )}
                  onChanged={load}
                />
                {assets.some((f) => f.kind === "audio") && (
                  <ProjectAssetsCard
                    compact
                    title={t("project.sfx-title")}
                    showUpload={false}
                    projectId={projectId}
                    assets={assets.filter((f) => f.kind === "audio")}
                    onChanged={load}
                  />
                )}
                {assets.some((f) => f.kind === "other") && (
                  <ProjectAssetsCard
                    compact
                    title={t("project.other-title")}
                    showUpload={false}
                    projectId={projectId}
                    assets={assets.filter((f) => f.kind === "other")}
                    onChanged={load}
                  />
                )}
              </div>

              <div className="flex flex-col gap-4">
                <ProjectBriefCard
                  projectId={projectId}
                  brief={project?.brief}
                  onDraftChange={setBriefDraft}
                  onSaved={(b) =>
                    setProject((p) => (p ? { ...p, brief: b } : p))
                  }
                />
                {/* Duyệt draft ghim ghi chú theo giây; Cắt short + Tái chế tỉ lệ đẻ project con */}
                <ProjectReviewCard
                  projectId={projectId}
                  output={project?.output}
                  version={project?.updatedAt}
                  aiRunning={aiRunning}
                />
                <ProjectClipsCard
                  projectId={projectId}
                  width={project?.width}
                  height={project?.height}
                  onCreated={load}
                />
              </div>

              <div className="flex flex-col gap-4">
                <VideoOutputCard
                  projectId={projectId}
                  projectName={project?.name}
                  output={project?.output}
                  thumbnail={project?.thumbnail}
                  aiRunning={aiRunning}
                  version={project?.updatedAt}
                  onChanged={load}
                />
                {/* QC đo bản draft/final hiện có; Gói xuất bản soạn từ transcript */}
                <ProjectQcCard projectId={projectId} onChanged={load} />
                <ProjectPublishCard
                  projectId={projectId}
                  version={project?.updatedAt}
                />
                <Card title="Renders">
                  <FileTable files={renders} />
                </Card>
                <Card title="Scenes">
                  {sceneRevealError && (
                    <p className="mb-2 text-xs text-[var(--danger)]">
                      {sceneRevealError}
                    </p>
                  )}
                  {scenes.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="table min-w-[560px]">
                        <thead>
                          <tr>
                            <th>Scene</th>
                            <th>{t("project.col-source")}</th>
                            <th>Duration (frames)</th>
                            <th>{t("project.col-rendered")}</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {scenes.map((s) => {
                            const renderFile = sceneRenderFile(s, renders);
                            const rendered = renderFile !== null;
                            return (
                              <tr key={s.id}>
                                <td className="font-medium">
                                  {renderFile ? (
                                    <button
                                      type="button"
                                      onClick={() => setScenePreview(renderFile)}
                                      title={tf("common.preview-aria", { name: renderFile.name })}
                                      className="font-medium underline-offset-2 transition-colors duration-150 hover:text-[var(--primary)] hover:underline"
                                    >
                                      {s.id}
                                    </button>
                                  ) : (
                                    s.id
                                  )}
                                </td>
                                <td className="text-[var(--text-muted)]">
                                  {s.src ? (
                                    <span className="chip">
                                      HyperFrames · {s.src}
                                    </span>
                                  ) : s.srcVideo ? (
                                    <span className="chip">
                                      Video · {s.srcVideo}
                                    </span>
                                  ) : (
                                    "-"
                                  )}
                                </td>
                                <td className="text-[var(--text-muted)]">
                                  {s.durationInFrames ?? "-"}
                                </td>
                                <td>
                                  {rendered ? (
                                    <Check
                                      size={16}
                                      strokeWidth={2}
                                      className="text-[var(--success)]"
                                    />
                                  ) : (
                                    <Minus
                                      size={16}
                                      strokeWidth={2}
                                      className="text-[var(--text-muted)]"
                                    />
                                  )}
                                </td>
                                <td>
                                  <span className="flex items-center justify-end gap-2">
                                    {renderFile && (
                                      <RevealButton
                                        relPath={renderFile.relPath}
                                        onError={setSceneRevealError}
                                      />
                                    )}
                                    {s.src && (
                                      <Button
                                        variant="secondary"
                                        small
                                        disabled={submitting}
                                        onClick={() =>
                                          submitJob("scene-draft", s.id)
                                        }
                                      >
                                        {t("project.draft-this-scene")}
                                      </Button>
                                    )}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyState
                      icon={Clapperboard}
                      description={t("project.no-scenes")}
                    />
                  )}
                </Card>
              </div>
            </div>

          </>
        )}
      </div>

      {/* Panel AI - xl+ luôn hiển thị (fixed, cao hết viewport trừ topbar);
          màn nhỏ là drawer overlay bật bằng nút AI */}
      {panelOpen && (
          <div
            className="fixed inset-0 z-30 bg-[var(--text)]/40 xl:hidden"
            onClick={() => setPanelOpen(false)}
            aria-hidden="true"
          />
        )}
        <aside
          className={`${
            panelOpen ? "flex" : "hidden xl:flex"
          } fixed inset-y-0 right-0 z-40 w-full max-w-[440px] flex-col gap-3 border-l border-[var(--border)] bg-[var(--bg)] p-4 xl:top-14 xl:bottom-0 xl:z-20 xl:h-auto xl:w-[440px] xl:max-w-none xl:p-3`}
          aria-label={t("project.ai-panel-aria")}
        >
          {/* Hàng nút chức năng - chuyển từ PageHeader vào (panel che mất chỗ cũ) */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Button
                small
                className="flex-1"
                disabled={submitting}
                onClick={() => submitJob("assemble-final")}
              >
                <Play size={14} strokeWidth={2} />
                {t("project.render-final")}
              </Button>
              <InfoHint
                titleKey="help.render-final.title"
                bodyKey="help.render-final.body"
              />
              <Button
                variant="destructive"
                small
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 size={14} strokeWidth={2} />
                {t("common.delete")}
              </Button>
              <div ref={moreRef} className="relative">
                <Button
                  variant="secondary"
                  small
                  onClick={() => setMoreOpen((o) => !o)}
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                >
                  <MoreHorizontal size={14} strokeWidth={2} />
                  {t("project.more")}
                </Button>
                {moreOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-1 w-52 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-card)]"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      disabled={submitting}
                      className="flex w-full items-center gap-2 rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-[var(--bg-subtle)] disabled:opacity-50"
                      onClick={() => {
                        setMoreOpen(false);
                        submitJob("scene-draft");
                      }}
                    >
                      <Clapperboard
                        size={14}
                        strokeWidth={2}
                        className="shrink-0 text-[var(--text-muted)]"
                      />
                      {t("project.menu-scene-draft")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={submitting}
                      className="flex w-full items-center gap-2 rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-[var(--bg-subtle)] disabled:opacity-50"
                      onClick={() => {
                        setMoreOpen(false);
                        submitJob("assemble-draft");
                      }}
                    >
                      <Film
                        size={14}
                        strokeWidth={2}
                        className="shrink-0 text-[var(--text-muted)]"
                      />
                      {t("project.menu-assemble-draft")}
                    </button>
                    {/* (i) là item riêng cạnh menu item - không lồng vào button */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        role="menuitem"
                        disabled={cleaning}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-[var(--bg-subtle)] disabled:opacity-50"
                        onClick={() => {
                          setMoreOpen(false);
                          onCleanJunk();
                        }}
                      >
                        <Trash2
                          size={14}
                          strokeWidth={2}
                          className="shrink-0 text-[var(--text-muted)]"
                        />
                        {cleaning ? t("junk.cleaning") : t("junk.clean")}
                      </button>
                      <InfoHint
                        titleKey="help.clean-junk.title"
                        bodyKey="help.clean-junk.body"
                        className="mr-1"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            {jobNotice && (
              <p className="text-xs text-[var(--success)]">{jobNotice}</p>
            )}
            {jobError && (
              <p className="text-xs text-[var(--danger)]">{jobError}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <MessageSquare
                size={15}
                strokeWidth={2}
                className="shrink-0 text-[var(--text-muted)]"
              />
              {t("project.ai-panel")}
            </h2>
            <div className="flex shrink-0 items-center gap-2">
              {activeSession && (
                <SessionStatusBadge status={activeSession.status} />
              )}
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                aria-label={t("project.close-panel")}
                className="rounded-[var(--radius)] p-1 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)] xl:hidden"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
          </div>

          {chatSessions && chatSessions.length > 0 && (
            <select
              className="input"
              value={activeSessionId ?? ""}
              onChange={(e) => setActiveSessionId(e.target.value || null)}
              aria-label={t("project.select-session")}
            >
              {chatSessions.map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  {s.title} · {sessionStatusLabel(s.status, t)} ·{" "}
                  {formatRelative(s.updatedAt)}
                </option>
              ))}
            </select>
          )}

          {chatSessions !== null &&
          chatSessions.length === 0 &&
          !activeSessionId ? (
            <div className="card flex min-h-0 flex-1 flex-col items-center justify-center">
              <EmptyState
                icon={Sparkles}
                description={t("project.no-sessions")}
                action={
                  <Button
                    small
                    onClick={() => {
                      setStartError(null);
                      setExtraNotes("");
                      setEditOpen(true);
                    }}
                  >
                    <Sparkles size={14} strokeWidth={2} />
                    {t("project.start-edit")}
                  </Button>
                }
              />
            </div>
          ) : (
            <ChatThread
              compact
              providersEnabled
              sessionId={activeSessionId}
              projectId={projectId}
              initialStatus={activeSession?.status}
              session={activeSession}
              onSessionCreated={(id) => {
                setActiveSessionId(id);
                loadSessions();
              }}
            />
          )}
        </aside>

      {/* Preview file render của scene (card Scenes) */}
      <MediaPreviewModal
        file={scenePreview}
        onClose={() => setScenePreview(null)}
      />

      {/* Modal xác nhận xóa project - bắt gõ DELETE */}
      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("project.delete-title")}
        description={
          <>
            {t("project.delete-desc-1")}{" "}
            <span className="font-medium">{project?.name ?? projectId}</span>?
            {t("project.delete-desc-2")}{" "}
            <code className="rounded bg-[var(--bg-subtle)] px-1 text-xs">
              video-projects/{projectId}
            </code>{" "}
            {t("project.delete-desc-3")}
          </>
        }
        busy={deleting}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDelete}
      />

      {/* Modal nhân bản project - thành công thì chuyển thẳng sang project mới */}
      <CloneProjectModal
        source={
          cloneOpen
            ? { id: projectId, name: project?.name ?? projectId }
            : null
        }
        onClose={() => setCloneOpen(false)}
        onCloned={(p) => {
          setCloneOpen(false);
          router.push(`/projects/${p.id}`);
        }}
      />

      <Modal
        title={t("project.start-edit")}
        open={editOpen}
        onClose={() => {
          if (!starting) setEditOpen(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={starting}
              onClick={() => setEditOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={starting} onClick={onStartEdit}>
              <Sparkles size={15} strokeWidth={2} />
              {starting ? t("project.starting") : t("project.start-edit-short")}
            </Button>
          </>
        }
      >
        {startError && (
          <ErrorBanner
            message={t("project.start-error")}
            detail={startError}
          />
        )}
        <p className="text-sm text-[var(--text-muted)]">
          {t("project.edit-modal-desc")}
        </p>
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
          <BriefSummaryRow label={t("project.sum-source")}>
            {brief.sourceDescription.trim() || (
              <span className="text-[var(--text-muted)]">{t("brief.not-described")}</span>
            )}
          </BriefSummaryRow>
          <BriefSummaryRow label={t("brief.edit-request")}>
            {brief.notes.trim() ? (
              <span className="line-clamp-3 whitespace-pre-line">
                {brief.notes}
              </span>
            ) : (
              <span className="text-[var(--text-muted)]">{t("brief.none")}</span>
            )}
          </BriefSummaryRow>
          <BriefSummaryRow label={t("project.sum-autocut")}>
            <YesNo value={brief.autoCut} />
          </BriefSummaryRow>
          <BriefSummaryRow label={t("brief.subtitles")}>
            <YesNo value={brief.subtitles} />
          </BriefSummaryRow>
          <BriefSummaryRow label={t("brief.highlight")}>
            <YesNo value={brief.highlightEnabled} />
            {brief.highlightEnabled && brief.highlightKeywords.length > 0 && (
              <span className="ml-1 text-[var(--text-muted)]">
                · {t("project.sum-keywords")} {brief.highlightKeywords.join(", ")}
              </span>
            )}
          </BriefSummaryRow>
          <BriefSummaryRow label={t("brief.key-layout")}>
            {brief.keyLayoutEnabled ? (
              <>
                {t("project.sum-main-key")}{" "}
                {brief.mainKey.trim() || (
                  <span className="text-[var(--text-muted)]">{t("brief.ai-choose")}</span>
                )}
                {brief.relatedKeys.length > 0 && (
                  <span className="ml-1 text-[var(--text-muted)]">
                    · {t("project.sum-related-keys")} {brief.relatedKeys.join(", ")}
                  </span>
                )}
              </>
            ) : (
              <span className="text-[var(--text-muted)]">{t("common.off")}</span>
            )}
          </BriefSummaryRow>
          <BriefSummaryRow label={t("brief.illustrations")}>
            <YesNo value={brief.autoIllustrations} />
            {brief.autoIllustrations && brief.illustrationModel && (
              <span className="ml-1 text-[var(--text-muted)]">
                · model: {brief.illustrationModel}
              </span>
            )}
          </BriefSummaryRow>
          <BriefSummaryRow label="Style Design">
            {styleDisplayName(stylesData, brief.styleId, t)}
          </BriefSummaryRow>
          <BriefSummaryRow label="Skill">
            {brief.skill ?? t("brief.ai-pick-skill")}
          </BriefSummaryRow>
          <BriefSummaryRow label="Sound effect">
            {t(SFX_MODE_LABEL[brief.sfxMode])}
          </BriefSummaryRow>
        </div>
        <AiModelBlock
          model={editModel}
          effort={editEffort}
          onModelChange={setEditModel}
          onEffortChange={setEditEffort}
          disabled={starting}
        />
        <div>
          <label className="label" htmlFor="edit-extra-notes">
            {t("project.extra-notes")}
          </label>
          <textarea
            id="edit-extra-notes"
            className="input"
            rows={2}
            value={extraNotes}
            onChange={(e) => setExtraNotes(e.target.value)}
            placeholder={t("projects.notes-placeholder")}
          />
        </div>
      </Modal>
    </div>
  );
}
