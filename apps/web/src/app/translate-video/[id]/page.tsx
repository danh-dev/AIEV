"use client";

/**
 * Chi tiết một phiên "Dịch video" - lắp bằng bộ khối workspace 3 cột dùng chung
 * (`components/Workspace.tsx`), chia theo NHỊP LÀM VIỆC chứ không theo số bước:
 *
 * - Cột `source`: video gốc (tải lên, xem trước) và ngôn ngữ nguồn - thứ mình
 *   BẮT ĐẦU TỪ ĐÓ.
 * - Cột `setup`: ngôn ngữ đích, chế độ, danh sách câu thoại sửa tay được, và
 *   kiểu phụ đề kèm ô xem trước - toàn bộ phần "mình muốn ra cái gì".
 * - Cột `output`: khối video thành phẩm ĐỨNG ĐẦU (chạy thì nhấp nháy chờ, xong
 *   thì hiện thẳng video), rồi mới tới những thứ sinh ra trong lúc chạy: log bóc
 *   lời thoại, tiến trình dịch.
 *
 * Bề rộng cột do container query trong globals.css quyết định - trang KHÔNG tự
 * tính pixel, vì bề rộng thật còn phụ thuộc rail trái và panel phải đang gấp hay mở.
 *
 * Thanh bước dùng chung StepperBar với Videos Project - không tự vẽ thanh thứ hai.
 *
 * Phiên render xong (status "done") thì các khối khác tự gấp lại còn một dòng tóm
 * tắt, riêng khối video thành phẩm vẫn mở. Gấp/mở vẫn bấm tay được và ý người dùng
 * luôn thắng mặc định - xem `useCollapseGroup`.
 */

import {
  ArrowLeft,
  FileVideo,
  Film,
  Languages,
  Loader2,
  Subtitles,
  Trash2,
  Type,
  Upload,
  Wand2,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteTranslateVideo,
  getJob,
  getJobs,
  getTranslateVideo,
  isTranslateVideoJob,
  mediaUrl,
  renderTranslateVideo,
  SUBTITLE_BLUR_MAX,
  SUBTITLE_BOTTOM_MAX,
  SUBTITLE_FONT_SIZE_MAX,
  SUBTITLE_FONT_SIZE_MIN,
  SUBTITLE_FONTS,
  TRANSLATE_DEFAULT_SUBTITLE_STYLE,
  TRANSLATE_MODE_LABEL,
  TRANSLATE_SOURCE_LANGS,
  TRANSLATE_TARGET_LANGS,
  TRANSLATE_VIDEO_STATUS_LABEL,
  TRANSLATE_VIDEO_STATUS_TONE,
  transcribeTranslateVideo,
  translateTranslateVideo,
  updateTranslateVideo,
  uploadTranslateVideoSource,
  type Job,
  type SubtitleBackdrop,
  type SubtitleFontId,
  type SubtitleStyle,
  type TranslatedCue,
  type TranslateMode,
  type TranslateVideoMeta,
} from "@/lib/api";
import { useEvents, useJobEvents, useJobLogEvents } from "@/lib/useEvents";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { PageHeader } from "@/components/PageHeader";
import { StepperBar } from "@/components/PipelineTimeline";
import { ProgressBar } from "@/components/ProgressBar";
import {
  OutputBlock,
  useCollapseGroup,
  Workspace,
  WorkspaceBlock,
  WorkspaceColumn,
  type WorkspaceStatus,
} from "@/components/Workspace";
// clock() (giây → mm:ss) đã có sẵn ở đây, lib/format.ts chưa có helper tương đương
import { clock } from "@/components/AutoCutCommon";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

/** Gộp nhiều lần gõ phím thành một PATCH - không bắn request mỗi ký tự. */
const PATCH_DEBOUNCE_MS = 700;

/** Trạng thái nào là "đang có việc chạy" - lúc đó mọi ô nhập bị khóa. */
const RUNNING_STATUS = ["transcribing", "translating", "rendering"];

/**
 * Font stack thật của từng id trong allowlist - CHỈ dùng cho ô xem trước ở web.
 * Bản render cuối do server quyết định font file; chỗ này chỉ cần cho người dùng
 * thấy đúng dáng chữ trước khi tốn thời gian render.
 */
const FONT_STACK: Record<SubtitleFontId, string> = {
  vietnamese: "'Be Vietnam Pro', 'Inter', 'Segoe UI', system-ui, sans-serif",
  sans: "'Inter', 'Segoe UI', Arial, system-ui, sans-serif",
  serif: "'Noto Serif', Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', 'Consolas', ui-monospace, monospace",
};

/** Các khối của phiên - key vừa là id state gấp/mở vừa là id vùng nội dung. */
const TV_BLOCKS = [
  "source",
  "translation",
  "subtitle",
  "result",
  "transcript",
  "progress",
] as const;
type BlockKey = (typeof TV_BLOCKS)[number];

/**
 * Khối vẫn MỞ khi phiên xong: video thành phẩm. Xong việc thì người dùng vào
 * trang là để xem thành phẩm, không phải để sửa ô nhập nữa.
 */
const TV_KEEP_EXPANDED: readonly BlockKey[] = ["result"];

// Giá trị là KEY dictionary - StepperBar tự dịch bằng t() lúc render.
const STAGE_LABELS = [
  "tv.stage.source",
  "tv.stage.transcript",
  "tv.stage.translation",
  "tv.stage.subtitle",
  "tv.stage.result",
] as const;

/** Độ dài tối đa của lỗi hiện trong khối kết quả - xem `shortError`. */
const ERROR_PREVIEW_MAX = 240;

/**
 * Rút gọn lỗi cho khối kết quả. Lỗi thật (traceback faster-whisper, log ffmpeg)
 * dài hàng chục dòng, đổ nguyên vào khung video là đẩy mọi thứ khác xuống dưới
 * màn hình - bản đầy đủ vẫn nằm ở banner lỗi phía trên trang.
 */
function shortError(e: string | null | undefined): string | null {
  if (!e) return null;
  const s = e.replace(/\s+/g, " ").trim();
  return s.length > ERROR_PREVIEW_MAX ? `${s.slice(0, ERROR_PREVIEW_MAX)}…` : s;
}

/** Thay đổi đang chờ gửi - luôn gửi trọn từng khối con để server khỏi phải merge. */
interface Patch {
  name?: string;
  sourceLang?: string;
  targetLang?: string;
  mode?: TranslateMode;
  cues?: TranslatedCue[];
  subtitleStyle?: SubtitleStyle;
}

/**
 * Bước hiện tại suy từ dữ liệu phiên - backend vẫn là nguồn sự thật, chỗ này chỉ
 * đọc. `active` = đang có việc chạy (chấm nhấp nháy), `complete` = xong hết.
 */
function deriveTvStage(m: TranslateVideoMeta): {
  stage: number;
  active: boolean;
  complete: boolean;
} {
  if (m.status === "transcribing") return { stage: 2, active: true, complete: false };
  if (m.status === "translating") return { stage: 3, active: true, complete: false };
  if (m.status === "rendering") return { stage: 5, active: true, complete: false };
  if (m.status === "done") return { stage: 5, active: false, complete: true };
  // Các trạng thái đứng yên (draft/transcribed/translated/failed) suy từ DỮ LIỆU
  // đang có, không suy từ tên trạng thái - phiên lỗi giữa chừng vẫn chỉ đúng chỗ.
  if (m.cues.length > 0) {
    const translated = m.cues.some((c) => c.text.trim() !== "");
    return { stage: translated ? 4 : 3, active: false, complete: false };
  }
  if (m.transcriptFile) return { stage: 3, active: false, complete: false };
  return { stage: m.source.relPath ? 2 : 1, active: false, complete: false };
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
    <div className="flex shrink-0 flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">{t("tv.job")}</span>
        <span className="text-xs text-[var(--text-muted)]">{job.status}</span>
      </div>
      <ProgressBar progress={job.progress} step={job.step} />
      {error && <ErrorBanner message={t("tv.job-log-error")} detail={error} />}
      <pre
        ref={preRef}
        className="max-h-48 min-h-16 overflow-auto rounded-[var(--radius)] bg-[var(--bg-subtle)] p-2 font-mono text-[11px] whitespace-pre-wrap"
      >
        {log || t("tv.job-no-log")}
      </pre>
    </div>
  );
}

/**
 * Ô chọn màu: swatch + ô gõ giá trị. Giữ cả hai vì `<input type="color">` chỉ
 * hiểu #rrggbb - phiên nào lưu rgba()/tên màu mà chỉ có swatch là bấm nhẹ một
 * cái đã ghi đè mất giá trị cũ.
 */
function ColorField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={hex}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-45"
        />
        <input
          className="input"
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

export default function TranslateVideoDetailPage() {
  const { t, tf } = useT();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  // SSE đứt rồi nối lại → refetch dữ liệu seed để status không kẹt "đang chạy"
  const { resyncTick } = useEvents();

  const [session, setSession] = useState<TranslateVideoMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Bước đang chạy đồng bộ (chờ response) - khóa nút để không bấm hai lần. */
  const [busy, setBusy] = useState<"transcribe" | "translate" | "render" | null>(
    null
  );

  // Bản nháp phía client: gõ là thấy ngay, PATCH đi sau (debounce). Chỉ đồng bộ
  // lại từ server khi KHÔNG còn thay đổi chờ gửi - để không nuốt chữ vừa gõ.
  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("vi");
  const [mode, setMode] = useState<TranslateMode>("subtitle");
  const [cues, setCues] = useState<TranslatedCue[]>([]);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle | null>(null);

  const pending = useRef<Patch>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Upload video nguồn
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Job mới nhất của phiên - nguồn hiển thị % và tên bước.
  // `jobPhase` cho biết log này thuộc khối nào: bóc lời hay đóng phụ đề. Hai
  // bước dùng CHUNG type job "translate-video" nên không suy ra được từ job.
  const [job, setJob] = useState<Job | null>(null);
  const [jobPhase, setJobPhase] = useState<"transcribe" | "render" | null>(null);
  const currentJobId = useRef<string | null>(null);

  // Gấp/mở từng khối. Mặc định suy từ "phiên đã xong chưa" NGAY TRONG LÚC RENDER,
  // cố tình KHÔNG có useEffect nào đồng bộ trạng thái gấp theo status: trang này
  // bám SSE job, mỗi dòng log hay mỗi lần job đổi tiến trình là một lần render
  // mới. Effect kiểu đó sẽ đóng sập đúng cái khối người dùng vừa mở ra, mà lỗi
  // ấy trông như trang tự nhiên "nhảy" chứ không ai đoán ra là do SSE.
  //
  // Gọi trước mọi lối thoát sớm (loading/lỗi) - thứ tự hook phải giống nhau ở
  // mọi lần render.
  const group = useCollapseGroup({
    keys: TV_BLOCKS,
    finished: session?.status === "done",
    keepExpanded: TV_KEEP_EXPANDED,
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /** Đổ dữ liệu server vào các bản nháp chưa bị sửa dở. */
  const adopt = useCallback((s: TranslateVideoMeta) => {
    setSession(s);
    const p = pending.current;
    if (!p.sourceLang) setSourceLang(s.sourceLang || "auto");
    if (!p.targetLang) setTargetLang(s.targetLang || "vi");
    if (!p.mode) setMode(s.mode ?? "subtitle");
    if (!p.cues) setCues(s.cues ?? []);
    // Phiên tạo trước khi backend có đủ field → lấp bằng mặc định
    if (!p.subtitleStyle) {
      setSubtitleStyle({
        ...TRANSLATE_DEFAULT_SUBTITLE_STYLE,
        ...(s.subtitleStyle ?? {}),
      });
    }
  }, []);

  const load = useCallback(async () => {
    try {
      adopt(await getTranslateVideo(sessionId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId, adopt]);

  useEffect(() => {
    load();
  }, [load, resyncTick]);

  // Seed job đang chạy (mở trang giữa chừng vẫn thấy tiến trình).
  // resyncTick: refetch sau khi SSE nối lại để bắt kịp job đã đổi trạng thái.
  useEffect(() => {
    let alive = true;
    getJobs(50)
      .then((list) => {
        const mine = list.filter((j) => isTranslateVideoJob(j, sessionId));
        if (!alive || mine.length === 0) return;
        // Job seed KHÔNG đặt jobPhase: bước nào tạo ra nó thì lúc đó mới biết
        // chắc. Mở trang giữa chừng thì `phase` phía dưới suy từ trạng thái phiên.
        setJob(mine[0]);
        currentJobId.current = mine[0].id;
      })
      .catch(() => {
        // không lấy được jobs cũng không chặn trang - SSE vẫn cập nhật tiếp
      });
    return () => {
      alive = false;
    };
  }, [sessionId, resyncTick]);

  useJobEvents((j) => {
    // Hợp đồng /transcribe và /render chỉ trả jobId nên nhận cả theo id vừa tạo
    if (!isTranslateVideoJob(j, sessionId) && j.id !== currentJobId.current) return;
    setJob(j);
    if (["done", "failed", "canceled"].includes(j.status)) load();
  });

  // ---- Lưu thay đổi: gộp lại rồi PATCH một lần ----

  const flush = useCallback(async () => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    if (Object.keys(pending.current).length === 0) return;
    const patch = pending.current;
    pending.current = {};
    try {
      const s = await updateTranslateVideo(sessionId, patch);
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
      if (Object.keys(pending.current).length > 0) {
        const patch = pending.current;
        pending.current = {};
        updateTranslateVideo(sessionId, patch).catch(() => {
          // trang đã đóng - không còn chỗ hiện lỗi
        });
      }
    };
  }, [sessionId]);

  const queue = useCallback(
    (patch: Patch, immediate = false) => {
      pending.current = { ...pending.current, ...patch };
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (immediate) {
        flush();
      } else {
        flushTimer.current = setTimeout(flush, PATCH_DEBOUNCE_MS);
      }
    },
    [flush]
  );

  // Các hàm patch dùng THẲNG giá trị của lần render này chứ không dùng updater
  // dạng hàm: updater có thể bị React gọi lại (StrictMode) và queue() là side
  // effect - gọi hai lần sẽ đặt hai lịch gửi cho cùng một thay đổi.
  function patchSourceLang(v: string) {
    setSourceLang(v);
    queue({ sourceLang: v }, true);
  }

  function patchTargetLang(v: string) {
    setTargetLang(v);
    queue({ targetLang: v }, true);
  }

  function patchMode(v: TranslateMode) {
    setMode(v);
    queue({ mode: v }, true);
  }

  function patchStyle(p: Partial<SubtitleStyle>, immediate = false) {
    if (!subtitleStyle) return;
    const next = { ...subtitleStyle, ...p };
    setSubtitleStyle(next);
    queue({ subtitleStyle: next }, immediate);
  }

  /** Sửa lời dịch một câu - gõ thì debounce, không bắn request mỗi ký tự. */
  function patchCueText(index: number, text: string) {
    const next = cues.map((c, i) => (i === index ? { ...c, text } : c));
    setCues(next);
    queue({ cues: next });
  }

  // ---- Chạy bước ----

  async function upload(files: FileList | null) {
    if (!files || files.length === 0 || uploading) return;
    setUploading(true);
    setUploadError(null);
    try {
      adopt(await uploadTranslateVideoSource(sessionId, files[0]));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function run(step: "transcribe" | "translate" | "render") {
    if (busy) return;
    setBusy(step);
    setActionError(null);
    try {
      // Gửi nốt sửa đổi đang chờ trước - server phải làm việc trên bản mới nhất
      await flush();
      if (step === "translate") {
        adopt(await translateTranslateVideo(sessionId));
      } else {
        const { jobId } =
          step === "transcribe"
            ? await transcribeTranslateVideo(sessionId)
            : await renderTranslateVideo(sessionId);
        currentJobId.current = jobId;
        setJobPhase(step === "transcribe" ? "transcribe" : "render");
        await load();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      // Lỗi có thể do server đã đổi trạng thái phiên - đọc lại cho khớp
      load();
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteTranslateVideo(sessionId);
      router.push("/translate-video");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  function langLabel(code: string): string {
    const key = `tv.lang.${code}`;
    const label = t(key);
    // Mã lạ (server đổi danh sách trước web) → hiện luôn mã, đừng hiện key thô
    return label === key ? code : label;
  }

  if (!session || !subtitleStyle) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("nav.translate-video")} />
        {loadError ? (
          <ErrorBanner message={t("tv.not-found")} detail={loadError} />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        )}
      </div>
    );
  }

  const running = RUNNING_STATUS.includes(session.status);
  // Ô nhập chỉ khóa khi có việc đang chạy - xong rồi vẫn sửa & chạy lại được
  const locked = running;
  const stage = deriveTvStage(session);
  const src = session.source;
  const hasSource = src.relPath !== null;
  const translatedCount = cues.filter((c) => c.text.trim() !== "").length;
  const canTranscribe = hasSource && !running;
  const canTranslate = cues.length > 0 && !running;
  const canRender = translatedCount > 0 && !running;
  const statusLabel = TRANSLATE_VIDEO_STATUS_LABEL[session.status]
    ? t(TRANSLATE_VIDEO_STATUS_LABEL[session.status])
    : String(session.status);
  const sourceUrl = src.relPath
    ? `${mediaUrl(src.relPath)}?v=${encodeURIComponent(session.updatedAt)}`
    : null;
  const outputUrl = session.outputFile
    ? `${mediaUrl(session.outputFile)}?v=${encodeURIComponent(session.updatedAt)}`
    : null;

  // Log của bước nào thì hiện ở khối ấy. Chưa biết (mở trang giữa chừng) thì suy
  // từ trạng thái phiên - đó là thông tin đáng tin nhất đang có.
  const phase =
    jobPhase ??
    (session.status === "rendering" || session.status === "done"
      ? "render"
      : "transcribe");

  // ---- Khối video thành phẩm ----

  const done = session.status === "done";

  /** Job của bước ĐÓNG PHỤ ĐỀ - nguồn % và tên bước cho khối video thành phẩm. */
  const renderJob = job && phase === "render" ? job : null;

  // Hỏng ở bước bóc lời thoại KHÔNG phải là "dựng video thất bại": khối kết quả
  // giữ nguyên trạng thái "chưa có video", còn lỗi đã có banner riêng phía trên.
  const renderFailed = session.status === "failed" && phase === "render";

  const outputStatus: WorkspaceStatus =
    session.status === "rendering"
      ? "running"
      : renderFailed
        ? "failed"
        : session.outputFile
          ? "done"
          : "idle";

  // Tỉ lệ khung hình lấy từ chính video nguồn (phụ đề đóng lên video gốc nên hai
  // bên luôn cùng khung hình); chưa có nguồn thì tạm dùng ngang 16/9.
  const aspect =
    src.width && src.height ? `${src.width} / ${src.height}` : "16 / 9";

  // ---- Một dòng tóm tắt cho từng khối lúc gấp ----

  const sourceSummary = hasSource
    ? [
        src.relPath?.split(/[\\/]/).pop(),
        src.width && src.height ? `${src.width}x${src.height}` : null,
        src.durationSec ? clock(src.durationSec) : null,
        src.fps ? `${src.fps}fps` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : t("tv.no-source-yet");
  const transcriptSummary =
    cues.length > 0
      ? tf("tv.cue-count", { n: cues.length })
      : t("tv.no-transcript");
  const translationSummary =
    translatedCount > 0
      ? `${langLabel(sourceLang)} → ${langLabel(targetLang)} · ${tf(
          "tv.translated-count",
          { n: translatedCount }
        )}`
      : `${langLabel(sourceLang)} → ${langLabel(targetLang)} · ${t(
          "tv.no-translation"
        )}`;
  const subtitleSummary = `${t(`tv.font.${subtitleStyle.fontFamily}`)} · ${
    subtitleStyle.fontSizePx
  }px · ${t(`tv.backdrop.${subtitleStyle.backdrop}`)}`;
  const resultSummary = session.outputFile ?? statusLabel;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={session.name}
        subtitle={
          src.width && src.height
            ? `${src.width}x${src.height}${src.fps ? ` · ${src.fps}fps` : ""}`
            : undefined
        }
        center={
          <div className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1">
              <StepperBar
                steps={STAGE_LABELS}
                stage={stage.stage}
                active={stage.active}
                done={stage.complete}
                ariaLabel={tf("tv.stage-aria", {
                  stage: stage.stage,
                  label: t(STAGE_LABELS[stage.stage - 1]),
                })}
              />
            </div>
            <InfoHint titleKey="help.tv.title" bodyKey="help.tv.body" className="mt-px" />
          </div>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => router.push("/translate-video")}>
              <ArrowLeft size={15} strokeWidth={2} />
              {t("tv.back")}
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

      {/* Tóm tắt phiên - nhìn một dòng biết phiên này đang ra sao */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          <Badge
            tone={TRANSLATE_VIDEO_STATUS_TONE[session.status] ?? "muted"}
            label={statusLabel}
          />
          <span className="chip">
            {langLabel(sourceLang)} → {langLabel(targetLang)}
          </span>
          <span className="chip">
            {TRANSLATE_MODE_LABEL[mode] ? t(TRANSLATE_MODE_LABEL[mode]) : mode}
          </span>
          {src.durationSec ? (
            <span className="chip">{clock(src.durationSec)}</span>
          ) : null}
          {cues.length > 0 && (
            <span className="chip">{tf("tv.cue-count", { n: cues.length })}</span>
          )}
          {done && group.anyCollapsed && (
            <span className="min-w-0">{t("tv.section.done-collapsed")}</span>
          )}
          <span className="ml-auto">
            {t("common.updated")}: {formatDateTime(session.updatedAt)}
          </span>
        </div>
      </Card>

      {loadError && <ErrorBanner message={t("tv.load-error")} detail={loadError} />}
      {actionError && <ErrorBanner message={t("tv.action-error")} detail={actionError} />}
      {saveError && <ErrorBanner message={t("tv.save-error")} detail={saveError} />}
      {session.status === "failed" && (
        <ErrorBanner message={t("tv.failed")} detail={session.error ?? undefined} />
      )}

      {/* Ba cột theo nhịp làm việc: nguồn → yêu cầu & thiết lập → tiến trình &
          kết quả. Số cột do container query trong globals.css lo, trang không tự
          tính pixel. */}
      <Workspace>
        {/* ================= Cột 1: nguồn ================= */}
        <WorkspaceColumn role="source" title={t("workspace.col.source")}>
          <WorkspaceBlock
            id="tv-block-source"
            icon={FileVideo}
            collapsed={group.isCollapsed("source")}
            onToggle={() => group.toggle("source")}
            summary={sourceSummary}
            title={
              <span className="inline-flex items-center gap-1.5">
                {t("tv.card-source")}
                <InfoHint
                  titleKey="help.tv-source.title"
                  bodyKey="help.tv-source.body"
                  size={14}
                />
              </span>
            }
            actions={
              <Button
                variant="secondary"
                small
                disabled={locked || uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Upload size={14} strokeWidth={2} />
                )}
                {hasSource ? t("tv.replace-video") : t("tv.upload-video")}
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  upload(e.target.files);
                  e.target.value = "";
                }}
              />

              {uploadError && (
                <ErrorBanner message={t("tv.upload-error")} detail={uploadError} />
              )}

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!locked && !uploading) setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (!locked && !uploading) upload(e.dataTransfer.files);
                }}
                className={`rounded-[var(--radius)] border border-dashed p-4 text-center transition-colors duration-150 ${
                  dragOver
                    ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                    : "border-[var(--border)] bg-[var(--bg-subtle)]"
                }`}
              >
                {uploading ? (
                  <p className="flex items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
                    <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                    {t("tv.uploading")}
                  </p>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">{t("tv.drop-hint")}</p>
                )}
              </div>

              {sourceUrl ? (
                <>
                  <video
                    controls
                    src={sourceUrl}
                    className="max-h-[360px] w-full rounded-[var(--radius)] bg-[var(--bg-subtle)]"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {src.width && src.height && (
                      <span className="chip">
                        {src.width}x{src.height}
                      </span>
                    )}
                    {src.durationSec !== null && (
                      <span className="chip">{clock(src.durationSec)}</span>
                    )}
                    {src.fps !== null && <span className="chip">{src.fps} fps</span>}
                    <span className="min-w-0 truncate text-xs text-[var(--text-muted)]">
                      {src.relPath}
                    </span>
                  </div>
                </>
              ) : (
                <EmptyState icon={FileVideo} description={t("tv.no-source-yet")} />
              )}

              <div>
                <label className="label" htmlFor="tv-source-lang">
                  {t("tv.source-lang")}
                  <InfoHint
                    className="ml-1.5 align-middle"
                    titleKey="help.tv-lang.title"
                    bodyKey="help.tv-lang.body"
                  />
                </label>
                <select
                  id="tv-source-lang"
                  className="input"
                  value={sourceLang}
                  disabled={locked}
                  onChange={(e) => patchSourceLang(e.target.value)}
                >
                  {!TRANSLATE_SOURCE_LANGS.includes(
                    sourceLang as (typeof TRANSLATE_SOURCE_LANGS)[number]
                  ) && <option value={sourceLang}>{sourceLang}</option>}
                  {TRANSLATE_SOURCE_LANGS.map((code) => (
                    <option key={code} value={code}>
                      {langLabel(code)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </WorkspaceBlock>
        </WorkspaceColumn>

        {/* ============ Cột 2: yêu cầu & thiết lập ============ */}
        <WorkspaceColumn role="setup" title={t("workspace.col.setup")}>
          {/* Ngôn ngữ đích + chế độ + sửa tay từng câu thoại - đây mới là chỗ
              người dùng nói "tôi muốn ra cái gì" */}
          <WorkspaceBlock
            id="tv-block-translation"
            icon={Languages}
            collapsed={group.isCollapsed("translation")}
            onToggle={() => group.toggle("translation")}
            summary={translationSummary}
            title={
              <span className="inline-flex items-center gap-1.5">
                {t("tv.card-translation")}
                <InfoHint
                  titleKey="help.tv-translation.title"
                  bodyKey="help.tv-translation.body"
                  size={14}
                />
              </span>
            }
            actions={
              <Button
                small
                disabled={!canTranslate || busy !== null}
                onClick={() => run("translate")}
              >
                {busy === "translate" ? (
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Wand2 size={14} strokeWidth={2} />
                )}
                {translatedCount > 0 ? t("tv.re-translate") : t("tv.translate")}
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="tv-target-lang">
                    {t("tv.target-lang")}
                  </label>
                  <select
                    id="tv-target-lang"
                    className="input"
                    value={targetLang}
                    disabled={locked}
                    onChange={(e) => patchTargetLang(e.target.value)}
                  >
                    {!TRANSLATE_TARGET_LANGS.includes(
                      targetLang as (typeof TRANSLATE_TARGET_LANGS)[number]
                    ) && <option value={targetLang}>{targetLang}</option>}
                    {TRANSLATE_TARGET_LANGS.map((code) => (
                      <option key={code} value={code}>
                        {langLabel(code)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="label">
                    {t("tv.mode")}
                    <InfoHint
                      className="ml-1.5 align-middle"
                      titleKey="help.tv-mode.title"
                      bodyKey="help.tv-mode.body"
                    />
                  </span>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("tv.mode")}>
                    {(
                      [
                        ["subtitle", Subtitles, false],
                        ["dub", Film, true],
                      ] as const
                    ).map(([m, Icon, soon]) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={mode === m}
                        // Lồng tiếng là giai đoạn 2, backend chưa có - cho bấm là
                        // người dùng chọn xong rồi ngồi chờ một thứ không chạy.
                        disabled={locked || soon}
                        title={soon ? t("tv.mode.soon") : undefined}
                        onClick={() => patchMode(m as TranslateMode)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors duration-150 ${
                          mode === m
                            ? "border-[var(--primary)] bg-[var(--primary-soft)] font-medium text-[var(--primary)]"
                            : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
                        } disabled:cursor-not-allowed disabled:opacity-45`}
                      >
                        <Icon size={13} strokeWidth={2} />
                        {t(TRANSLATE_MODE_LABEL[m as TranslateMode])}
                        {soon && (
                          <span className="text-[10px] opacity-80">
                            ({t("tv.mode.soon-short")})
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {session.status === "translating" ? (
                <p className="flex items-center gap-2 py-4 text-xs text-[var(--text-muted)]">
                  <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                  {t("tv.translating-hint")}
                </p>
              ) : cues.length === 0 ? (
                <EmptyState icon={Languages} description={t("tv.no-transcript")} />
              ) : (
                <>
                  <ul className="flex flex-col gap-1.5">
                    {cues.map((c, i) => (
                      <li
                        key={i}
                        className="flex flex-col gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-2"
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]">
                          <span className="font-mono">
                            {clock(c.start)} - {clock(c.end)}
                          </span>
                          {c.speaker && <span className="chip">{c.speaker}</span>}
                        </div>
                        {c.original && (
                          <p className="text-xs text-[var(--text-muted)] italic">
                            {c.original}
                          </p>
                        )}
                        <textarea
                          className="input text-[13px]"
                          rows={2}
                          value={c.text}
                          disabled={locked}
                          aria-label={tf("tv.cue-aria", { n: i + 1 })}
                          onChange={(e) => patchCueText(i, e.target.value)}
                          onBlur={() => flush()}
                        />
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-[var(--text-muted)]">
                    {tf("tv.translated-count", { n: translatedCount })} /{" "}
                    {tf("tv.cue-count", { n: cues.length })} · {t("tv.cue-hint")}
                  </p>
                </>
              )}
            </div>
          </WorkspaceBlock>

          {/* Kiểu phụ đề + ô xem trước - vẫn là "muốn ra cái gì", nên ở cột 2 */}
          <WorkspaceBlock
            id="tv-block-subtitle"
            icon={Type}
            collapsed={group.isCollapsed("subtitle")}
            onToggle={() => group.toggle("subtitle")}
            summary={subtitleSummary}
            title={
              <span className="inline-flex items-center gap-1.5">
                {t("tv.card-subtitle")}
                <InfoHint
                  titleKey="help.tv-subtitle.title"
                  bodyKey="help.tv-subtitle.body"
                  size={14}
                />
              </span>
            }
          >
            <div className="flex flex-col gap-4">
              {/* Xem trước NGAY: đổi cỡ chữ hay màu nền mà phải render mới biết
                  đẹp xấu thì mỗi lần thử mất hàng chục phút. */}
              <div>
                <span className="label">{t("tv.preview")}</span>
                <div className="relative flex h-40 items-end justify-center overflow-hidden rounded-[var(--radius)] bg-[#1c1c20]">
                  {/* Khung giả lập video: nền tối cố định (không phải token) vì
                      đây là MÔ PHỎNG khung hình, không phải giao diện dashboard -
                      đổi theo theme sáng/tối là xem trước sai. */}
                  <div
                    className="max-w-[86%] rounded-[6px] px-3 py-1.5 text-center leading-snug"
                    style={{
                      marginBottom: `${Math.min(
                        // bottomPx tính trên khung hình thật (vd 1080px cao), ô
                        // xem trước chỉ cao 160px → thu tỉ lệ cho khỏi đẩy chữ ra ngoài
                        Math.round(subtitleStyle.bottomPx / 8),
                        96
                      )}px`,
                      fontFamily:
                        FONT_STACK[subtitleStyle.fontFamily as SubtitleFontId] ??
                        FONT_STACK.sans,
                      fontSize: `${Math.max(
                        11,
                        Math.round(subtitleStyle.fontSizePx / 3)
                      )}px`,
                      color: subtitleStyle.color,
                      background:
                        subtitleStyle.backdrop === "none"
                          ? "transparent"
                          : subtitleStyle.backdropColor,
                      backdropFilter:
                        subtitleStyle.backdrop === "blur"
                          ? `blur(${subtitleStyle.blurPx}px)`
                          : undefined,
                      opacity: subtitleStyle.backdrop === "blur" ? 0.92 : 1,
                    }}
                  >
                    {t("tv.preview-text")}
                  </div>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {t("tv.preview-hint")}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="tv-font">
                    {t("tv.font")}
                    <InfoHint
                      className="ml-1.5 align-middle"
                      titleKey="help.tv-font.title"
                      bodyKey="help.tv-font.body"
                    />
                  </label>
                  <select
                    id="tv-font"
                    className="input"
                    value={subtitleStyle.fontFamily}
                    disabled={locked}
                    onChange={(e) => patchStyle({ fontFamily: e.target.value }, true)}
                  >
                    {/* Font ngoài allowlist (server cũ/mới lệch nhau) vẫn hiện để
                        không âm thầm đổi lựa chọn đã lưu của người dùng */}
                    {!SUBTITLE_FONTS.includes(
                      subtitleStyle.fontFamily as SubtitleFontId
                    ) && (
                      <option value={subtitleStyle.fontFamily}>
                        {subtitleStyle.fontFamily}
                      </option>
                    )}
                    {SUBTITLE_FONTS.map((f) => (
                      <option key={f} value={f}>
                        {t(`tv.font.${f}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label" htmlFor="tv-font-size">
                    {t("tv.font-size")}
                  </label>
                  <input
                    id="tv-font-size"
                    className="input"
                    type="number"
                    min={SUBTITLE_FONT_SIZE_MIN}
                    max={SUBTITLE_FONT_SIZE_MAX}
                    value={subtitleStyle.fontSizePx}
                    disabled={locked}
                    onChange={(e) =>
                      patchStyle({ fontSizePx: Number(e.target.value) }, true)
                    }
                  />
                </div>

                <ColorField
                  id="tv-color"
                  label={t("tv.color")}
                  value={subtitleStyle.color}
                  disabled={locked}
                  onChange={(v) => patchStyle({ color: v }, true)}
                />

                <div>
                  <label className="label" htmlFor="tv-bottom">
                    {t("tv.bottom")}
                  </label>
                  <input
                    id="tv-bottom"
                    className="input"
                    type="number"
                    min={0}
                    max={SUBTITLE_BOTTOM_MAX}
                    value={subtitleStyle.bottomPx}
                    disabled={locked}
                    onChange={(e) =>
                      patchStyle({ bottomPx: Number(e.target.value) }, true)
                    }
                  />
                </div>
              </div>

              <div>
                <span className="label">{t("tv.backdrop")}</span>
                <div
                  className="flex flex-wrap gap-1.5"
                  role="radiogroup"
                  aria-label={t("tv.backdrop")}
                >
                  {(["blur", "solid", "none"] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      role="radio"
                      aria-checked={subtitleStyle.backdrop === b}
                      disabled={locked}
                      onClick={() => patchStyle({ backdrop: b as SubtitleBackdrop }, true)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors duration-150 ${
                        subtitleStyle.backdrop === b
                          ? "border-[var(--primary)] bg-[var(--primary-soft)] font-medium text-[var(--primary)]"
                          : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                    >
                      {t(`tv.backdrop.${b}`)}
                    </button>
                  ))}
                </div>
              </div>

              {subtitleStyle.backdrop !== "none" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ColorField
                    id="tv-backdrop-color"
                    label={t("tv.backdrop-color")}
                    value={subtitleStyle.backdropColor}
                    disabled={locked}
                    onChange={(v) => patchStyle({ backdropColor: v }, true)}
                  />
                  {subtitleStyle.backdrop === "blur" && (
                    <div>
                      <label className="label" htmlFor="tv-blur">
                        {t("tv.blur")}
                      </label>
                      <input
                        id="tv-blur"
                        className="input"
                        type="number"
                        min={0}
                        max={SUBTITLE_BLUR_MAX}
                        value={subtitleStyle.blurPx}
                        disabled={locked}
                        onChange={(e) =>
                          patchStyle({ blurPx: Number(e.target.value) }, true)
                        }
                      />
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-[var(--text-muted)]">
                {locked ? t("tv.style-locked") : t("tv.style-autosave")}
              </p>
            </div>
          </WorkspaceBlock>
        </WorkspaceColumn>

        {/* ============ Cột 3: tiến trình & kết quả ============ */}
        <WorkspaceColumn role="output" title={t("workspace.col.output")}>
          {/* Khối ĐẦU TIÊN của cột: đang đóng phụ đề thì nhấp nháy chờ, xong thì
              hiện thẳng video. Liếc một chỗ là biết phiên đang ở đâu. */}
          <OutputBlock
            id="tv-block-result"
            status={outputStatus}
            videoUrl={outputUrl}
            progress={renderJob ? renderJob.progress : null}
            step={renderJob?.step}
            aspect={aspect}
            error={renderFailed ? shortError(session.error) : null}
            collapsed={group.isCollapsed("result")}
            onToggle={() => group.toggle("result")}
            summary={resultSummary}
            title={
              <span className="inline-flex items-center gap-1.5">
                {t("tv.card-result")}
                <InfoHint
                  titleKey="help.tv-result.title"
                  bodyKey="help.tv-result.body"
                  size={14}
                />
              </span>
            }
            actions={
              <Button
                disabled={!canRender || busy !== null}
                onClick={() => run("render")}
              >
                {busy === "render" ? (
                  <Loader2 size={15} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Film size={15} strokeWidth={2} />
                )}
                {session.outputFile ? t("tv.re-render") : t("tv.render")}
              </Button>
            }
          >
            {session.status === "rendering" && (
              <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                {t("tv.rendering-hint")}
              </p>
            )}

            {/* Log của bước đóng phụ đề - thứ SINH RA trong lúc chạy, đúng chỗ */}
            {renderJob && <JobLogBlock job={renderJob} />}

            {outputUrl ? (
              <span className="min-w-0 truncate text-xs text-[var(--text-muted)]">
                {session.outputFile}
              </span>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">
                {canRender
                  ? t("tv.render-hint")
                  : cues.length === 0
                    ? t("tv.render-need-transcript")
                    : t("tv.render-need-translation")}
              </p>
            )}
          </OutputBlock>

          {/* Lời thoại bóc ra được - sản phẩm của bước 2, không phải ô nhập */}
          <WorkspaceBlock
            id="tv-block-transcript"
            icon={Subtitles}
            collapsed={group.isCollapsed("transcript")}
            onToggle={() => group.toggle("transcript")}
            summary={transcriptSummary}
            title={
              <span className="inline-flex items-center gap-1.5">
                {t("tv.card-transcript")}
                <InfoHint
                  titleKey="help.tv-transcript.title"
                  bodyKey="help.tv-transcript.body"
                  size={14}
                />
              </span>
            }
            actions={
              <Button
                small
                disabled={!canTranscribe || busy !== null}
                onClick={() => run("transcribe")}
              >
                {busy === "transcribe" ? (
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Subtitles size={14} strokeWidth={2} />
                )}
                {cues.length > 0 ? t("tv.re-transcribe") : t("tv.transcribe")}
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              {session.status === "transcribing" && (
                <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                  {t("tv.transcribing-hint")}
                </p>
              )}

              {job && phase === "transcribe" ? (
                <JobLogBlock job={job} />
              ) : cues.length === 0 ? (
                <EmptyState
                  icon={Subtitles}
                  description={hasSource ? t("tv.no-transcript") : t("tv.no-source-yet")}
                />
              ) : null}

              {session.transcriptFile && (
                <span className="chip w-fit">
                  {t("tv.transcript-file")}: {session.transcriptFile}
                </span>
              )}
            </div>
          </WorkspaceBlock>

          {/* Dịch tới đâu rồi - đếm trên chính danh sách câu đang sửa ở cột 2 */}
          <WorkspaceBlock
            id="tv-block-progress"
            icon={Wand2}
            collapsed={group.isCollapsed("progress")}
            onToggle={() => group.toggle("progress")}
            summary={translationSummary}
            title={t("tv.card-translation-status")}
          >
            <div className="flex flex-col gap-2">
              {session.status === "translating" ? (
                <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                  {t("tv.translating-hint")}
                </p>
              ) : cues.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">
                  {t("tv.no-transcript")}
                </p>
              ) : (
                <>
                  <ProgressBar
                    progress={(translatedCount / cues.length) * 100}
                  />
                  <p className="text-xs text-[var(--text-muted)]">
                    {langLabel(sourceLang)} → {langLabel(targetLang)} ·{" "}
                    {tf("tv.translated-count", { n: translatedCount })} /{" "}
                    {tf("tv.cue-count", { n: cues.length })}
                  </p>
                </>
              )}
            </div>
          </WorkspaceBlock>
        </WorkspaceColumn>
      </Workspace>

      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("tv.delete-title")}
        description={<p>{t("tv.delete-desc")}</p>}
        items={[session.name]}
        busy={deleting}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDelete}
      />
    </div>
  );
}
