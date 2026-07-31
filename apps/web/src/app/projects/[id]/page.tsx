"use client";

import {
  Check,
  ChevronDown,
  Clapperboard,
  Copy,
  ExternalLink,
  Film,
  Maximize2,
  FileQuestion,
  FileText,
  Image as ImageIcon,
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
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  cleanProjectJunk,
  createJob,
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
import {
  AiModelBlock,
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
} from "@/components/ModelPicker";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { PipelineTimeline } from "@/components/PipelineTimeline";
import {
  DEFAULT_BRIEF,
  ProjectBriefCard,
  SFX_MODE_LABEL,
} from "@/components/ProjectBriefCard";
import { ProjectAssetsCard } from "@/components/ProjectAssetsCard";
import { styleDisplayName, useStyles } from "@/components/StyleSelect";
import { formatBytes, formatRelative, isRecentFile } from "@/lib/format";
import {
  SessionStatusBadge,
  sessionStatusLabel,
} from "@/components/SessionStatusBadge";

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

function sceneRendered(scene: SceneMeta, renders: FileInfo[]): boolean {
  return renders.some(
    (f) => f.name === `${scene.id}.mp4` || f.name === `${scene.id}.draft.mp4`
  );
}

/** Bảng file render — click hàng để mở preview chi tiết ngay tại chỗ */
function FileTable({ files }: { files: FileInfo[] }) {
  const [openPath, setOpenPath] = useState<string | null>(null);

  if (files.length === 0) {
    return (
      <EmptyState icon={FileQuestion} description="Chưa có file nào." />
    );
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>File</th>
          <th>Kích thước</th>
          <th>Sửa đổi</th>
          <th aria-label="Xem" />
        </tr>
      </thead>
      <tbody>
        {files.map((f) => {
          const open = openPath === f.relPath;
          // Cache-bust theo mtime — file render draft ghi đè cùng tên
          const url = mediaUrl(f.relPath) + `?v=${encodeURIComponent(f.mtime)}`;
          return (
            <React.Fragment key={f.relPath}>
              <tr
                className="row-click"
                onClick={() => setOpenPath(open ? null : f.relPath)}
              >
                <td>
                  <span className="flex items-center gap-2">
                    <KindIcon kind={f.kind} />
                    {f.name}
                    {isRecentFile(f.mtime) && (
                      <span className="rounded-full bg-[var(--primary-soft)] px-1.5 py-0.5 text-[11px] font-medium leading-none text-[var(--primary)]">
                        mới
                      </span>
                    )}
                  </span>
                </td>
                <td className="text-[var(--text-muted)]">{formatBytes(f.size)}</td>
                <td className="text-[var(--text-muted)]">{formatRelative(f.mtime)}</td>
                <td className="text-right">
                  <ChevronDown
                    size={15}
                    strokeWidth={2}
                    className={`ml-auto text-[var(--text-muted)] transition-transform duration-150 ${
                      open ? "rotate-180" : ""
                    }`}
                  />
                </td>
              </tr>
              {open && (
                <tr>
                  <td colSpan={4} className="bg-[var(--bg-subtle)]">
                    <div className="flex flex-col gap-2 py-1">
                      {f.kind === "video" ? (
                        <video
                          controls
                          src={url}
                          className="mx-auto max-h-[320px] max-w-full rounded-[var(--radius)] bg-[var(--bg-subtle)]"
                        />
                      ) : f.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt={f.name}
                          className="mx-auto max-h-[320px] max-w-full rounded-[var(--radius)]"
                        />
                      ) : f.kind === "audio" ? (
                        <audio controls src={url} className="w-full" />
                      ) : (
                        <p className="text-xs text-[var(--text-muted)]">
                          Không xem trước được loại file này.
                        </p>
                      )}
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-auto flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                      >
                        <ExternalLink size={13} strokeWidth={2} />
                        Mở file trong tab mới
                      </a>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Card Video output — trạng thái "AI đang tạo video" (phiên running) hiện TRÊN,
 * video đã có (project.output) hiện DƯỚI; chưa có gì thì empty state nhỏ.
 */
function VideoOutputCard({
  output,
  aiRunning,
  version,
}: {
  output: string | null | undefined;
  aiRunning: boolean;
  /** updatedAt của project — cache-bust vì file draft ghi đè cùng tên */
  version?: string;
}) {
  const fileName = output ? output.split(/[\\/]/).pop() : null;
  const outputUrl = output
    ? mediaUrl(output) + (version ? `?v=${encodeURIComponent(version)}` : "")
    : "";
  const [zoomed, setZoomed] = useState(false);

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
    <Card title="Video output">
      {aiRunning && (
        <div
          className={`flex flex-col gap-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 ${
            output ? "mb-3" : ""
          }`}
        >
          <div className="progress-indeterminate" aria-label="AI đang tạo video" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[var(--text-muted)]">
              AI đang tạo video…
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
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-[var(--text-muted)]">
              {fileName}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setZoomed(true)}
                className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
              >
                <Maximize2 size={13} strokeWidth={2} />
                Phóng to
              </button>
              <a
                href={outputUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
              >
                <ExternalLink size={13} strokeWidth={2} />
                Mở file
              </a>
            </span>
          </div>
        </div>
      ) : !aiRunning ? (
        <EmptyState icon={MonitorPlay} description="Chưa có video output." />
      ) : null}

      {/* Lightbox phóng to — click nền hoặc Escape để đóng */}
      {zoomed && output && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--text)]/80 p-6"
          onClick={() => setZoomed(false)}
          role="dialog"
          aria-label="Xem video phóng to"
        >
          <button
            type="button"
            aria-label="Đóng"
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
  return value ? (
    <span className="inline-flex items-center gap-1 text-[var(--success)]">
      <Check size={14} strokeWidth={2} /> Có
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">
      <Minus size={14} strokeWidth={2} /> Không
    </span>
  );
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const router = useRouter();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  // Jobs của project — nguồn suy giai đoạn cho PipelineTimeline; seed từ
  // /api/jobs rồi cập nhật sống qua SSE (backend là nguồn sự thật)
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobNotice, setJobNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Tags của project — sửa optimistic, lỗi thì revert
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);

  // Modal "Nhân bản project"
  const [cloneOpen, setCloneOpen] = useState(false);

  // Modal "Bắt đầu edit bằng AI"
  const [editOpen, setEditOpen] = useState(false);
  const [extraNotes, setExtraNotes] = useState("");
  // Model + mode cho phiên edit — giữ lựa chọn giữa các lần mở modal
  const [editModel, setEditModel] = useState(DEFAULT_MODEL);
  const [editEffort, setEditEffort] = useState<AgentEffort>(DEFAULT_EFFORT);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Bản nháp brief đang gõ trong form (chưa cần bấm Lưu) — modal + start edit dùng bản này
  const [briefDraft, setBriefDraft] = useState<Brief | null>(null);

  // Style Design — tên style hiển thị trong tóm tắt modal "Bắt đầu edit"
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
      // panel vẫn hoạt động được (empty state) — không chặn trang
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

  // Tập sessionId thuộc project này — để lọc event agent
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
        // không có jobs cũng không chặn trang — timeline tự ẩn/suy từ file
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
      setJobNotice(`Đã đưa job ${job.id} (${type}) vào hàng đợi.`);
    } catch (e) {
      setJobError(
        `Không tạo được job: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Xóa file rác — file trung gian sau khi xuất final (renders/verify/cache,
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
        setJobNotice("Không có file rác nào để xóa.");
        return;
      }
      if (
        !window.confirm(
          `Xóa ${junk.items.length} mục file rác, giải phóng ${formatBytes(junk.totalBytes)}?\n` +
            "File nguồn của project và video final được giữ nguyên."
        )
      )
        return;
      const result = await cleanProjectJunk(projectId);
      setJobNotice(
        `Đã giải phóng ${formatBytes(result.freedBytes)} (${result.deleted} mục file rác).`
      );
      load();
    } catch (e) {
      setJobError(
        `Không xóa được file rác: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setCleaning(false);
    }
  }

  /** Thay toàn bộ tags — optimistic: cập nhật UI trước, lỗi thì revert. */
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

  async function onDelete() {
    if (
      !window.confirm(
        `Xóa project "${projectId}"? Toàn bộ folder video-projects/${projectId} sẽ bị xóa.`
      )
    )
      return;
    try {
      await deleteProject(projectId);
      router.push("/projects");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onStartEdit() {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    try {
      // Tự lưu brief đang gõ trước khi bắt đầu — người dùng không cần nhớ bấm "Lưu brief"
      if (briefDraft) {
        const saved = await updateBrief(projectId, briefDraft);
        setProject((p) => (p ? { ...p, brief: saved } : p));
      }
      const { sessionId } = await startProjectEdit(projectId, extraNotes, {
        model: editModel,
        effort: editEffort,
      });
      // Không rời trang — mở panel AI, chọn phiên vừa tạo, log stream ngay tại chỗ
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={project?.name ?? projectId}
        subtitle={
          project
            ? `${project.width}×${project.height} · ${project.fps}fps · cập nhật ${formatRelative(project.updatedAt)}`
            : undefined
        }
        center={
          project ? (
            <PipelineTimeline
              metaStatus={project.status}
              hasOutput={project.output != null}
              scenes={scenes}
              renders={renders}
              jobs={jobs}
              sessionRunning={aiRunning}
            />
          ) : undefined
        }
        actions={
          /* Nút job/Xóa đã chuyển vào panel AI (panel ghim phải che mất chỗ này)
             — chỉ giữ nút toggle panel cho màn nhỏ */
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

      {project && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)] xl:pr-[452px]">
          <ProjectBadge status={project.status} />
          <span>ID: {project.id}</span>
          <span
            className="h-4 w-px bg-[var(--border)]"
            aria-hidden="true"
          />
          {(project.tags ?? []).map((t) => (
            <span key={t} className="chip">
              {t}
              <button
                type="button"
                aria-label={`Xóa tag ${t}`}
                className="text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--danger)]"
                onClick={() =>
                  saveTags((project.tags ?? []).filter((x) => x !== t))
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
              placeholder="Tag mới…"
              aria-label="Thêm tag"
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
              Không lưu được tags: {tagError}
            </span>
          )}
          <Button
            variant="secondary"
            small
            className="ml-auto"
            onClick={() => setCloneOpen(true)}
          >
            <Copy size={14} strokeWidth={2} />
            Nhân bản
          </Button>
          {started && (
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
              Bắt đầu Edit bằng AI với phiên mới
            </Button>
          )}
        </div>
      )}

      {error && (
        <ErrorBanner message="Không tải được project." detail={error} />
      )}

      {/* Main content — panel AI ghim cố định bên phải (xl+), nội dung chính
          chừa chỗ bằng padding-right. Hai trạng thái layout theo `started`. */}
      <div className="flex flex-col gap-4 xl:pr-[452px]">
        {!started ? (
          /* Chưa started: đang nhập liệu — Asset + Brief full, ẩn card rỗng */
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
                    title="Sound Effect"
                    showUpload={false}
                    projectId={projectId}
                    assets={assets.filter((f) => f.kind === "audio")}
                    onChanged={load}
                  />
                )}
                {assets.some((f) => f.kind === "other") && (
                  <ProjectAssetsCard
                    title="Khác"
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

            <Button
              className="h-12 w-full text-[15px]"
              onClick={() => {
                setStartError(null);
                setExtraNotes("");
                setEditOpen(true);
              }}
            >
              <Sparkles size={18} strokeWidth={2} />
              Bắt đầu edit bằng AI
            </Button>
          </>
        ) : (
          /* Đã started: 3 cột dọc tự xếp — mỗi cột flex-col, card nối nhau
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
                    title="Sound Effect"
                    showUpload={false}
                    projectId={projectId}
                    assets={assets.filter((f) => f.kind === "audio")}
                    onChanged={load}
                  />
                )}
                {assets.some((f) => f.kind === "other") && (
                  <ProjectAssetsCard
                    compact
                    title="Khác"
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
              </div>

              <div className="flex flex-col gap-4">
                <VideoOutputCard
                  output={project?.output}
                  aiRunning={aiRunning}
                  version={project?.updatedAt}
                />
                <Card title="Renders">
                  <FileTable files={renders} />
                </Card>
                <Card title="Scenes">
                  {scenes.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Scene</th>
                            <th>Nguồn</th>
                            <th>Duration (frames)</th>
                            <th>Đã render</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {scenes.map((s) => {
                            const rendered = sceneRendered(s, renders);
                            return (
                              <tr key={s.id}>
                                <td className="font-medium">{s.id}</td>
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
                                    "—"
                                  )}
                                </td>
                                <td className="text-[var(--text-muted)]">
                                  {s.durationInFrames ?? "—"}
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
                                  {s.src && (
                                    <Button
                                      variant="secondary"
                                      small
                                      disabled={submitting}
                                      onClick={() =>
                                        submitJob("scene-draft", s.id)
                                      }
                                    >
                                      Draft scene này
                                    </Button>
                                  )}
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
                      description="meta.json chưa khai báo scene nào. Dùng Chat để nhờ Claude dựng scene cho project này."
                    />
                  )}
                </Card>
              </div>
            </div>

          </>
        )}
      </div>

      {/* Panel AI — xl+ luôn hiển thị (fixed, cao hết viewport trừ topbar);
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
          aria-label="AI của project"
        >
          {/* Hàng nút chức năng — chuyển từ PageHeader vào (panel che mất chỗ cũ) */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Button
                small
                className="flex-1"
                disabled={submitting}
                onClick={() => submitJob("assemble-final")}
              >
                <Play size={14} strokeWidth={2} />
                Render final
              </Button>
              <Button
                variant="destructive"
                small
                onClick={onDelete}
              >
                <Trash2 size={14} strokeWidth={2} />
                Xóa
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
                  Xem thêm
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
                      Render scene draft
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
                      Lắp ráp draft
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={cleaning}
                      className="flex w-full items-center gap-2 rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-[var(--bg-subtle)] disabled:opacity-50"
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
                      {cleaning ? "Đang xóa file rác…" : "Xóa file rác"}
                    </button>
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

          <div className="flex items-center justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <MessageSquare
                size={15}
                strokeWidth={2}
                className="shrink-0 text-[var(--text-muted)]"
              />
              AI của project
            </h2>
            <div className="flex shrink-0 items-center gap-2">
              {activeSession && (
                <SessionStatusBadge status={activeSession.status} />
              )}
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                aria-label="Đóng panel AI"
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
              aria-label="Chọn phiên AI"
            >
              {chatSessions.map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  {s.title} · {sessionStatusLabel(s.status)} ·{" "}
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
                description="Chưa có phiên AI nào — bấm Bắt đầu edit bằng AI."
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
                    Bắt đầu edit bằng AI
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

      {/* Modal nhân bản project — thành công thì chuyển thẳng sang project mới */}
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
        title="Bắt đầu edit bằng AI"
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
              Hủy
            </Button>
            <Button disabled={starting} onClick={onStartEdit}>
              <Sparkles size={15} strokeWidth={2} />
              {starting ? "Đang khởi động…" : "Bắt đầu edit"}
            </Button>
          </>
        }
      >
        {startError && (
          <ErrorBanner
            message="Không bắt đầu được phiên edit."
            detail={startError}
          />
        )}
        <p className="text-sm text-[var(--text-muted)]">
          AI sẽ đọc brief, mô tả asset và sound effect của project rồi tự edit.
          Kiểm tra lại tóm tắt bên dưới:
        </p>
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
          <BriefSummaryRow label="Video gốc">
            {brief.sourceDescription.trim() || (
              <span className="text-[var(--text-muted)]">Chưa mô tả</span>
            )}
          </BriefSummaryRow>
          <BriefSummaryRow label="Yêu cầu edit">
            {brief.notes.trim() ? (
              <span className="line-clamp-3 whitespace-pre-line">
                {brief.notes}
              </span>
            ) : (
              <span className="text-[var(--text-muted)]">Chưa có</span>
            )}
          </BriefSummaryRow>
          <BriefSummaryRow label="Tự động cắt">
            <YesNo value={brief.autoCut} />
          </BriefSummaryRow>
          <BriefSummaryRow label="Phụ đề">
            <YesNo value={brief.subtitles} />
          </BriefSummaryRow>
          <BriefSummaryRow label="Làm nổi bật key chính">
            <YesNo value={brief.highlightEnabled} />
            {brief.highlightEnabled && brief.highlightKeywords.length > 0 && (
              <span className="ml-1 text-[var(--text-muted)]">
                · kèm keyword: {brief.highlightKeywords.join(", ")}
              </span>
            )}
          </BriefSummaryRow>
          <BriefSummaryRow label="Bố cục Key">
            {brief.keyLayoutEnabled ? (
              <>
                Key chính:{" "}
                {brief.mainKey.trim() || (
                  <span className="text-[var(--text-muted)]">AI tự chọn</span>
                )}
                {brief.relatedKeys.length > 0 && (
                  <span className="ml-1 text-[var(--text-muted)]">
                    · Key liên quan: {brief.relatedKeys.join(", ")}
                  </span>
                )}
              </>
            ) : (
              <span className="text-[var(--text-muted)]">Tắt</span>
            )}
          </BriefSummaryRow>
          <BriefSummaryRow label="Ảnh minh họa AI">
            <YesNo value={brief.autoIllustrations} />
            {brief.autoIllustrations && brief.illustrationModel && (
              <span className="ml-1 text-[var(--text-muted)]">
                · model: {brief.illustrationModel}
              </span>
            )}
          </BriefSummaryRow>
          <BriefSummaryRow label="Style Design">
            {styleDisplayName(stylesData, brief.styleId)}
          </BriefSummaryRow>
          <BriefSummaryRow label="Skill">
            {brief.skill ?? "Để AI tự chọn"}
          </BriefSummaryRow>
          <BriefSummaryRow label="Sound effect">
            {SFX_MODE_LABEL[brief.sfxMode]}
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
            Dặn dò thêm lần này
          </label>
          <textarea
            id="edit-extra-notes"
            className="input"
            rows={2}
            value={extraNotes}
            onChange={(e) => setExtraNotes(e.target.value)}
            placeholder="vd: Ưu tiên bản dưới 60 giây, mở đầu bằng câu hook mạnh…"
          />
        </div>
      </Modal>
    </div>
  );
}
