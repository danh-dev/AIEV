"use client";

import {
  Check,
  ChevronDown,
  Eye,
  FileText,
  Film,
  FolderUp,
  Image as ImageIcon,
  Loader2,
  Music,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Save,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  DEFAULT_ADJUST,
  GRADE_LABELS,
  getGradePresets,
  getGradePreviews,
  isDefaultAdjust,
  mediaUrl,
  renderGradeFrame,
  setAssetGrade,
  toGradeAdjust,
  updateAssetDescription,
  uploadAsset,
  type FileInfo,
  type GradeAdjust,
  type GradePreviewResult,
} from "@/lib/api";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { formatBytes, isRecentFile } from "@/lib/format";

/** Placeholder mô tả cụ thể theo loại file — gợi ý người dùng viết gì. */
const DESCRIPTION_PLACEHOLDER: Record<FileInfo["kind"], string> = {
  image: "vd: Ảnh bìa sách, chèn khi nhắc tới tên sách",
  video: "vd: Video chính, talking-head giới thiệu sách",
  audio: "vd: Nhạc nền, phát từ đầu đến cuối",
  other: "Mô tả file này để AI biết dùng vào lúc nào…",
};

/** Auto-grow textarea theo nội dung, tối đa ~5 dòng. */
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
}

/** Thứ tự nhóm asset khi danh sách dài (>5 file). */
const KIND_GROUPS: { kind: FileInfo["kind"]; label: string }[] = [
  { kind: "video", label: "Video" },
  { kind: "image", label: "Ảnh" },
  { kind: "audio", label: "Âm thanh" },
  { kind: "other", label: "Khác" },
];

/** Icon nhỏ theo loại file — dùng cho dòng compact. */
function KindIcon({ kind }: { kind: FileInfo["kind"] }) {
  const cls = "shrink-0 text-[var(--text-muted)]";
  switch (kind) {
    case "video":
      return <Film size={16} strokeWidth={1.75} className={cls} />;
    case "audio":
      return <Music size={16} strokeWidth={1.75} className={cls} />;
    case "image":
      return <ImageIcon size={16} strokeWidth={1.75} className={cls} />;
    default:
      return <FileText size={16} strokeWidth={1.75} className={cls} />;
  }
}

function AssetPreview({
  file,
  playing,
  onTogglePlay,
}: {
  file: FileInfo;
  playing: boolean;
  onTogglePlay: () => void;
}) {
  const base =
    "flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius)] bg-[var(--bg-subtle)] border border-[var(--border)]";
  switch (file.kind) {
    case "image":
      return (
        <span className={base}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mediaUrl(file.relPath) + "?v=" + encodeURIComponent(file.mtime)}
            alt={file.name}
            className="h-full w-full object-cover"
          />
        </span>
      );
    case "video":
      return (
        <span className={base}>
          <video
            src={mediaUrl(file.relPath) + "?v=" + encodeURIComponent(file.mtime)}
            className="h-full w-full object-cover"
            muted
            playsInline
            preload="metadata"
            controls={false}
          />
        </span>
      );
    case "audio":
      return (
        <span className={`${base} flex-col gap-0.5`}>
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={playing ? "Dừng" : "Nghe thử"}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)] transition-colors duration-150 hover:bg-[var(--primary)] hover:text-[var(--primary-soft)]"
          >
            {playing ? (
              <Pause size={14} strokeWidth={2} />
            ) : (
              <Play size={14} strokeWidth={2} />
            )}
          </button>
          <Music size={12} strokeWidth={1.75} className="text-[var(--text-muted)]" />
        </span>
      );
    default:
      return (
        <span className={base}>
          <FileText
            size={20}
            strokeWidth={1.5}
            className="text-[var(--text-muted)]"
          />
        </span>
      );
  }
}

export function ProjectAssetsCard({
  projectId,
  assets,
  onChanged,
  compact = false,
  title = "Nguồn & Asset",
  showUpload = true,
}: {
  projectId: string;
  assets: FileInfo[];
  onChanged: () => void;
  /** Chế độ gọn sau khi đã bắt đầu edit — mỗi asset một dòng, click mở chi tiết. */
  compact?: boolean;
  /** Tiêu đề card — dùng khi tách khối (Sound Effect, Khác). */
  title?: string;
  /** false = khối chỉ hiển thị (không dropzone/nút tải lên) — upload dồn về khối chính. */
  showUpload?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Dòng compact đang mở rộng (xem preview + sửa mô tả)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  // Asset video đang mở modal duyệt chỉnh màu
  const [gradeFile, setGradeFile] = useState<FileInfo | null>(null);

  // Nhãn preset màu — nguồn chính: GET /api/grade-presets (GRADE_LABELS chỉ là fallback)
  const [gradeLabels, setGradeLabels] =
    useState<Record<string, string>>(GRADE_LABELS);
  useEffect(() => {
    let alive = true;
    getGradePresets()
      .then((list) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const p of list) map[p.id] = p.label;
        setGradeLabels((cur) => ({ ...cur, ...map }));
      })
      .catch(() => {
        // Im lặng — chip sẽ dùng GRADE_LABELS fallback hoặc id thô
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Nhãn hiển thị màu của một asset — "Cinematic", "Cinematic +" (có chỉnh tay), "Tùy chỉnh"… */
  function gradeLabelOf(f: FileInfo): string | null {
    const hasAdjust = !isDefaultAdjust(f.colorAdjust);
    if (!f.colorGrade && !hasAdjust) return null;
    const base = f.colorGrade
      ? (gradeLabels[f.colorGrade] ?? f.colorGrade)
      : "Tùy chỉnh";
    return hasAdjust && f.colorGrade ? `${base} +` : base;
  }

  // Bản nháp mô tả từng file — chỉ giữ khi người dùng đã gõ (không clobber khi reload)
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingFile, setSavingFile] = useState<string | null>(null);
  const [savedFile, setSavedFile] = useState<string | null>(null);

  // Nghe thử audio: một element dùng chung
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    []
  );

  function togglePlay(file: FileInfo) {
    if (playing === file.name) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(
      mediaUrl(file.relPath) + "?v=" + encodeURIComponent(file.mtime)
    );
    audio.onended = () => setPlaying(null);
    audio.onerror = () => {
      setPlaying(null);
      setError(`Không phát được file ${file.name}.`);
    };
    audioRef.current = audio;
    setPlaying(file.name);
    audio.play().catch(() => setPlaying(null));
  }

  const uploadFiles = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list);
      if (files.length === 0) return;
      setUploading(true);
      setError(null);
      try {
        for (const f of files) {
          await uploadAsset(f, "project", projectId);
        }
        onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading(false);
      }
    },
    [projectId, onChanged]
  );

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  }

  async function saveDescription(file: FileInfo) {
    const draft = drafts[file.name];
    if (draft === undefined || draft === (file.description ?? "")) return;
    setSavingFile(file.name);
    setError(null);
    try {
      await updateAssetDescription(projectId, file.name, draft.trim());
      setDrafts((d) => {
        const next = { ...d };
        delete next[file.name];
        return next;
      });
      setSavedFile(file.name);
      setTimeout(() => setSavedFile((v) => (v === file.name ? null : v)), 2500);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingFile(null);
    }
  }

  const renderItem = compact ? renderCompactRow : renderRow;

  // Modal duyệt chỉnh màu — dùng chung cho cả hai layout (compact và đầy đủ)
  const gradeModal = gradeFile ? (
    <GradeModal
      projectId={projectId}
      file={gradeFile}
      onClose={() => setGradeFile(null)}
      onSaved={() => {
        setGradeFile(null);
        onChanged();
      }}
    />
  ) : null;

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept="video/*,image/*,audio/*"
      className="hidden"
      onChange={(e) => {
        if (e.target.files) uploadFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );

  const assetList =
    assets.length === 0 ? (
      <EmptyState
        icon={FolderUp}
        description="Chưa có asset nào. Tải lên video source, ảnh, nhạc nền… để AI dùng khi edit."
      />
    ) : assets.length > 5 ? (
      // Danh sách dài → phân nhóm theo loại cho dễ nhìn (sound effect AI chép
      // vào nằm nhóm Âm thanh)
      <div className={`${compact ? "mt-1" : "mt-4"} flex flex-col gap-4`}>
        {KIND_GROUPS.map(({ kind, label }) => {
          const group = assets.filter((f) => f.kind === kind);
          if (group.length === 0) return null;
          return (
            <div key={kind}>
              <p className="mb-1 text-xs font-medium uppercase tracking-[0.04em] text-[var(--text-muted)]">
                {label} · {group.length}
              </p>
              <div className="flex flex-col divide-y divide-[var(--border)]">
                {group.map(renderItem)}
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <div
        className={`${compact ? "mt-1" : "mt-4"} flex flex-col divide-y divide-[var(--border)]`}
      >
        {assets.map(renderItem)}
      </div>
    );

  if (compact || !showUpload) {
    // Compact (hoặc khối chỉ hiển thị): bỏ dropzone to — nút "Tải lên" nhỏ ở
    // header card, cả card vẫn nhận kéo thả file khi showUpload.
    return (
      <div
        onDragOver={
          showUpload
            ? (e) => {
                e.preventDefault();
                setDragOver(true);
              }
            : undefined
        }
        onDragLeave={showUpload ? () => setDragOver(false) : undefined}
        onDrop={showUpload ? onDrop : undefined}
        className={`rounded-[var(--radius-lg)] transition-shadow duration-150 ${
          dragOver ? "ring-2 ring-[var(--primary)]" : ""
        }`}
      >
        <Card
          title={title}
          actions={
            showUpload ? (
              <Button
                variant="secondary"
                small
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
              >
                <Upload size={13} strokeWidth={2} />
                {uploading ? "Đang tải lên…" : "Tải lên"}
              </Button>
            ) : undefined
          }
        >
          {error && <ErrorBanner message={error} />}
          {showUpload && fileInput}
          {dragOver && (
            <p className="mb-2 rounded-[var(--radius)] bg-[var(--primary-soft)] px-3 py-1.5 text-xs font-medium text-[var(--primary)]">
              Thả file vào đây để tải lên…
            </p>
          )}
          {assetList}
        </Card>
        {gradeModal}
      </div>
    );
  }

  return (
    <Card title={title}>
      {error && <ErrorBanner message={error} />}

      {/* Vùng kéo thả + upload */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed px-4 py-6 text-center transition-colors duration-150 ${
          dragOver
            ? "border-[var(--primary)] bg-[var(--primary-soft)]"
            : "border-[var(--border)] bg-[var(--bg-subtle)]"
        }`}
      >
        <FolderUp
          size={24}
          strokeWidth={1.5}
          className="text-[var(--text-muted)]"
        />
        <p className="text-sm text-[var(--text-muted)]">
          Kéo thả video, ảnh, audio vào đây — hoặc
        </p>
        <Button
          variant="secondary"
          small
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={14} strokeWidth={2} />
          {uploading ? "Đang tải lên…" : "Chọn file tải lên"}
        </Button>
        {fileInput}
      </div>

      {/* Danh sách asset */}
      {assetList}
      {gradeModal}
    </Card>
  );

  /** Ô sửa mô tả cho AI — dùng chung cho row đầy đủ và row compact mở rộng. */
  function renderDescriptionEditor(f: FileInfo) {
    const value = drafts[f.name] ?? f.description ?? "";
    const dirty =
      drafts[f.name] !== undefined &&
      drafts[f.name] !== (f.description ?? "");
    return (
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex h-6 items-center justify-between gap-2">
          <label
            className="text-xs font-medium text-[var(--text-muted)]"
            htmlFor={`asset-desc-${f.relPath}`}
          >
            Mô tả cho AI
          </label>
          {savedFile === f.name && !dirty ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--success)]">
              <Check size={13} strokeWidth={2.5} />
              Đã lưu
            </span>
          ) : dirty ? (
            <Button
              variant="secondary"
              small
              className="h-6 px-2 text-xs"
              disabled={savingFile === f.name}
              onClick={() => saveDescription(f)}
              aria-label={`Lưu mô tả ${f.name}`}
            >
              <Save size={12} strokeWidth={2} />
              {savingFile === f.name ? "Đang lưu…" : "Lưu"}
            </Button>
          ) : null}
        </div>
        <textarea
          id={`asset-desc-${f.relPath}`}
          className="input min-h-[62px] w-full resize-none overflow-hidden text-[13px] leading-relaxed"
          rows={2}
          value={value}
          placeholder={DESCRIPTION_PLACEHOLDER[f.kind]}
          ref={(el) => {
            if (el) autoGrow(el);
          }}
          onChange={(e) => {
            autoGrow(e.currentTarget);
            setDrafts((d) => ({ ...d, [f.name]: e.target.value }));
          }}
          onBlur={() => saveDescription(f)}
        />
      </div>
    );
  }

  /** Chip nhỏ hiện preset màu đã lưu — đặt cạnh badge "mới"/"Chưa mô tả". */
  function renderGradeChip(f: FileInfo) {
    if (f.kind !== "video") return null;
    const label = gradeLabelOf(f);
    if (!label) return null;
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--primary-soft)] px-1.5 py-0.5 text-[11px] font-medium leading-none text-[var(--primary)]">
        <Palette size={10} strokeWidth={2} />
        {label}
      </span>
    );
  }

  /** Nút mở modal duyệt chỉnh màu — chỉ cho asset video. */
  function renderGradeButton(f: FileInfo) {
    if (f.kind !== "video") return null;
    const label = gradeLabelOf(f);
    return (
      <div>
        <Button
          variant="secondary"
          small
          className="h-6 px-2 text-xs"
          onClick={() => setGradeFile(f)}
          aria-label={`Chỉnh màu ${f.name}`}
        >
          <Palette size={12} strokeWidth={2} />
          {label ? (
            <>
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--primary)]"
              />
              Màu: {label}
            </>
          ) : (
            "Chỉnh màu"
          )}
        </Button>
      </div>
    );
  }

  function renderRow(f: FileInfo) {
    const value = drafts[f.name] ?? f.description ?? "";
    const missing = !(f.description ?? "").trim() && !value.trim();
    return (
      <div key={f.relPath} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
        {/* Hàng trên: thumbnail + tên + size + badge */}
        <div className="flex items-center gap-3">
          <AssetPreview
            file={f}
            playing={playing === f.name}
            onTogglePlay={() => togglePlay(f)}
          />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{f.name}</span>
            {isRecentFile(f.mtime) && (
              <span className="rounded-full bg-[var(--primary-soft)] px-1.5 py-0.5 text-[11px] font-medium leading-none text-[var(--primary)]">
                mới
              </span>
            )}
            <span className="text-xs text-[var(--text-muted)]">
              {formatBytes(f.size)}
            </span>
            {renderGradeChip(f)}
            {missing && <Badge tone="danger" label="Chưa mô tả" />}
          </div>
        </div>

        {/* Hàng dưới: mô tả full-width + nút chỉnh màu (video) */}
        {renderDescriptionEditor(f)}
        {renderGradeButton(f)}
      </div>
    );
  }

  /** Row compact: một dòng gọn, click mở rộng inline xem preview + sửa mô tả. */
  function renderCompactRow(f: FileInfo) {
    const value = drafts[f.name] ?? f.description ?? "";
    const missing = !(f.description ?? "").trim() && !value.trim();
    const open = !!expandedRows[f.relPath];
    return (
      <div key={f.relPath} className="py-1.5 first:pt-0 last:pb-0">
        <button
          type="button"
          onClick={() =>
            setExpandedRows((m) => ({ ...m, [f.relPath]: !m[f.relPath] }))
          }
          aria-expanded={open}
          className="flex w-full items-center gap-2 rounded-[var(--radius)] px-1 py-1 text-left transition-colors duration-150 hover:bg-[var(--bg-subtle)]"
        >
          <KindIcon kind={f.kind} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {f.name}
          </span>
          <span className="shrink-0 text-xs text-[var(--text-muted)]">
            {formatBytes(f.size)}
          </span>
          {isRecentFile(f.mtime) && (
            <span className="shrink-0 rounded-full bg-[var(--primary-soft)] px-1.5 py-0.5 text-[11px] font-medium leading-none text-[var(--primary)]">
              mới
            </span>
          )}
          {renderGradeChip(f)}
          {missing && (
            <span className="shrink-0">
              <Badge tone="danger" label="Chưa mô tả" />
            </span>
          )}
          <ChevronDown
            size={14}
            strokeWidth={2}
            className={`shrink-0 text-[var(--text-muted)] transition-transform duration-150 ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
        {open && (
          <div className="flex items-start gap-3 px-1 pb-2 pt-2">
            <AssetPreview
              file={f}
              playing={playing === f.name}
              onTogglePlay={() => togglePlay(f)}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {renderDescriptionEditor(f)}
              {renderGradeButton(f)}
            </div>
          </div>
        )}
      </div>
    );
  }
}

/** Cấu hình 6 slider chỉnh tay — range khớp GradeAdjust phía server. */
const ADJUST_SLIDERS: {
  key: keyof GradeAdjust;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}[] = [
  {
    key: "brightness",
    label: "Độ sáng",
    min: -0.3,
    max: 0.3,
    step: 0.01,
    fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`,
  },
  {
    key: "contrast",
    label: "Tương phản",
    min: 0.7,
    max: 1.4,
    step: 0.01,
    fmt: (v) => v.toFixed(2),
  },
  {
    key: "saturation",
    label: "Bão hòa",
    min: 0,
    max: 2,
    step: 0.01,
    fmt: (v) => v.toFixed(2),
  },
  {
    key: "gamma",
    label: "Gamma",
    min: 0.7,
    max: 1.4,
    step: 0.01,
    fmt: (v) => v.toFixed(2),
  },
  {
    key: "temperature",
    label: "Nhiệt độ màu (K)",
    min: 4000,
    max: 9500,
    step: 50,
    fmt: (v) => `${Math.round(v)} K`,
  },
  {
    key: "vibrance",
    label: "Vibrance",
    min: -0.5,
    max: 0.5,
    step: 0.01,
    fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`,
  },
];

/**
 * CSS filter XẤP XỈ thông số chỉnh tay — áp tức thì lên ảnh preview cho cảm
 * giác realtime khi kéo slider; ảnh CHÍNH XÁC từ grade-frame sẽ thay thế sau.
 * Gamma/nhiệt độ màu chỉ gần đúng (CSS không có filter tương ứng 1:1).
 */
function cssApprox(a: GradeAdjust): string | undefined {
  const f: string[] = [];
  // eq brightness của FFmpeg là cộng (-1..1) → xấp xỉ bằng brightness nhân của CSS
  if (a.brightness !== 0) f.push(`brightness(${(1 + a.brightness).toFixed(3)})`);
  if (a.contrast !== 1) f.push(`contrast(${a.contrast.toFixed(3)})`);
  // vibrance gộp tương đối vào saturate
  const sat = a.saturation * (1 + a.vibrance * 0.6);
  if (sat !== 1) f.push(`saturate(${Math.max(0, sat).toFixed(3)})`);
  // gamma > 1 sáng vùng mid → xấp xỉ nhẹ bằng brightness
  if (a.gamma !== 1) f.push(`brightness(${(1 + (a.gamma - 1) * 0.5).toFixed(3)})`);
  if (a.temperature !== 6500) {
    const k = (6500 - a.temperature) / 2500; // >0 = ấm hơn, <0 = lạnh hơn
    if (k > 0) f.push(`sepia(${Math.min(0.45, k * 0.45).toFixed(3)})`);
    else f.push(`hue-rotate(${(Math.max(-1.2, k) * -10).toFixed(1)}deg)`);
  }
  return f.length ? f.join(" ") : undefined;
}

/**
 * Modal duyệt chỉnh màu cho một asset video — bố cục 2 khung:
 * trái = preview lớn (kèm giữ nút "So với gốc" để so A/B), phải = lưới template
 * màu (ảnh grade-preview có sẵn) + 6 slider chỉnh tay. Kéo slider áp CSS filter
 * xấp xỉ ngay, debounce 500ms gọi grade-frame lấy ảnh chính xác thay thế.
 * Lưu bằng PUT /grade với preset + adjust.
 */
function GradeModal({
  projectId,
  file,
  onClose,
  onSaved,
}: {
  projectId: string;
  file: FileInfo;
  onClose: () => void;
  /** Gọi sau khi lưu thành công — cha đóng modal + reload danh sách asset. */
  onSaved: () => void;
}) {
  const [result, setResult] = useState<GradePreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Preset đang chọn: null = "Gốc" (không chỉnh màu)
  const [selected, setSelected] = useState<string | null>(
    file.colorGrade ?? null
  );
  // Thông số chỉnh tay — khởi tạo theo colorAdjust đã lưu (nếu có)
  const savedAdjust = useMemo(() => toGradeAdjust(file.colorAdjust), [file]);
  const [adjust, setAdjust] = useState<GradeAdjust>(savedAdjust);
  const [adjustOpen, setAdjustOpen] = useState(true);
  // Đang giữ nút "So với gốc" — khung trái tạm hiện ảnh Gốc
  const [comparing, setComparing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Ảnh CHÍNH XÁC từ grade-frame — key hóa theo tham số để biết còn khớp không
  const [exact, setExact] = useState<{ key: string; relPath: string } | null>(
    null
  );
  const [frameLoading, setFrameLoading] = useState(false);
  const seqRef = useRef(0);
  // Lần đầu mở modal với adjust đã lưu khác mặc định → gọi grade-frame ngay, không debounce
  const immediateRef = useRef(!isDefaultAdjust(savedAdjust));

  useEffect(() => {
    let alive = true;
    getGradePreviews(projectId, file.name)
      .then((r) => {
        if (alive) setResult(r);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [projectId, file.name]);

  const hasAdjust = !isDefaultAdjust(adjust);
  const paramsKey = JSON.stringify({ p: selected, a: adjust });

  // Debounce gọi grade-frame khi thông số chỉnh tay khác mặc định
  useEffect(() => {
    if (!hasAdjust || (exact && exact.key === paramsKey)) {
      setFrameLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    setFrameLoading(true);
    const delay = immediateRef.current ? 0 : 500;
    immediateRef.current = false;
    const t = setTimeout(() => {
      renderGradeFrame(projectId, file.name, selected, adjust)
        .then((r) => {
          if (seqRef.current !== seq) return; // đã có yêu cầu mới hơn
          setExact({ key: paramsKey, relPath: r.relPath });
          setFrameLoading(false);
        })
        .catch((e) => {
          if (seqRef.current !== seq) return;
          setFrameLoading(false);
          setError(e instanceof Error ? e.message : String(e));
        });
    }, delay);
    return () => clearTimeout(t);
  }, [paramsKey, hasAdjust, exact, selected, adjust, projectId, file.name]);

  /**
   * Click ô template: khung trái đổi ngay sang ảnh preview có sẵn (không gọi
   * API). Chọn lại đúng preset đã lưu → khôi phục thông số đã lưu; preset khác
   * → về mặc định để khớp với ảnh thumbnail.
   */
  function pickPreset(preset: string | null) {
    setSelected(preset);
    setAdjust(
      preset === (file.colorGrade ?? null) ? savedAdjust : { ...DEFAULT_ADJUST }
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await setAssetGrade(projectId, file.name, selected, adjust);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  // Ô "Gốc" (preset null) luôn đứng đầu lưới
  const previews = result
    ? [
        ...result.previews.filter((p) => p.preset === null),
        ...result.previews.filter((p) => p.preset !== null),
      ]
    : [];
  const originalSrc = previews.find((p) => p.preset === null)?.relPath ?? null;
  const selPreview = previews.find((p) => p.preset === selected) ?? null;
  const selLabel = selPreview?.label ?? (selected ?? "Gốc");
  const exactCurrent = exact && exact.key === paramsKey ? exact.relPath : null;

  // Nguồn ảnh khung trái + CSS filter xấp xỉ (chỉ khi chưa có ảnh chính xác)
  let mainSrc: string | null;
  let mainFilter: string | undefined;
  if (comparing) {
    mainSrc = originalSrc;
  } else if (!hasAdjust) {
    mainSrc = selPreview?.relPath ?? originalSrc;
  } else if (exactCurrent) {
    mainSrc = exactCurrent;
  } else {
    mainSrc = selPreview?.relPath ?? originalSrc;
    mainFilter = cssApprox(adjust);
  }

  // Đang ở "Gốc" thuần thì không có gì để so sánh
  const canCompare = !!result && (selected !== null || hasAdjust);

  return (
    <Modal
      wide
      open
      title={`Chỉnh màu — ${file.name}`}
      onClose={onClose}
      footer={
        <>
          <p className="mr-auto min-w-0 self-center text-xs text-[var(--text-muted)]">
            AI sẽ áp đúng màu bạn chọn ở đây lên toàn bộ video khi edit.
          </p>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Hủy
          </Button>
          <Button onClick={save} disabled={saving || !result}>
            {saving ? "Đang lưu…" : "Lưu lựa chọn"}
          </Button>
        </>
      }
    >
      {error && <ErrorBanner message={error} />}

      {!result && !error && (
        <div className="flex flex-col gap-3 py-10">
          <div className="progress-indeterminate" aria-label="Đang tạo preview màu" />
          <p className="text-center text-sm text-[var(--text-muted)]">
            Đang tạo preview… (mất vài giây)
          </p>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {/* ===== Khung TRÁI: preview lớn ===== */}
          <div className="flex min-w-0 flex-col gap-2 lg:w-[55%]">
            <div className="relative flex items-center justify-center overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)]">
              {mainSrc && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(mainSrc)}
                  alt={comparing ? "Gốc" : selLabel}
                  style={mainFilter ? { filter: mainFilter } : undefined}
                  className="max-h-[62vh] w-full object-contain"
                />
              )}
              {comparing && (
                <span className="absolute left-2 top-2 rounded-full bg-[var(--surface)] px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] shadow-[var(--shadow-card)]">
                  Gốc
                </span>
              )}
              {frameLoading && !comparing && (
                <span className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--surface)] px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] shadow-[var(--shadow-card)]">
                  <Loader2 size={12} strokeWidth={2} className="animate-spin" />
                  Đang render…
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium">
                {comparing ? "Gốc (đang so sánh)" : `${selLabel}${hasAdjust ? " +" : ""}`}
              </span>
              <Button
                variant="secondary"
                small
                className="select-none"
                disabled={!canCompare}
                onPointerDown={() => setComparing(true)}
                onPointerUp={() => setComparing(false)}
                onPointerLeave={() => setComparing(false)}
                onPointerCancel={() => setComparing(false)}
                onBlur={() => setComparing(false)}
                onContextMenu={(e) => e.preventDefault()}
                title="Giữ chuột để xem ảnh gốc, thả để quay lại"
              >
                <Eye size={13} strokeWidth={2} />
                So với gốc
              </Button>
            </div>
          </div>

          {/* ===== Khung PHẢI: template màu + điều chỉnh ===== */}
          <div className="flex min-w-0 flex-col gap-4 lg:max-h-[66vh] lg:w-[45%] lg:overflow-y-auto lg:pr-1">
            {result.info.needsTonemap && (
              <p className="rounded-[var(--radius)] bg-[var(--primary-soft)] px-3 py-2 text-xs font-medium text-[var(--primary)]">
                Footage HDR/log — hệ thống sẽ tự chuẩn hóa (delog) trước khi áp
                màu.
              </p>
            )}

            {/* Template màu */}
            <section className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                Template màu
              </p>
              <div className="grid grid-cols-3 gap-2">
                {previews.map((p) => {
                  const isSelected = selected === p.preset;
                  return (
                    <button
                      key={p.preset ?? "goc"}
                      type="button"
                      onClick={() => pickPreset(p.preset)}
                      aria-pressed={isSelected}
                      className={`overflow-hidden rounded-[var(--radius)] border-2 text-left transition-colors duration-150 ${
                        isSelected
                          ? "border-[var(--primary)]"
                          : "border-[var(--border)] hover:border-[var(--text-muted)]"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={mediaUrl(p.relPath)}
                        alt={p.label}
                        className="h-[90px] w-full bg-[var(--bg-subtle)] object-cover"
                      />
                      <span className="flex items-center justify-between gap-1 px-1.5 py-1">
                        <span
                          className={`truncate text-[11px] font-medium ${
                            isSelected ? "text-[var(--primary)]" : ""
                          }`}
                        >
                          {p.label}
                        </span>
                        {isSelected && (
                          <Check
                            size={12}
                            strokeWidth={2.5}
                            className="shrink-0 text-[var(--primary)]"
                          />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Điều chỉnh */}
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustOpen((v) => !v)}
                  aria-expanded={adjustOpen}
                  className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--text)]"
                >
                  Điều chỉnh
                  <ChevronDown
                    size={13}
                    strokeWidth={2}
                    className={`transition-transform duration-150 ${
                      adjustOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {hasAdjust && (
                  <button
                    type="button"
                    onClick={() => setAdjust({ ...DEFAULT_ADJUST })}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--text)]"
                  >
                    <RotateCcw size={11} strokeWidth={2} />
                    Đặt lại tất cả
                  </button>
                )}
              </div>

              {adjustOpen && (
                <div className="flex flex-col gap-2.5">
                  {ADJUST_SLIDERS.map((s) => {
                    const v = adjust[s.key];
                    const dirty = v !== DEFAULT_ADJUST[s.key];
                    const id = `grade-adjust-${s.key}`;
                    return (
                      <div key={s.key} className="flex flex-col gap-0.5">
                        <div className="flex h-5 items-center justify-between gap-2">
                          <label
                            htmlFor={id}
                            className="text-xs font-medium text-[var(--text-muted)]"
                          >
                            {s.label}
                          </label>
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`text-xs tabular-nums ${
                                dirty
                                  ? "font-medium text-[var(--text)]"
                                  : "text-[var(--text-muted)]"
                              }`}
                            >
                              {s.fmt(v)}
                            </span>
                            {dirty && (
                              <button
                                type="button"
                                aria-label={`Đặt lại ${s.label}`}
                                onClick={() =>
                                  setAdjust((a) => ({
                                    ...a,
                                    [s.key]: DEFAULT_ADJUST[s.key],
                                  }))
                                }
                                className="rounded-[var(--radius)] p-0.5 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
                              >
                                <RotateCcw size={11} strokeWidth={2} />
                              </button>
                            )}
                          </span>
                        </div>
                        <input
                          id={id}
                          type="range"
                          className="slider"
                          min={s.min}
                          max={s.max}
                          step={s.step}
                          value={v}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            setAdjust((a) => ({ ...a, [s.key]: n }));
                          }}
                        />
                      </div>
                    );
                  })}
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Ảnh xem trước chính xác sẽ cập nhật sau khi thả tay.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}
