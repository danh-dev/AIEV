"use client";

import {
  Check,
  ClipboardCheck,
  Loader2,
  MonitorPlay,
  Pencil,
  Pin,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addReviewNote,
  ApiError,
  deleteReviewNote,
  getReviewNotes,
  mediaUrl,
  REVIEW_TEXT_MAX,
  sendReviewNotes,
  updateReviewNote,
  type ReviewNote,
  type ReviewNoteStatus,
} from "@/lib/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { useT } from "@/lib/i18n";

/**
 * Giây → "mm:ss" (phút vượt 59 vẫn hiện đúng với video dài).
 * Viết tại chỗ vì lib/format.ts chưa có helper thời lượng dạng đồng hồ.
 */
function clock(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** Bộ đếm ký tự chỉ hiện khi sắp chạm trần - không làm ồn ô nhập lúc gõ ngắn. */
const COUNTER_FROM = REVIEW_TEXT_MAX - 80;

const STATUS_KEY: Record<ReviewNoteStatus, string> = {
  open: "review.status-open",
  sent: "review.status-sent",
  resolved: "review.status-resolved",
};

/** Chip trạng thái ghi chú - dùng lại bảng màu badge của design system. */
function NoteStatusChip({ status }: { status: ReviewNoteStatus }) {
  const { t } = useT();
  const cls =
    status === "resolved"
      ? "badge-success"
      : status === "sent"
        ? "badge-running"
        : "badge-muted";
  return (
    <span className={`badge ${cls} shrink-0`}>
      <span className="badge-dot" />
      {t(STATUS_KEY[status])}
    </span>
  );
}

/**
 * Card "Duyệt bản draft": xem draft, ghim ghi chú tại đúng giây, gửi cả loạt
 * cho AI sửa đúng chỗ thay vì dựng lại cả video.
 */
export function ProjectReviewCard({
  projectId,
  output,
  version,
  aiRunning = false,
}: {
  projectId: string;
  /** Đường dẫn video final trong meta (fallback khi chưa có draft). */
  output?: string | null;
  /** updatedAt của project - cache-bust vì draft ghi đè cùng tên file. */
  version?: string;
  /** Phiên AI của project đang chạy → không cho gửi ghi chú chồng lượt. */
  aiRunning?: boolean;
}) {
  const { t, tf } = useT();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [notes, setNotes] = useState<ReviewNote[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Bản draft luôn nằm ở outputs/<id>-draft.mp4 (jobs/assemble.ts). Client không
  // liệt kê được thư mục outputs nên cứ thử phát draft trước, video báo lỗi
  // (404) mới rơi về bản final - không cần thêm API chỉ để hỏi "có draft chưa".
  const [draftMissing, setDraftMissing] = useState(false);
  const cacheBust = version ? `?v=${encodeURIComponent(version)}` : "";
  const draftUrl = mediaUrl(`outputs/${projectId}-draft.mp4`) + cacheBust;
  const finalUrl = output ? mediaUrl(output) + cacheBust : null;
  const videoUrl = draftMissing ? finalUrl : draftUrl;

  // Project/bản render đổi → thử lại draft từ đầu
  useEffect(() => {
    setDraftMissing(false);
  }, [projectId, version]);

  const load = useCallback(async () => {
    try {
      const { notes: list } = await getReviewNotes(projectId);
      setNotes(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // ---- Ghim ghi chú mới --------------------------------------------------
  // currentTime của video theo dõi bằng state để nhãn nút "Ghim tại mm:ss"
  // luôn khớp chỗ đang xem.
  const [currentSec, setCurrentSec] = useState(0);
  const [pinAt, setPinAt] = useState<number | null>(null);
  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);
  const newInputRef = useRef<HTMLTextAreaElement>(null);

  function openPin() {
    // Lấy mốc NGAY lúc bấm - người dùng gõ xong mới lưu, lúc đó video đã chạy tiếp
    setPinAt(videoRef.current?.currentTime ?? currentSec);
    setNewText("");
    setActionError(null);
  }

  useEffect(() => {
    if (pinAt !== null) newInputRef.current?.focus();
  }, [pinAt]);

  async function saveNewNote() {
    const text = newText.trim();
    if (pinAt === null || !text || adding) return;
    setAdding(true);
    setActionError(null);
    try {
      const { note } = await addReviewNote(projectId, pinAt, text);
      setNotes((prev) => [...prev, note].sort((a, b) => a.atSec - b.atSec));
      setPinAt(null);
      setNewText("");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }

  /** Tua video tới mốc của ghi chú rồi phát tiếp - xem đúng chỗ đang nói tới. */
  function seekTo(atSec: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = atSec;
    void v.play().catch(() => {
      // Trình duyệt chặn autoplay - đã tua đúng chỗ là đủ
    });
  }

  // ---- Sửa / đánh dấu xong / xóa ----------------------------------------
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function patchNote(
    noteId: string,
    patch: { text?: string; status?: ReviewNoteStatus }
  ) {
    setBusyId(noteId);
    setActionError(null);
    try {
      const { note } = await updateReviewNote(projectId, noteId, patch);
      setNotes((prev) => prev.map((n) => (n.id === note.id ? note : n)));
      setEditingId(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function removeNote(noteId: string) {
    // Ghi chú không phải dữ liệu nguồn (xóa nhầm chỉ mất một dòng chữ) nên
    // KHÔNG dùng ConfirmDeleteModal - đúng quy ước ghi trong ConfirmDeleteModal.tsx.
    if (!window.confirm(t("review.delete-confirm"))) return;
    setBusyId(noteId);
    setActionError(null);
    try {
      await deleteReviewNote(projectId, noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  // ---- Gửi cho AI --------------------------------------------------------
  const [extraNotes, setExtraNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentInfo, setSentInfo] = useState<string | null>(null);
  // 409 SESSION_BUSY từ server - khóa nút cho tới khi người dùng bấm lại
  const [sessionBusy, setSessionBusy] = useState(false);

  const openCount = notes.filter((n) => n.status === "open").length;
  const sendBlocked = aiRunning || sessionBusy;

  async function onSend() {
    if (sending || openCount === 0 || sendBlocked) return;
    setSending(true);
    setSendError(null);
    setSentInfo(null);
    try {
      const { sentCount } = await sendReviewNotes(projectId, extraNotes);
      setExtraNotes("");
      setSessionBusy(false);
      // Trang Chat riêng đã bỏ (redirect về Dashboard) nên không có link phiên
      // để trỏ tới - chỉ ra hiệu xem panel AI của project.
      setSentInfo(tf("review.sent-ok", { n: sentCount }));
      load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "SESSION_BUSY") setSessionBusy(true);
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const newLeft = REVIEW_TEXT_MAX - newText.length;
  const editLeft = REVIEW_TEXT_MAX - editText.length;

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-1.5">
          {t("review.title")}
          <InfoHint
            titleKey="help.review.title"
            bodyKey="help.review.body"
            size={14}
          />
        </span>
      }
    >
      {loadError && (
        <div className="mb-3">
          <ErrorBanner message={t("review.load-error")} detail={loadError} />
        </div>
      )}

      {videoUrl ? (
        <div className="flex flex-col gap-2">
          <video
            ref={videoRef}
            controls
            src={videoUrl}
            onTimeUpdate={(e) => setCurrentSec(e.currentTarget.currentTime)}
            onError={() => setDraftMissing(true)}
            className="mx-auto max-h-[280px] max-w-full rounded-[var(--radius)] bg-[var(--bg-subtle)]"
          />
          {draftMissing && (
            <p className="text-xs text-[var(--text-muted)]">
              {t("review.watching-final")}
            </p>
          )}
        </div>
      ) : (
        <EmptyState icon={MonitorPlay} description={t("review.no-draft")} />
      )}

      {/* Hàng thao tác: ghim ghi chú tại giây đang xem */}
      {videoUrl && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" small onClick={openPin}>
              <Pin size={14} strokeWidth={2} />
              {tf("review.pin-at", { time: clock(currentSec) })}
            </Button>
            <span className="text-xs text-[var(--text-muted)]">
              {t("review.pin-hint")}
            </span>
          </div>

          {pinAt !== null && (
            <div className="flex flex-col gap-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--primary)]">
                  {clock(pinAt)}
                </span>
                <button
                  type="button"
                  aria-label={t("common.close")}
                  onClick={() => setPinAt(null)}
                  className="rounded-[var(--radius)] p-1 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface)] hover:text-[var(--text)]"
                >
                  <X size={14} strokeWidth={2} />
                </button>
              </div>
              <textarea
                ref={newInputRef}
                className="input"
                rows={2}
                maxLength={REVIEW_TEXT_MAX}
                value={newText}
                placeholder={t("review.note-placeholder")}
                onChange={(e) => setNewText(e.target.value)}
                onKeyDown={(e) => {
                  // Enter lưu luôn, Shift+Enter xuống dòng - ghi chú thường 1 dòng
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    saveNewNote();
                  } else if (e.key === "Escape") {
                    setPinAt(null);
                  }
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-[var(--text-muted)]">
                  {newText.length >= COUNTER_FROM
                    ? tf("review.chars-left", { n: newLeft })
                    : ""}
                </span>
                <Button
                  small
                  disabled={adding || !newText.trim()}
                  onClick={saveNewNote}
                >
                  {adding ? (
                    <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                  ) : (
                    <Pin size={13} strokeWidth={2} />
                  )}
                  {t("review.add")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {actionError && (
        <p className="mt-2 text-xs text-[var(--danger)]">{actionError}</p>
      )}

      {/* Danh sách ghi chú theo thứ tự thời gian trong video */}
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        {notes.length === 0 ? (
          <EmptyState icon={ClipboardCheck} description={t("review.no-notes")} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {notes.map((n) => {
              const busy = busyId === n.id;
              return (
                <li
                  key={n.id}
                  className="flex flex-wrap items-start gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-2"
                >
                  <button
                    type="button"
                    onClick={() => seekTo(n.atSec)}
                    aria-label={tf("review.seek-aria", { time: clock(n.atSec) })}
                    className="shrink-0 rounded-[var(--radius)] bg-[var(--surface)] px-1.5 py-0.5 font-mono text-xs font-semibold text-[var(--primary)] transition-colors duration-150 hover:bg-[var(--primary-soft)]"
                  >
                    {clock(n.atSec)}
                  </button>

                  {editingId === n.id ? (
                    <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
                      <textarea
                        className="input"
                        rows={2}
                        autoFocus
                        maxLength={REVIEW_TEXT_MAX}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            if (editText.trim())
                              patchNote(n.id, { text: editText.trim() });
                          } else if (e.key === "Escape") {
                            setEditingId(null);
                          }
                        }}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-[var(--text-muted)]">
                          {editText.length >= COUNTER_FROM
                            ? tf("review.chars-left", { n: editLeft })
                            : ""}
                        </span>
                        <span className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            small
                            onClick={() => setEditingId(null)}
                          >
                            {t("common.cancel")}
                          </Button>
                          <Button
                            small
                            disabled={busy || !editText.trim()}
                            onClick={() =>
                              patchNote(n.id, { text: editText.trim() })
                            }
                          >
                            {t("common.save")}
                          </Button>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="min-w-[140px] flex-1 whitespace-pre-line text-[13px] leading-snug">
                      {n.text}
                    </p>
                  )}

                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    <NoteStatusChip status={n.status} />
                    {editingId !== n.id && (
                      <>
                        <button
                          type="button"
                          title={t("review.edit-note")}
                          aria-label={t("review.edit-note")}
                          disabled={busy}
                          onClick={() => {
                            setEditingId(n.id);
                            setEditText(n.text);
                          }}
                          className="rounded-[var(--radius)] p-1 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface)] hover:text-[var(--text)] disabled:opacity-50"
                        >
                          <Pencil size={13} strokeWidth={2} />
                        </button>
                        {n.status !== "resolved" && (
                          <button
                            type="button"
                            title={t("review.mark-resolved")}
                            aria-label={t("review.mark-resolved")}
                            disabled={busy}
                            onClick={() =>
                              patchNote(n.id, { status: "resolved" })
                            }
                            className="rounded-[var(--radius)] p-1 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--success-bg)] hover:text-[var(--success)] disabled:opacity-50"
                          >
                            <Check size={13} strokeWidth={2} />
                          </button>
                        )}
                        <button
                          type="button"
                          title={t("review.delete-note")}
                          aria-label={t("review.delete-note")}
                          disabled={busy}
                          onClick={() => removeNote(n.id)}
                          className="rounded-[var(--radius)] p-1 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] disabled:opacity-50"
                        >
                          <Trash2 size={13} strokeWidth={2} />
                        </button>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Gửi cả loạt ghi chú đang mở cho AI sửa */}
      <div className="mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
        <label className="label" htmlFor={`review-extra-${projectId}`}>
          {t("review.extra-notes")}
        </label>
        <textarea
          id={`review-extra-${projectId}`}
          className="input"
          rows={2}
          value={extraNotes}
          placeholder={t("review.extra-placeholder")}
          onChange={(e) => setExtraNotes(e.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[var(--text-muted)]">
            {sendBlocked
              ? t("review.busy")
              : openCount === 0
                ? t("review.need-open")
                : ""}
          </span>
          <Button
            disabled={sending || openCount === 0 || sendBlocked}
            onClick={onSend}
          >
            {sending ? (
              <Loader2 size={14} strokeWidth={2} className="animate-spin" />
            ) : (
              <Send size={14} strokeWidth={2} />
            )}
            {sending ? t("review.sending") : tf("review.send", { n: openCount })}
          </Button>
        </div>
        {sentInfo && (
          <p className="text-xs text-[var(--success)]">{sentInfo}</p>
        )}
        {sendError && (
          <ErrorBanner message={t("review.send-error")} detail={sendError} />
        )}
      </div>
    </Card>
  );
}
