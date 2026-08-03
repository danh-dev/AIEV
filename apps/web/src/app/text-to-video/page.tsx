"use client";

/**
 * Danh sách phiên "Text to video" - bày giống trang Auto cut videos: một bảng
 * phiên, mỗi phiên rồi sẽ đẻ ra một Videos Project. Người dùng đọc hai bảng
 * theo cùng một cách, không phải học lại.
 */

import { ExternalLink, FileText, Link2, Loader2, Trash2, Type } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  createTextToVideo,
  deleteTextToVideo,
  estimateScriptSeconds,
  extractTextToVideo,
  getTextToVideoSessions,
  isTextToVideoJob,
  TEXT_TO_VIDEO_STATUS_LABEL,
  TEXT_TO_VIDEO_STATUS_TONE,
  type TextSourceKind,
  type TextToVideoMeta,
} from "@/lib/api";
import { useAgentEvents, useEvents, useJobEvents } from "@/lib/useEvents";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
// clock() (giây → mm:ss) đã có sẵn ở đây, lib/format.ts chưa có helper tương đương
import { clock } from "@/components/AutoCutCommon";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

/** Một dòng mô tả nguồn của phiên: link rút gọn hoặc mấy chữ đầu văn bản. */
function sourceLine(s: TextToVideoMeta): string {
  if (s.source.kind === "url") return s.source.url;
  const text = s.source.text.trim().replace(/\s+/g, " ");
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

/** Modal "Bài viết mới" - chỉ hỏi nguồn, mọi cấu hình khác nằm ở trang chi tiết. */
function CreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useT();
  const [kind, setKind] = useState<TextSourceKind>("url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phiên đã tạo nhưng bước trích xuất lỗi - cho mở phiên chứ đừng tạo trùng
  const [createdId, setCreatedId] = useState<string | null>(null);

  const canCreate =
    !creating && (kind === "url" ? url.trim() !== "" : text.trim() !== "");

  async function onCreate() {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    let id = createdId;
    try {
      if (!id) {
        const session = await createTextToVideo({
          ...(name.trim() ? { name: name.trim() } : {}),
          source: { kind, url: url.trim(), text: text.trim() },
        });
        id = session.id;
        setCreatedId(id);
      }
      // Link thì bóc nội dung luôn - đó mới là thứ người dùng đang chờ.
      // Văn bản dán tay thì đã có sẵn nội dung, vào thẳng phiên.
      if (kind === "url") await extractTextToVideo(id);
      onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      title={t("ttv.create-title")}
      open={open}
      onClose={() => {
        if (!creating) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" disabled={creating} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {createdId && error ? (
            <Button onClick={() => onCreated(createdId)}>
              {t("ttv.open-session")}
            </Button>
          ) : null}
          <Button disabled={!canCreate} onClick={onCreate}>
            {creating ? (
              <Loader2 size={15} strokeWidth={2} className="animate-spin" />
            ) : (
              <FileText size={15} strokeWidth={2} />
            )}
            {creating ? t("ttv.creating") : t("ttv.create")}
          </Button>
        </>
      }
    >
      {error && (
        <ErrorBanner
          message={createdId ? t("ttv.extract-error-created") : t("ttv.create-error")}
          detail={error}
        />
      )}

      <div>
        <span className="label">
          {t("ttv.source")}
          <InfoHint
            className="ml-1.5 align-middle"
            titleKey="help.ttv-source.title"
            bodyKey="help.ttv-source.body"
          />
        </span>
        <div className="flex gap-1.5" role="radiogroup" aria-label={t("ttv.source")}>
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
              aria-checked={kind === k}
              disabled={creating}
              onClick={() => setKind(k)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors duration-150 ${
                kind === k
                  ? "border-[var(--primary)] bg-[var(--primary-soft)] font-medium text-[var(--primary)]"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
              } disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <Icon size={13} strokeWidth={2} />
              {t(label)}
            </button>
          ))}
        </div>
      </div>

      {kind === "url" ? (
        <div>
          <label className="label" htmlFor="ttv-url">
            {t("ttv.url")}
          </label>
          <input
            id="ttv-url"
            className="input"
            value={url}
            disabled={creating}
            placeholder={t("ttv.url-placeholder")}
            onChange={(e) => setUrl(e.target.value)}
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("ttv.url-hint")}
          </p>
        </div>
      ) : (
        <div>
          <label className="label" htmlFor="ttv-text">
            {t("ttv.text")}
          </label>
          <textarea
            id="ttv-text"
            className="input"
            rows={8}
            value={text}
            disabled={creating}
            placeholder={t("ttv.text-placeholder")}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("ttv.text-hint")}
          </p>
        </div>
      )}

      <div>
        <label className="label" htmlFor="ttv-name">
          {t("ttv.name")}
        </label>
        <input
          id="ttv-name"
          className="input"
          value={name}
          disabled={creating}
          placeholder={t("ttv.name-placeholder")}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
    </Modal>
  );
}

export default function TextToVideoPage() {
  const { t, tf } = useT();
  const router = useRouter();
  // SSE đứt rồi nối lại → refetch bảng để status không kẹt "đang dựng" mãi
  const { resyncTick } = useEvents();

  const [sessions, setSessions] = useState<TextToVideoMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Phiên đang chờ xác nhận xóa
  const [target, setTarget] = useState<TextToVideoMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await getTextToVideoSessions());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, resyncTick]);

  // Job dựng video kết thúc → trạng thái phiên đổi, nạp lại bảng
  useJobEvents((job) => {
    if (!isTextToVideoJob(job)) return;
    if (["done", "failed", "canceled"].includes(job.status)) load();
  });

  // Phiên AI edit của project con kết thúc → phiên TTV rời "editing" sang
  // "done"/"failed"; chỉ nghe job thì badge "đang edit" treo mãi sau khi xong
  useAgentEvents((e) => {
    if (e.kind === "done") load();
  });

  async function onDelete() {
    if (!target || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteTextToVideo(target.id);
      setTarget(null);
      await load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            {t("nav.text-to-video")}
            <InfoHint titleKey="help.ttv.title" bodyKey="help.ttv.body" size={14} />
          </span>
        }
        subtitle={t("ttv.subtitle")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <FileText size={16} strokeWidth={2} />
            {t("ttv.new")}
          </Button>
        }
      />

      {error && <ErrorBanner message={t("ttv.load-error")} detail={error} />}

      <Card>
        {sessions && sessions.length > 0 ? (
          // Bảng nhiều cột - màn hẹp thì cuộn ngang thay vì vỡ layout
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  {/* Ba cột phụ ẩn dưới xl. Đo được: 8 cột cộng lại rộng 973px,
                      trong khi vùng nội dung chỉ còn 606px sau khi trừ sidebar
                      220px - lúc đó CẢ TRANG trượt ngang (window.scrollX tới
                      291px), kéo theo cả sidebar, chứ không phải chỉ bảng cuộn
                      trong khung. Bỏ 3 cột này là bảng còn 732px, vừa khung. */}
                  <th>{t("common.name")}</th>
                  <th>{t("common.status")}</th>
                  <th className="hidden xl:table-cell">{t("ttv.col-source")}</th>
                  <th>{t("ttv.col-script")}</th>
                  <th className="hidden xl:table-cell">{t("ttv.col-voice")}</th>
                  <th>{t("ttv.col-project")}</th>
                  <th className="hidden xl:table-cell">{t("common.updated")}</th>
                  <th className="w-10">
                    <span className="sr-only">{t("common.delete")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    className="row-click"
                    onClick={() => router.push(`/text-to-video/${s.id}`)}
                  >
                    <td>
                      <span className="font-medium">{s.name}</span>
                      <span className="mt-0.5 block max-w-[360px] truncate text-xs text-[var(--text-muted)]">
                        {sourceLine(s)}
                      </span>
                    </td>
                    <td>
                      <Badge
                        tone={TEXT_TO_VIDEO_STATUS_TONE[s.status] ?? "muted"}
                        label={
                          TEXT_TO_VIDEO_STATUS_LABEL[s.status]
                            ? t(TEXT_TO_VIDEO_STATUS_LABEL[s.status])
                            : String(s.status)
                        }
                      />
                    </td>
                    <td className="hidden text-[var(--text-muted)] xl:table-cell">
                      {s.source.kind === "url"
                        ? t("ttv.source.url")
                        : t("ttv.source.text")}
                    </td>
                    <td className="text-[var(--text-muted)]">
                      {s.script.length > 0
                        ? `${tf("ttv.chunk-count", { n: s.script.length })} · ~${clock(
                            estimateScriptSeconds(s.script)
                          )}`
                        : "-"}
                    </td>
                    <td className="hidden text-[var(--text-muted)] xl:table-cell">
                      {s.voice.name || "-"}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {s.projectId ? (
                        <Link
                          href={`/projects/${s.projectId}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                        >
                          <ExternalLink size={12} strokeWidth={2} />
                          {t("ttv.open-project")}
                        </Link>
                      ) : (
                        <span className="text-[var(--text-muted)]">-</span>
                      )}
                    </td>
                    <td className="hidden text-[var(--text-muted)] xl:table-cell">
                      {formatDateTime(s.updatedAt)}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        title={t("common.delete")}
                        aria-label={tf("ttv.delete-aria", { name: s.name })}
                        onClick={() => {
                          setDeleteError(null);
                          setTarget(s);
                        }}
                        className="rounded-[var(--radius)] p-1.5 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
                      >
                        <Trash2 size={15} strokeWidth={2} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : sessions ? (
          <EmptyState
            icon={FileText}
            description={t("ttv.empty")}
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <FileText size={16} strokeWidth={2} />
                {t("ttv.new")}
              </Button>
            }
          />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        )}
      </Card>

      <CreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          router.push(`/text-to-video/${id}`);
        }}
      />

      {/* Xóa phiên = xóa dữ liệu → bắt gõ DELETE */}
      <ConfirmDeleteModal
        open={target !== null}
        title={t("ttv.delete-title")}
        description={<p>{t("ttv.delete-desc")}</p>}
        items={target ? [`${target.name} - ${sourceLine(target)}`] : []}
        busy={deleting}
        error={deleteError}
        onClose={() => setTarget(null)}
        onConfirm={onDelete}
      />
    </div>
  );
}
