"use client";

/**
 * Chi tiết một phiên "Text to video" - dựng theo đúng bố cục của Videos Project:
 * lưới nhiều cột + panel AI ghim phải, thay vì một cột dài phải cuộn mãi.
 *
 * Chia cột theo NHỊP LÀM VIỆC chứ không theo số thứ tự bước:
 * - Cột trái "nội dung dài": Nguồn → Kịch bản đọc. Hai thứ này là văn bản, người
 *   dùng đọc và sửa tay rất nhiều, và kịch bản sinh ra TỪ nguồn nên đặt liền
 *   nhau để so đối chiếu mà không phải cuộn qua lại.
 * - Cột phải "thiết lập ngắn": Giọng đọc → Cấu hình video → Dựng video. Toàn nút
 *   bấm và ô chọn, cao vừa phải; nút Dựng nằm cuối vì nó tiêu thụ mọi thiết lập
 *   ở trên.
 * Hẹp hơn xl thì lưới xẹp về một cột theo đúng thứ tự 1→5 như cũ.
 *
 * Thanh bước dùng chung StepperBar với Videos Project - không tự vẽ thanh thứ hai.
 */

import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Type,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildTextToVideo,
  deleteTextToVideo,
  estimateChunkSeconds,
  estimateScriptSeconds,
  extractTextToVideo,
  getChatSessions,
  getJob,
  getJobs,
  getTextToVideoSession,
  isTextToVideoJob,
  scriptChars,
  scriptTextToVideo,
  updateTextToVideo,
  TEXT_TO_VIDEO_DEFAULT_OUTPUT,
  TEXT_TO_VIDEO_FPS,
  TEXT_TO_VIDEO_SIZES,
  TEXT_TO_VIDEO_STATUS_LABEL,
  TEXT_TO_VIDEO_STATUS_TONE,
  type Brief,
  type ChatSession,
  type Job,
  type ScriptChunk,
  type TextSourceKind,
  type TextToVideoAspect,
  type TextToVideoMeta,
  type TextToVideoOutput,
  type TextToVideoSource,
  type TextToVideoVoice,
} from "@/lib/api";
import { useAgentEvents, useJobEvents, useJobLogEvents } from "@/lib/useEvents";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ChatThread } from "@/components/ChatThread";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { useClaudeModels, useProviders } from "@/components/ModelPicker";
import { PageHeader } from "@/components/PageHeader";
import { StepperBar } from "@/components/PipelineTimeline";
import { ProgressBar } from "@/components/ProgressBar";
import { SessionStatusBadge } from "@/components/SessionStatusBadge";
import { StyleSelect } from "@/components/StyleSelect";
import { VoicePicker } from "@/components/VoicePicker";
import { BriefFields, DEFAULT_BRIEF } from "@/components/BriefFields";
// clock() (giây → mm:ss) đã có sẵn ở đây, lib/format.ts chưa có helper tương đương
import { clock } from "@/components/AutoCutCommon";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

/** Gộp nhiều lần gõ phím thành một PATCH - không bắn request mỗi ký tự. */
const PATCH_DEBOUNCE_MS = 700;

const ASPECTS: TextToVideoAspect[] = ["9:16", "16:9", "1:1", "4:5"];

/** Trạng thái nào là "đang có việc chạy" - lúc đó mọi ô nhập bị khóa. */
const RUNNING_STATUS = ["extracting", "scripting", "voicing", "building"];

/** Thay đổi đang chờ gửi - luôn gửi trọn từng khối con để server khỏi phải merge. */
interface Patch {
  name?: string;
  source?: TextToVideoSource;
  voice?: TextToVideoVoice;
  output?: TextToVideoOutput;
  brief?: Partial<Brief>;
  script?: ScriptChunk[];
  scriptModel?: string | null;
}

// Giá trị là KEY dictionary - StepperBar tự dịch bằng t() lúc render.
const STAGE_LABELS = [
  "ttv.stage.source",
  "ttv.stage.script",
  "ttv.stage.voice",
  "ttv.stage.config",
  "ttv.stage.build",
] as const;

/**
 * Bước hiện tại suy từ dữ liệu phiên - backend vẫn là nguồn sự thật, chỗ này
 * chỉ đọc. `active` = đang có việc chạy (chấm nhấp nháy), `complete` = xong hết.
 */
function deriveTtvStage(m: TextToVideoMeta): {
  stage: number;
  active: boolean;
  complete: boolean;
} {
  if (m.status === "extracting") return { stage: 1, active: true, complete: false };
  if (m.status === "scripting") return { stage: 2, active: true, complete: false };
  if (m.status === "voicing" || m.status === "building") {
    return { stage: 5, active: true, complete: false };
  }
  if (m.projectId) {
    return { stage: 5, active: false, complete: m.status === "done" };
  }
  if (m.script.length > 0) {
    return { stage: m.voice.name ? 4 : 3, active: false, complete: false };
  }
  const hasSource =
    m.article !== null || m.source.text.trim() !== "" || m.source.url.trim() !== "";
  return { stage: hasSource ? 2 : 1, active: false, complete: false };
}

/**
 * Chọn model Claude viết kịch bản. Danh sách model lấy từ ModelPicker (chung
 * cache /api/providers + /api/claude/models với modal "Bắt đầu edit") - không
 * dựng nguồn dữ liệu thứ hai để hai nơi lệch nhau.
 *
 * Không dùng thẳng AiModelBlock/AiModelInlineRow vì hai khối đó kèm ô "chế độ"
 * (effort), mà endpoint /script chỉ nhận `model` - bày một ô bấm vào không có
 * tác dụng gì còn tệ hơn là không bày.
 */
function ScriptModelSelect({
  value,
  disabled,
  onChange,
}: {
  /** "" = mặc định của Claude Code. */
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const { t } = useT();
  const { providers } = useProviders();
  const claude = providers?.find((p) => p.id === "claude");
  const { models: liveModels, load } = useClaudeModels();
  // Chưa fetch live → tạm dùng danh sách tĩnh từ /api/providers
  const models = liveModels ?? claude?.models ?? [];
  // Model đã lưu không (chưa) nằm trong danh sách → vẫn hiện bằng id thô
  const missing = value !== "" && !models.some((m) => m.id === value);

  return (
    <div>
      <label className="label" htmlFor="ttv-script-model">
        {t("ttv.script-model")}
        <InfoHint
          className="ml-1.5 align-middle"
          titleKey="help.ttv-script-model.title"
          bodyKey="help.ttv-script-model.body"
        />
      </label>
      <select
        id="ttv-script-model"
        className="input"
        value={value}
        disabled={disabled}
        onFocus={load}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("ttv.script-model-default")}</option>
        {missing && <option value={value}>{value}</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Một dòng cho biết Claude đang xác thực bằng gì - subscription hay API key. */
function ClaudeAuthLine() {
  const { t } = useT();
  const { providers } = useProviders();
  const claude = providers?.find((p) => p.id === "claude");
  if (!claude) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--text-muted)]">
      {claude.connected ? (
        <span className="badge badge-success">
          <span className="badge-dot" />
          {claude.source === "api-key"
            ? t("model.connected-api-key")
            : t("model.connected-subscription")}
        </span>
      ) : (
        <span className="badge badge-danger">
          <span className="badge-dot" />
          {t("model.not-connected")}
        </span>
      )}
      <span className="min-w-0">
        {claude.connected ? t("ttv.script-model-hint") : t("model.claude-warning")}
      </span>
    </p>
  );
}

/**
 * Khối log của job dựng video trong panel AI - đúng nội dung trang Render Queue
 * hiển thị: tiến trình + từng dòng log chảy về qua SSE `joblog`.
 */
function JobLogBlock({ job }: { job: Job }) {
  const { t } = useT();
  const jobId = job.id;
  const [log, setLog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let alive = true;
    setLog("");
    setError(null);
    getJob(jobId)
      .then((j) => {
        if (alive) setLog(j.log ?? "");
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [jobId]);

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
        <span className="text-xs font-semibold">{t("ttv.panel-job")}</span>
        <span className="text-xs text-[var(--text-muted)]">{job.status}</span>
      </div>
      <ProgressBar progress={job.progress} step={job.step} />
      {error && <ErrorBanner message={t("ttv.panel-log-error")} detail={error} />}
      <pre
        ref={preRef}
        className="max-h-48 min-h-16 overflow-auto rounded-[var(--radius)] bg-[var(--bg-subtle)] p-2 font-mono text-[11px] whitespace-pre-wrap"
      >
        {log || t("ttv.panel-no-log")}
      </pre>
    </div>
  );
}

export default function TextToVideoDetailPage() {
  const { t, tf } = useT();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<TextToVideoMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Bước đang chạy đồng bộ (chờ response) - khóa nút để không bấm hai lần. */
  const [busy, setBusy] = useState<"extract" | "script" | "build" | null>(null);

  // Bản nháp phía client: gõ là thấy ngay, PATCH đi sau (debounce). Chỉ đồng bộ
  // lại từ server khi KHÔNG còn thay đổi chờ gửi - để không nuốt chữ vừa gõ.
  const [source, setSource] = useState<TextToVideoSource | null>(null);
  const [script, setScript] = useState<ScriptChunk[]>([]);
  const [voice, setVoice] = useState<TextToVideoVoice | null>(null);
  const [output, setOutput] = useState<TextToVideoOutput | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  /** "" = để Claude Code dùng model mặc định. */
  const [scriptModel, setScriptModel] = useState("");

  const pending = useRef<Patch>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Độ dài mong muốn của kịch bản (giây) - "" = để AI tự quyết. */
  const [targetSeconds, setTargetSeconds] = useState("");

  // Job dựng video mới nhất của phiên - nguồn hiển thị % và tên bước
  const [job, setJob] = useState<Job | null>(null);
  const buildJobId = useRef<string | null>(null);

  // Panel AI ghim phải - giống Videos Project. Dưới xl là drawer bật/tắt.
  const [panelOpen, setPanelOpen] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSession[] | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /** Đổ dữ liệu server vào các bản nháp chưa bị sửa dở. */
  const adopt = useCallback((s: TextToVideoMeta) => {
    setSession(s);
    const p = pending.current;
    if (!p.source) setSource(s.source);
    if (!p.script) setScript(s.script);
    if (!p.voice) setVoice(s.voice);
    if (!p.output) setOutput({ ...TEXT_TO_VIDEO_DEFAULT_OUTPUT, ...(s.output ?? {}) });
    // null là giá trị hợp lệ (= mặc định) nên phải hỏi "có key không", không hỏi truthy
    if (!("scriptModel" in p)) setScriptModel(s.scriptModel ?? "");
    // Phiên tạo trước khi backend có brief → thiếu field, lấp bằng default
    if (!p.brief) setBrief({ ...DEFAULT_BRIEF, ...(s.brief ?? {}) });
  }, []);

  const load = useCallback(async () => {
    try {
      adopt(await getTextToVideoSession(sessionId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId, adopt]);

  useEffect(() => {
    load();
  }, [load]);

  // Seed job đang chạy (mở trang giữa chừng vẫn thấy tiến trình)
  useEffect(() => {
    let alive = true;
    getJobs(50)
      .then((list) => {
        const mine = list.filter((j) => isTextToVideoJob(j, sessionId));
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
    // Hợp đồng /build chỉ trả jobId nên nhận cả theo id job vừa tạo
    if (!isTextToVideoJob(j, sessionId) && j.id !== buildJobId.current) return;
    setJob(j);
    if (["done", "failed", "canceled"].includes(j.status)) load();
  });

  // ---- Phiên chat AI của project được dựng ra ----
  // Tìm y như trang Videos Project: /api/chat/sessions lọc theo projectId, lấy
  // phiên mới nhất. Chưa dựng xong thì projectId còn null → chưa có gì để tìm.
  const projectId = session?.projectId ?? null;

  const loadChatSessions = useCallback(async () => {
    if (!projectId) return;
    try {
      const list = await getChatSessions(projectId);
      list.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setChatSessions(list);
      setActiveSessionId((cur) => cur ?? list[0]?.sessionId ?? null);
    } catch {
      // panel vẫn dùng được (empty state) - không chặn trang
      setChatSessions((s) => s ?? []);
    }
  }, [projectId]);

  useEffect(() => {
    loadChatSessions();
  }, [loadChatSessions]);

  // Phiên AI chạy xong/đổi trạng thái → cập nhật badge trong panel
  useAgentEvents((e) => {
    if (e.kind === "done" && projectId) loadChatSessions();
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
      const s = await updateTextToVideo(sessionId, patch);
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
        updateTextToVideo(sessionId, patch).catch(() => {
          // trang đã đóng - không còn chỗ hiện lỗi
        });
      }
    };
  }, [sessionId]);

  const queue = useCallback(
    (patch: Patch, immediate = false) => {
      pending.current = {
        ...pending.current,
        ...patch,
        ...(patch.brief
          ? { brief: { ...(pending.current.brief ?? {}), ...patch.brief } }
          : {}),
      };
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
  function patchSource(p: Partial<TextToVideoSource>, immediate = false) {
    if (!source) return;
    const next = { ...source, ...p };
    setSource(next);
    queue({ source: next }, immediate);
  }

  function patchVoice(p: Partial<TextToVideoVoice>) {
    if (!voice) return;
    const next = { ...voice, ...p };
    setVoice(next);
    queue({ voice: next });
  }

  function patchOutput(p: Partial<TextToVideoOutput>) {
    if (!output) return;
    const next = { ...output, ...p };
    setOutput(next);
    queue({ output: next }, true);
  }

  function patchBrief(p: Partial<Brief>) {
    setBrief((b) => (b ? { ...b, ...p } : b));
    queue({ brief: p });
  }

  function patchScriptModel(id: string) {
    setScriptModel(id);
    queue({ scriptModel: id === "" ? null : id }, true);
  }

  function setChunks(next: ScriptChunk[], immediate = false) {
    setScript(next);
    queue({ script: next }, immediate);
  }

  /** Sửa lời một đoạn - thời lượng thật của đoạn cũ không còn đúng nữa. */
  function setChunkText(index: number, text: string) {
    setChunks(
      script.map((c, i) => (i === index ? { text, durationSec: null } : c)),
      false
    );
  }

  // ---- Chạy bước ----

  async function run(step: "extract" | "script" | "build") {
    if (busy) return;
    setBusy(step);
    setActionError(null);
    try {
      // Gửi nốt sửa đổi đang chờ trước - server phải làm việc trên bản mới nhất
      await flush();
      if (step === "extract") {
        adopt(await extractTextToVideo(sessionId));
      } else if (step === "script") {
        const target = Number(targetSeconds);
        adopt(
          await scriptTextToVideo(sessionId, {
            ...(targetSeconds.trim() !== "" && Number.isFinite(target) && target > 0
              ? { targetSeconds: target }
              : {}),
            ...(scriptModel ? { model: scriptModel } : {}),
          })
        );
      } else {
        const { jobId } = await buildTextToVideo(sessionId);
        buildJobId.current = jobId;
        // Job vừa chạy → mở panel để người dùng nhìn thấy log ngay, khỏi phải tìm
        setPanelOpen(true);
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
      await deleteTextToVideo(sessionId);
      router.push("/text-to-video");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  if (!session || !source || !voice || !output || !brief) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("nav.text-to-video")} />
        {loadError ? (
          <ErrorBanner message={t("ttv.not-found")} detail={loadError} />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        )}
      </div>
    );
  }

  const running = RUNNING_STATUS.includes(session.status);
  const stage = deriveTtvStage(session);
  const article = session.article;
  const chars = scriptChars(script);
  const estSeconds = estimateScriptSeconds(script);
  const hasSourceText = source.text.trim() !== "" || article !== null;
  const canScript = hasSourceText && !running;
  const canBuild =
    script.length > 0 && voice.name.trim() !== "" && !running && !session.projectId;
  // Ô nhập chỉ khóa khi có việc đang chạy - xong rồi vẫn sửa & chạy lại được
  const locked = running;
  // Kích thước hiện tại khớp preset nào (null = người dùng/server đặt số khác)
  const currentAspect =
    ASPECTS.find(
      (a) =>
        TEXT_TO_VIDEO_SIZES[a].width === output.width &&
        TEXT_TO_VIDEO_SIZES[a].height === output.height
    ) ?? null;
  const activeSession =
    chatSessions?.find((s) => s.sessionId === activeSessionId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header chừa chỗ panel AI ghim phải như vùng nội dung - không thì thanh
          bước chui xuống dưới panel */}
      <div className="xl:pr-[452px]">
        <PageHeader
          title={session.name}
          subtitle={`${output.width}x${output.height} · ${output.fps}fps`}
          center={
            <div className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1">
                <StepperBar
                  steps={STAGE_LABELS}
                  stage={stage.stage}
                  active={stage.active}
                  done={stage.complete}
                  ariaLabel={tf("ttv.stage-aria", {
                    stage: stage.stage,
                    label: t(STAGE_LABELS[stage.stage - 1]),
                  })}
                />
              </div>
              <InfoHint
                titleKey="help.ttv.title"
                bodyKey="help.ttv.body"
                className="mt-px"
              />
            </div>
          }
          actions={
            <>
              <Button
                variant="secondary"
                className="xl:hidden"
                onClick={() => setPanelOpen((o) => !o)}
                aria-expanded={panelOpen}
              >
                <MessageSquare size={15} strokeWidth={2} />
                AI
              </Button>
              <Button variant="secondary" onClick={() => router.push("/text-to-video")}>
                <ArrowLeft size={15} strokeWidth={2} />
                {t("ttv.back")}
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
      </div>

      {/* Tóm tắt phiên - nhìn một dòng biết phiên này đang ra sao */}
      <div className="flex flex-col gap-4 xl:pr-[452px]">
        <Card>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <Badge
              tone={TEXT_TO_VIDEO_STATUS_TONE[session.status] ?? "muted"}
              label={
                TEXT_TO_VIDEO_STATUS_LABEL[session.status]
                  ? t(TEXT_TO_VIDEO_STATUS_LABEL[session.status])
                  : String(session.status)
              }
            />
            <span className="chip">
              {source.kind === "url" ? t("ttv.source.url") : t("ttv.source.text")}
            </span>
            {script.length > 0 && (
              <span className="chip">{tf("ttv.chunk-count", { n: script.length })}</span>
            )}
            {voice.name && <span className="chip">{voice.name}</span>}
            {session.voiceDurationSec !== null && (
              <span className="chip">
                {tf("ttv.real-duration", { time: clock(session.voiceDurationSec) })}
              </span>
            )}
            <span className="ml-auto">
              {t("common.updated")}: {formatDateTime(session.updatedAt)}
            </span>
          </div>
        </Card>

        {loadError && <ErrorBanner message={t("ttv.load-error")} detail={loadError} />}
        {actionError && (
          <ErrorBanner message={t("ttv.action-error")} detail={actionError} />
        )}
        {saveError && <ErrorBanner message={t("ttv.save-error")} detail={saveError} />}

        {session.status === "failed" && (
          <ErrorBanner message={t("ttv.failed")} detail={session.error ?? undefined} />
        )}

        {/* Lưới hai cột: trái = văn bản dài (Nguồn, Kịch bản), phải = thiết lập
            ngắn (Giọng, Cấu hình, Dựng). Dưới xl xẹp về một cột 1→5. */}
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {/* ================= Cột trái: nội dung ================= */}
          <div className="flex flex-col gap-4">
            {/* ---- 1. Nguồn ---- */}
            <Card
              title={
                <span className="inline-flex items-center gap-1.5">
                  {t("ttv.card-source")}
                  <InfoHint
                    titleKey="help.ttv-source.title"
                    bodyKey="help.ttv-source.body"
                    size={14}
                  />
                </span>
              }
              actions={
                // Chỉ hiện với nguồn LINK: dán thẳng văn bản thì không có gì để
                // bóc, mà server trả 400 NO_URL. Nút bấm được rồi báo lỗi còn
                // khó hiểu hơn là không có nút.
                source.kind === "url" ? (
                  <Button
                    variant="secondary"
                    small
                    disabled={locked || busy !== null || !source.url.trim()}
                    onClick={() => run("extract")}
                  >
                    {busy === "extract" ? (
                      <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} strokeWidth={2} />
                    )}
                    {article ? t("ttv.re-extract") : t("ttv.extract")}
                  </Button>
                ) : undefined
              }
            >
              <div className="flex flex-col gap-3">
                <div
                  className="flex flex-wrap gap-1.5"
                  role="radiogroup"
                  aria-label={t("ttv.source")}
                >
                  {(
                    [
                      ["url", "ttv.source.url", Link2],
                      ["text", "ttv.source.text", Type],
                    ] as const
                  ).map(([k, label, Icon]) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={source.kind === k}
                      disabled={locked}
                      onClick={() => patchSource({ kind: k as TextSourceKind }, true)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors duration-150 ${
                        source.kind === k
                          ? "border-[var(--primary)] bg-[var(--primary-soft)] font-medium text-[var(--primary)]"
                          : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                    >
                      <Icon size={13} strokeWidth={2} />
                      {t(label)}
                    </button>
                  ))}
                </div>

                {source.kind === "url" && (
                  <div>
                    <label className="label" htmlFor="ttv-detail-url">
                      {t("ttv.url")}
                    </label>
                    <input
                      id="ttv-detail-url"
                      className="input"
                      value={source.url}
                      disabled={locked}
                      placeholder={t("ttv.url-placeholder")}
                      onChange={(e) => patchSource({ url: e.target.value })}
                      onBlur={() => flush()}
                    />
                  </div>
                )}

                {session.status === "extracting" && (
                  <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                    {t("ttv.extracting-hint")}
                  </p>
                )}

                {article && (
                  <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
                    <p className="text-[13px] font-semibold">{article.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {article.siteName && <span className="chip">{article.siteName}</span>}
                      {article.byline && <span className="chip">{article.byline}</span>}
                      {article.publishedTime && (
                        <span className="chip">{formatDateTime(article.publishedTime)}</span>
                      )}
                      {article.lang && <span className="chip">{article.lang}</span>}
                      <span className="chip">
                        {tf("ttv.block-count", { n: article.blocks.length })}
                      </span>
                      <span className="chip">
                        {tf("ttv.char-count", { n: article.chars })}
                      </span>
                    </div>
                    {article.canonicalUrl && (
                      <a
                        href={article.canonicalUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-2 inline-flex max-w-full items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                      >
                        <ExternalLink size={12} strokeWidth={2} className="shrink-0" />
                        <span className="truncate">{article.canonicalUrl}</span>
                      </a>
                    )}
                  </div>
                )}

                <div>
                  <label className="label" htmlFor="ttv-detail-text">
                    {t("ttv.content")}
                  </label>
                  <textarea
                    id="ttv-detail-text"
                    className="input text-[13px]"
                    rows={10}
                    value={source.text}
                    disabled={locked}
                    placeholder={
                      source.kind === "url"
                        ? t("ttv.content-placeholder-url")
                        : t("ttv.text-placeholder")
                    }
                    onChange={(e) => patchSource({ text: e.target.value })}
                    onBlur={() => flush()}
                  />
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {t("ttv.content-hint")} ·{" "}
                    {tf("ttv.char-count", { n: source.text.trim().length })}
                  </p>
                </div>
              </div>
            </Card>

            {/* ---- 2. Kịch bản đọc ---- */}
            <Card
              title={
                <span className="inline-flex items-center gap-1.5">
                  {t("ttv.card-script")}
                  <InfoHint
                    titleKey="help.ttv-script.title"
                    bodyKey="help.ttv-script.body"
                    size={14}
                  />
                </span>
              }
              actions={
                <Button
                  small
                  disabled={!canScript || busy !== null}
                  onClick={() => run("script")}
                >
                  {busy === "script" ? (
                    <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                  ) : (
                    <Wand2 size={14} strokeWidth={2} />
                  )}
                  {script.length > 0 ? t("ttv.rewrite-script") : t("ttv.write-script")}
                </Button>
              }
            >
              <div className="flex flex-col gap-3">
                {/* Ai viết + viết dài bao nhiêu - hai tham số của nút bên trên */}
                <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ScriptModelSelect
                      value={scriptModel}
                      disabled={locked}
                      onChange={patchScriptModel}
                    />
                    <div>
                      <label className="label" htmlFor="ttv-target-seconds">
                        {t("ttv.target-seconds")}
                      </label>
                      <input
                        id="ttv-target-seconds"
                        className="input"
                        type="number"
                        min={10}
                        value={targetSeconds}
                        disabled={locked}
                        placeholder={t("ttv.target-auto")}
                        onChange={(e) => setTargetSeconds(e.target.value)}
                      />
                    </div>
                  </div>
                  <ClaudeAuthLine />
                </div>

                {session.status === "scripting" ? (
                  <p className="flex items-center gap-2 py-4 text-xs text-[var(--text-muted)]">
                    <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                    {t("ttv.scripting-hint")}
                  </p>
                ) : script.length === 0 ? (
                  <EmptyState
                    icon={Sparkles}
                    description={hasSourceText ? t("ttv.no-script") : t("ttv.no-source-yet")}
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    <ul className="flex flex-col gap-1.5">
                      {script.map((c, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-2"
                        >
                          <span className="mt-1.5 w-5 shrink-0 text-center font-mono text-xs text-[var(--text-muted)]">
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <textarea
                              className="input text-[13px]"
                              rows={2}
                              value={c.text}
                              disabled={locked}
                              aria-label={tf("ttv.chunk-aria", { n: i + 1 })}
                              onChange={(e) => setChunkText(i, e.target.value)}
                              onBlur={() => flush()}
                            />
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]">
                              <span>{tf("ttv.char-count", { n: c.text.trim().length })}</span>
                              <span>
                                {c.durationSec !== null
                                  ? tf("ttv.chunk-real", { time: clock(c.durationSec) })
                                  : tf("ttv.chunk-est", {
                                      time: clock(estimateChunkSeconds(c)),
                                    })}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={locked}
                            title={t("ttv.remove-chunk")}
                            aria-label={tf("ttv.remove-chunk-aria", { n: i + 1 })}
                            onClick={() =>
                              setChunks(
                                script.filter((_, idx) => idx !== i),
                                true
                              )
                            }
                            className="mt-1 shrink-0 rounded-[var(--radius)] p-1.5 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            <X size={14} strokeWidth={2} />
                          </button>
                        </li>
                      ))}
                    </ul>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Button
                        variant="secondary"
                        small
                        disabled={locked}
                        onClick={() =>
                          setChunks([...script, { text: "", durationSec: null }], true)
                        }
                      >
                        <Plus size={14} strokeWidth={2} />
                        {t("ttv.add-chunk")}
                      </Button>
                      <span className="text-xs text-[var(--text-muted)]">
                        {tf("ttv.chunk-count", { n: script.length })} ·{" "}
                        {tf("ttv.char-count", { n: chars })} ·{" "}
                        {tf("ttv.est-duration", { time: clock(estSeconds) })}
                        {session.voiceDurationSec !== null
                          ? ` · ${tf("ttv.real-duration", { time: clock(session.voiceDurationSec) })}`
                          : ""}
                      </span>
                    </div>

                    <p className="text-xs text-[var(--text-muted)]">
                      {t("ttv.estimate-warning")}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* ================= Cột phải: thiết lập ================= */}
          <div className="flex flex-col gap-4">
            {/* ---- 3. Giọng đọc ---- */}
            <Card
              title={
                <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
                  {t("ttv.card-voice")}
                  <InfoHint
                    titleKey="help.ttv-voice.title"
                    bodyKey="help.ttv-voice.body"
                    size={14}
                  />
                  {voice.name ? (
                    <span className="min-w-0 truncate rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--primary)]">
                      {voice.name}
                    </span>
                  ) : (
                    <span className="min-w-0 truncate rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-normal text-[var(--text-muted)]">
                      {t("ttv.voice-not-chosen")}
                    </span>
                  )}
                </span>
              }
            >
              <VoicePicker
                value={voice}
                onChange={patchVoice}
                previewText={script[0]?.text ?? ""}
                disabled={locked}
              />
            </Card>

            {/* ---- 4. Cấu hình video ---- */}
            <Card
              title={
                <span className="inline-flex items-center gap-1.5">
                  {t("ttv.card-config")}
                  <InfoHint
                    titleKey="help.ttv-config.title"
                    bodyKey="help.ttv-config.body"
                    size={14}
                  />
                </span>
              }
            >
              <div className="flex flex-col gap-5">
                <div>
                  <span className="label">{t("ttv.aspect")}</span>
                  <div className="flex flex-wrap gap-2">
                    {ASPECTS.map((a) => {
                      const size = TEXT_TO_VIDEO_SIZES[a];
                      const active = currentAspect === a;
                      return (
                        <button
                          key={a}
                          type="button"
                          disabled={locked}
                          aria-pressed={active}
                          onClick={() =>
                            patchOutput({ width: size.width, height: size.height })
                          }
                          className={`flex min-w-[92px] flex-1 flex-col items-center gap-0.5 rounded-[var(--radius)] border px-3 py-2 transition-colors duration-150 ${
                            active
                              ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                              : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--bg-subtle)]"
                          } disabled:cursor-not-allowed disabled:opacity-45`}
                        >
                          <span className="text-[13px] font-semibold">{a}</span>
                          <span className="text-[11px] text-[var(--text-muted)]">
                            {size.width}x{size.height}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {currentAspect === null && (
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {tf("ttv.custom-size", {
                        size: `${output.width}x${output.height}`,
                      })}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="ttv-fps">
                      {t("ttv.fps")}
                    </label>
                    <select
                      id="ttv-fps"
                      className="input"
                      value={output.fps}
                      disabled={locked}
                      onChange={(e) => patchOutput({ fps: Number(e.target.value) })}
                    >
                      {!TEXT_TO_VIDEO_FPS.includes(
                        output.fps as (typeof TEXT_TO_VIDEO_FPS)[number]
                      ) && <option value={output.fps}>{output.fps}</option>}
                      {TEXT_TO_VIDEO_FPS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="ttv-style">
                      Style Design
                    </label>
                    <StyleSelect
                      id="ttv-style"
                      value={output.styleId}
                      disabled={locked}
                      onChange={(styleId) => patchOutput({ styleId })}
                    />
                  </div>
                </div>

                <div className="border-t border-[var(--border)] pt-4">
                  <div className="mb-3 flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                    <p>{locked ? t("ttv.brief-locked") : t("ttv.brief-hint")}</p>
                    {!locked && <p>{t("ttv.brief-autosave")}</p>}
                  </div>
                  <BriefFields
                    value={brief}
                    onChange={patchBrief}
                    // Style Design đã có ô riêng phía trên; không có video gốc để mô tả
                    show={{ styleId: false, sourceDescription: false }}
                    disabled={locked}
                  />
                </div>
              </div>
            </Card>

            {/* ---- 5. Dựng video ---- */}
            <Card
              title={
                <span className="inline-flex items-center gap-1.5">
                  {t("ttv.card-build")}
                  <InfoHint
                    titleKey="help.ttv-build.title"
                    bodyKey="help.ttv-build.body"
                    size={14}
                  />
                </span>
              }
              actions={
                !session.projectId && (
                  <Button disabled={!canBuild || busy !== null} onClick={() => run("build")}>
                    {busy === "build" ? (
                      <Loader2 size={15} strokeWidth={2} className="animate-spin" />
                    ) : (
                      <FileText size={15} strokeWidth={2} />
                    )}
                    {t("ttv.build")}
                  </Button>
                )
              }
            >
              <div className="flex flex-col gap-3">
                {running ? (
                  <>
                    <ProgressBar progress={job?.progress ?? 0} step={job?.step} />
                    <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                      <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                      {session.status === "voicing"
                        ? t("ttv.voicing-hint")
                        : t("ttv.building-hint")}
                    </p>
                  </>
                ) : session.projectId ? (
                  <>
                    <p className="text-sm">{t("ttv.project-created")}</p>
                    <div>
                      <Link
                        href={`/projects/${session.projectId}`}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                      >
                        <ExternalLink size={14} strokeWidth={2} />
                        {t("ttv.open-project")}
                      </Link>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      {t("ttv.rebuild-disabled")}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">
                    {canBuild
                      ? t("ttv.build-hint")
                      : script.length === 0
                        ? t("ttv.build-need-script")
                        : t("ttv.build-need-voice")}
                  </p>
                )}

                {(session.voiceFile || session.transcriptFile) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {session.voiceFile && (
                      <span className="chip">
                        {t("ttv.voice-file")}: {session.voiceFile}
                      </span>
                    )}
                    {session.transcriptFile && (
                      <span className="chip">
                        {t("ttv.transcript-file")}: {session.transcriptFile}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Panel nhật ký AI - xl+ luôn hiển thị (fixed, cao hết viewport trừ topbar);
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
        aria-label={t("ttv.ai-panel-aria")}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <MessageSquare
              size={15}
              strokeWidth={2}
              className="shrink-0 text-[var(--text-muted)]"
            />
            {t("ttv.ai-panel")}
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            {activeSession && <SessionStatusBadge status={activeSession.status} />}
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label={t("ttv.close-panel")}
              className="rounded-[var(--radius)] p-1 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)] xl:hidden"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Job dựng: tiến trình + log từng dòng, đúng thứ trang Render Queue hiện */}
        {job && <JobLogBlock job={job} />}

        {session.projectId ? (
          activeSessionId || (chatSessions !== null && chatSessions.length > 0) ? (
            <ChatThread
              compact
              sessionId={activeSessionId}
              projectId={session.projectId}
              initialStatus={activeSession?.status}
              session={activeSession}
              onSessionCreated={(id) => {
                setActiveSessionId(id);
                loadChatSessions();
              }}
            />
          ) : (
            <div className="card flex min-h-0 flex-1 flex-col items-center justify-center">
              <EmptyState
                icon={Sparkles}
                description={
                  chatSessions === null
                    ? t("ttv.panel-chat-loading")
                    : t("ttv.panel-no-session")
                }
              />
            </div>
          )
        ) : job ? null : (
          <div className="card flex min-h-0 flex-1 flex-col items-center justify-center">
            <EmptyState icon={MessageSquare} description={t("ttv.panel-empty")} />
          </div>
        )}
      </aside>

      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("ttv.delete-title")}
        description={<p>{t("ttv.delete-desc")}</p>}
        items={[session.name]}
        busy={deleting}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDelete}
      />
    </div>
  );
}
