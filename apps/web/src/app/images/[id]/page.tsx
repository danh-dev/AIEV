"use client";

import {
  ArrowLeft,
  Download,
  Image as ImageIcon,
  Layers,
  Loader2,
  Maximize2,
  Save,
  Trash2,
  Upload,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteImageProject,
  generateImage,
  getImageProject,
  getJobs,
  imageFileUrl,
  mediaUrl,
  updateImageProject,
  uploadImageBackground,
  type ImageGenStep,
  type ImageProject,
  type JobStatus,
} from "@/lib/api";
import { useJobEvents, useJobLogEvents } from "@/lib/useEvents";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import {
  AspectChip,
  ImageProjectFields,
  ImageStatusBadge,
  KIND_LABEL,
  useGeminiImageModels,
  type ImageDraft,
} from "@/components/ImageProjectForm";
import { PageHeader } from "@/components/PageHeader";
import { ProgressBar } from "@/components/ProgressBar";
import { useProviders } from "@/components/ModelPicker";
import { formatRelative } from "@/lib/format";

/** Job image-gen đang theo dõi trên trang — cập nhật realtime qua SSE. */
interface ActiveJob {
  id: string;
  progress: number;
  step: string;
  status: JobStatus;
}

const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Chờ chạy",
  running: "Đang chạy",
  done: "Hoàn thành",
  failed: "Lỗi",
  canceled: "Đã hủy",
};

const JOB_STATUS_TONE: Record<JobStatus, string> = {
  queued: "badge-muted",
  running: "badge-running",
  done: "badge-success",
  failed: "badge-danger",
  canceled: "badge-muted",
};

/** Giữ card tiến trình thêm 3s sau khi job kết thúc rồi mới ẩn. */
const JOB_LINGER_MS = 3000;
/** Giới hạn số dòng log giữ trong bộ nhớ trang. */
const MAX_LOG_LINES = 300;

/** Ô ảnh nhỏ trong khối "Các bước" — Background | Final. */
function StepThumb({
  label,
  relPath,
  alt,
}: {
  label: string;
  relPath: string | null;
  alt: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-[var(--text-muted)]">
        {label}
      </span>
      <div className="flex h-36 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)]">
        {relPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl(relPath)}
            alt={alt}
            className="h-full w-full object-contain"
          />
        ) : (
          <ImageIcon
            size={22}
            strokeWidth={1.5}
            className="text-[var(--text-muted)] opacity-40"
          />
        )}
      </div>
    </div>
  );
}

export default function ImageProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const imageId = params.id;
  const router = useRouter();

  const [proj, setProj] = useState<ImageProject | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form sửa (prompt/loại/tỉ lệ/overlay) — bản nháp tách khỏi dữ liệu server
  const [draft, setDraft] = useState<ImageDraft | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [genError, setGenError] = useState<string | null>(null);
  const [genSubmitting, setGenSubmitting] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);

  // Select model ở hàng hành động — danh sách live + auto-save khi chọn
  const {
    models: liveModels,
    loading: modelsLoading,
    load: loadModels,
  } = useGeminiImageModels();
  const [modelSaving, setModelSaving] = useState(false);

  const [zoomed, setZoomed] = useState(false);

  // Job image-gen đang chạy/vừa xong của dự án này — tiến trình thật qua SSE
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const activeJobIdRef = useRef<string | null>(null);
  const lingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const { providers } = useProviders();
  const gemini = providers?.find((p) => p.id === "gemini");
  const geminiConnected = gemini?.connected === true;

  const load = useCallback(async () => {
    try {
      const p = await getImageProject(imageId);
      setProj(p);
      setError(null);
      // chỉ khởi tạo draft lần đầu — không ghi đè khi user đang sửa form
      setDraft(
        (d) =>
          d ?? {
            prompt: p.prompt,
            kind: p.kind,
            aspect: p.aspect,
            overlay: p.overlay,
            model: p.model,
            styleId: p.styleId ?? null,
          }
      );
      setNameDraft((n) => n ?? p.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [imageId]);

  useEffect(() => {
    load();
  }, [load]);

  // Mới mở trang: tìm job image-gen của dự án này còn queued/running → bám theo
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const jobs = await getJobs(50);
        const j = jobs.find(
          (x) =>
            x.type === "image-gen" &&
            x.projectId === imageId &&
            (x.status === "queued" || x.status === "running")
        );
        if (alive && j) {
          activeJobIdRef.current = j.id;
          setActiveJob({
            id: j.id,
            progress: j.progress,
            step: j.step,
            status: j.status,
          });
        }
      } catch {
        // không tìm được job đang chạy — SSE sẽ bắt kịp khi có event mới
      }
    })();
    return () => {
      alive = false;
    };
  }, [imageId]);

  // Dọn timer giữ card tiến trình khi rời trang
  useEffect(
    () => () => {
      if (lingerTimerRef.current) clearTimeout(lingerTimerRef.current);
    },
    []
  );

  // Job "image-gen" của dự án ảnh này → cập nhật tiến trình sống
  useJobEvents((job) => {
    if (job.type !== "image-gen" || job.projectId !== imageId) return;
    if (activeJobIdRef.current !== job.id) {
      // job mới → reset log của job cũ
      activeJobIdRef.current = job.id;
      setLogLines([]);
    }
    if (lingerTimerRef.current) {
      clearTimeout(lingerTimerRef.current);
      lingerTimerRef.current = null;
    }
    setActiveJob({
      id: job.id,
      progress: job.progress,
      step: job.step,
      status: job.status,
    });
    if (["done", "failed", "canceled"].includes(job.status)) {
      load();
      // giữ kết quả 3 giây cho user kịp thấy rồi mới ẩn card tiến trình
      lingerTimerRef.current = setTimeout(() => {
        lingerTimerRef.current = null;
        activeJobIdRef.current = null;
        setActiveJob(null);
        setLogLines([]);
      }, JOB_LINGER_MS);
    } else {
      setProj((p) => (p ? { ...p, status: "generating" } : p));
    }
  });

  // Log từng dòng của job đang theo dõi → khối "Xem log"
  useJobLogEvents((e) => {
    if (e.jobId !== activeJobIdRef.current) return;
    setLogLines((cur) => [...cur.slice(-(MAX_LOG_LINES - 1)), e.line]);
  });

  // Auto-scroll xuống dòng log mới nhất
  useEffect(() => {
    const el = logBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLines]);

  // Đóng lightbox bằng Escape
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  const jobRunning =
    activeJob !== null &&
    (activeJob.status === "queued" || activeJob.status === "running");
  const generating = proj?.status === "generating" || jobRunning;

  async function onSave() {
    if (!draft || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const p = await updateImageProject(imageId, {
        ...(nameDraft && nameDraft.trim() ? { name: nameDraft.trim() } : {}),
        prompt: draft.prompt,
        kind: draft.kind,
        aspect: draft.aspect,
        overlay: draft.overlay,
        model: draft.model,
        styleId: draft.styleId,
      });
      setProj(p);
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function runGenerate(step: ImageGenStep) {
    if (genSubmitting || generating) return;
    setGenSubmitting(true);
    setGenError(null);
    try {
      // Form đang sửa dở → lưu trước để job dùng đúng prompt/overlay/model mới nhất
      if (draft) await onSaveSilent();
      const job = await generateImage(imageId, step);
      // Bám theo job ngay — không chờ event SSE đầu tiên
      activeJobIdRef.current = job.id;
      setLogLines([]);
      setActiveJob({
        id: job.id,
        progress: job.progress,
        step: job.step,
        status: job.status,
      });
      setProj((p) => (p ? { ...p, status: "generating" } : p));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenSubmitting(false);
    }
  }

  /** Lưu form không hiện cờ "Đã lưu" — dùng trước khi chạy generate. */
  async function onSaveSilent() {
    if (!draft) return;
    const p = await updateImageProject(imageId, {
      ...(nameDraft && nameDraft.trim() ? { name: nameDraft.trim() } : {}),
      prompt: draft.prompt,
      kind: draft.kind,
      aspect: draft.aspect,
      overlay: draft.overlay,
      model: draft.model,
      styleId: draft.styleId,
    });
    setProj(p);
  }

  /** Chọn model ở hàng hành động → PUT ngay (auto-save, không cần bấm Lưu). */
  async function onModelChange(next: string | null) {
    setDraft((d) => (d ? { ...d, model: next } : d));
    setModelSaving(true);
    setGenError(null);
    try {
      setProj(await updateImageProject(imageId, { model: next }));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelSaving(false);
    }
  }

  async function onUploadBackground(file: File) {
    setUploadingBg(true);
    setGenError(null);
    try {
      setProj(await uploadImageBackground(imageId, file));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingBg(false);
    }
  }

  async function onDelete() {
    if (
      !window.confirm(
        `Xóa dự án ảnh "${proj?.name ?? imageId}"? Toàn bộ image-projects/${imageId} sẽ bị xóa.`
      )
    )
      return;
    try {
      await deleteImageProject(imageId);
      router.push("/images");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const geminiTooltip = geminiConnected
    ? undefined
    : "Chưa kết nối Gemini — thêm GEMINI_API_KEY (hoặc GOOGLE_API_KEY) vào .env rồi khởi động lại server, hoặc dùng nút Tải nền lên.";

  // Select model gọn ở hàng hành động — live list, fallback danh sách tĩnh
  const currentModel = draft?.model ?? proj?.model ?? null;
  const modelOptions = liveModels ?? gemini?.models ?? [];
  const modelMissing =
    currentModel !== null && !modelOptions.some((m) => m.id === currentModel);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={proj?.name ?? imageId}
        subtitle={
          proj
            ? `${KIND_LABEL[proj.kind]} · cập nhật ${formatRelative(proj.updatedAt)}`
            : undefined
        }
        actions={
          <Button variant="secondary" onClick={() => router.push("/images")}>
            <ArrowLeft size={15} strokeWidth={2} />
            Dự án ảnh
          </Button>
        }
      />

      {proj && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
          <ImageStatusBadge status={proj.status} />
          <AspectChip aspect={proj.aspect} />
          <span>ID: {proj.id}</span>
        </div>
      )}

      {error && (
        <ErrorBanner message="Không tải được dự án ảnh." detail={error} />
      )}
      {proj?.status === "error" && proj.error && (
        <ErrorBanner message="Lần tạo ảnh gần nhất bị lỗi." detail={proj.error} />
      )}

      <div className="grid items-start gap-4 xl:grid-cols-5">
        {/* Cột trái — ảnh */}
        <div className="flex flex-col gap-4 xl:col-span-3">
          <Card
            title="Ảnh final"
            actions={
              proj?.final ? (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setZoomed(true)}
                    className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                  >
                    <Maximize2 size={13} strokeWidth={2} />
                    Phóng to
                  </button>
                  <a
                    href={imageFileUrl(imageId, proj.final, proj.updatedAt)}
                    download
                    className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                  >
                    <Download size={13} strokeWidth={2} />
                    Tải xuống
                  </a>
                </div>
              ) : undefined
            }
          >
            {(activeJob || generating) && (
              <div
                className={`flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 ${
                  proj?.final ? "mb-3" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium">
                    Tiến trình tạo ảnh
                  </span>
                  <span
                    className={`badge ${
                      JOB_STATUS_TONE[activeJob?.status ?? "running"]
                    }`}
                  >
                    <span
                      className={`badge-dot ${
                        !activeJob || jobRunning ? "badge-dot-pulse" : ""
                      }`}
                    />
                    {JOB_STATUS_LABEL[activeJob?.status ?? "running"]}
                  </span>
                </div>
                {activeJob ? (
                  <ProgressBar
                    progress={activeJob.progress}
                    step={activeJob.step || undefined}
                  />
                ) : (
                  <div
                    className="progress-indeterminate"
                    aria-label="Đang tạo ảnh"
                  />
                )}
                {activeJob?.status === "failed" && (
                  <ErrorBanner
                    message="Tạo ảnh thất bại."
                    detail={proj?.error ?? undefined}
                  />
                )}
                {logLines.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--text)]">
                      Xem log ({logLines.length} dòng)
                    </summary>
                    <div
                      ref={logBoxRef}
                      className="mt-2 max-h-40 overflow-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs whitespace-pre-wrap"
                    >
                      {logLines.join("\n")}
                    </div>
                  </details>
                )}
              </div>
            )}
            {proj?.final ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageFileUrl(imageId, proj.final, proj.updatedAt)}
                alt={`Ảnh final — ${proj.name}`}
                className="mx-auto max-h-[480px] max-w-full rounded-[var(--radius)] bg-[var(--bg-subtle)]"
              />
            ) : !generating && !activeJob ? (
              <EmptyState
                icon={ImageIcon}
                description="Chưa có ảnh final. Tạo ảnh nền rồi bấm Hoàn thiện thiết kế — hoặc Tạo tất cả."
              />
            ) : null}
          </Card>

          <Card title="Các bước">
            <div className="grid grid-cols-2 gap-3">
              <StepThumb
                label="Background (Gemini / tải lên)"
                relPath={
                  proj?.background
                    ? `image-projects/${imageId}/${proj.background}?v=${encodeURIComponent(proj.updatedAt)}`
                    : null
                }
                alt="Ảnh nền"
              />
              <StepThumb
                label="Final (Remotion)"
                relPath={
                  proj?.final
                    ? `image-projects/${imageId}/${proj.final}?v=${encodeURIComponent(proj.updatedAt)}`
                    : null
                }
                alt="Ảnh hoàn thiện"
              />
            </div>
          </Card>
        </div>

        {/* Cột phải — hành động + form */}
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Card title="Tạo ảnh">
            <div className="flex flex-col gap-3">
              {genError && (
                <ErrorBanner message="Không chạy được." detail={genError} />
              )}

              {/* Hành động chính — full-width, một chạm */}
              <span title={geminiTooltip} className="block">
                <Button
                  className="h-10 w-full"
                  disabled={genSubmitting || generating || !geminiConnected}
                  onClick={() => runGenerate("all")}
                >
                  <Zap size={15} strokeWidth={2} />
                  Tạo tất cả
                </Button>
              </span>

              {/* Model tạo nền — live list, auto-save khi chọn */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="label" htmlFor="image-quick-model">
                    Model tạo nền
                  </label>
                  {(modelsLoading || modelSaving) && (
                    <span className="mb-1.5 flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                      <Loader2
                        size={11}
                        strokeWidth={2}
                        className="animate-spin"
                      />
                      {modelsLoading ? "Đang tải model…" : "Đang lưu…"}
                    </span>
                  )}
                </div>
                <select
                  id="image-quick-model"
                  className="input h-9 text-[13px]"
                  value={currentModel ?? ""}
                  disabled={modelSaving}
                  onFocus={loadModels}
                  onChange={(e) => onModelChange(e.target.value || null)}
                >
                  <option value="">Mặc định (Nano Banana 2)</option>
                  {modelMissing && (
                    <option value={currentModel!}>{currentModel}</option>
                  )}
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Chạy từng bước riêng lẻ */}
              <div className="grid grid-cols-2 gap-2">
                <span title={geminiTooltip} className="min-w-0">
                  <Button
                    variant="secondary"
                    small
                    className="w-full"
                    disabled={genSubmitting || generating || !geminiConnected}
                    onClick={() => runGenerate("background")}
                  >
                    <Wand2 size={14} strokeWidth={2} />
                    Tạo nền (Gemini)
                  </Button>
                </span>
                <span
                  className="min-w-0"
                  title={
                    proj?.background
                      ? undefined
                      : "Cần có ảnh nền trước — tạo bằng Gemini hoặc tải lên."
                  }
                >
                  <Button
                    variant="secondary"
                    small
                    className="w-full"
                    disabled={genSubmitting || generating || !proj?.background}
                    onClick={() => runGenerate("compose")}
                  >
                    <Layers size={14} strokeWidth={2} />
                    Hoàn thiện (Remotion)
                  </Button>
                </span>
              </div>
              {!geminiConnected && gemini && (
                <p className="text-xs text-[var(--text-muted)]">
                  Gemini chưa kết nối — thêm GEMINI_API_KEY vào .env, hoặc tải
                  nền lên thủ công rồi Hoàn thiện thiết kế.
                </p>
              )}

              {/* Hàng phụ — thao tác ít dùng */}
              <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                <button
                  type="button"
                  disabled={uploadingBg || generating}
                  title="Tải ảnh nền lên thủ công — không cần Gemini"
                  className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => bgInputRef.current?.click()}
                >
                  <Upload size={13} strokeWidth={2} />
                  {uploadingBg ? "Đang tải nền…" : "Tải nền lên…"}
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs font-medium text-[var(--danger)] transition-colors duration-150 hover:opacity-75"
                  onClick={onDelete}
                >
                  <Trash2 size={13} strokeWidth={2} />
                  Xóa dự án
                </button>
              </div>
              <input
                ref={bgInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadBackground(f);
                  e.target.value = "";
                }}
              />
            </div>
          </Card>

          <Card title="Thiết lập">
            {draft ? (
              <div className="flex flex-col gap-3">
                {saveError && (
                  <ErrorBanner message="Không lưu được." detail={saveError} />
                )}
                <p className="text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                  Nội dung
                </p>
                <div>
                  <label className="label" htmlFor="image-edit-name">
                    Tên
                  </label>
                  <input
                    id="image-edit-name"
                    className="input"
                    value={nameDraft ?? ""}
                    disabled={saving}
                    onChange={(e) => {
                      setNameDraft(e.target.value);
                      setSaved(false);
                    }}
                  />
                </div>
                <ImageProjectFields
                  value={draft}
                  onChange={(p) => {
                    setDraft((d) => (d ? { ...d, ...p } : d));
                    setSaved(false);
                  }}
                  disabled={saving}
                  idPrefix="image-edit"
                  showModel={false}
                  sectioned
                />
                <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
                  <Button
                    className="w-full"
                    onClick={onSave}
                    disabled={saving}
                  >
                    <Save size={15} strokeWidth={2} />
                    {saving ? "Đang lưu…" : "Lưu thay đổi"}
                  </Button>
                  {saved && (
                    <span className="text-center text-sm text-[var(--success)]">
                      Đã lưu.
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-[var(--text-muted)]">
                Đang tải…
              </p>
            )}
          </Card>
        </div>
      </div>

      {/* Lightbox phóng to ảnh final */}
      {zoomed && proj?.final && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--text)]/80 p-6"
          onClick={() => setZoomed(false)}
          role="dialog"
          aria-label="Xem ảnh phóng to"
        >
          <button
            type="button"
            aria-label="Đóng"
            onClick={() => setZoomed(false)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg)] text-[var(--text)] shadow-[var(--shadow-card)] transition-colors duration-150 hover:bg-[var(--bg-subtle)]"
          >
            <X size={16} strokeWidth={2} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageFileUrl(imageId, proj.final, proj.updatedAt)}
            alt={`Ảnh final — ${proj.name}`}
            className="max-h-[92vh] max-w-full rounded-[var(--radius-lg)]"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
