"use client";

/**
 * Danh sách phiên "Auto cut videos" - bày giống trang Videos Project để người
 * dùng không phải học lại cách đọc bảng.
 */

import { Scissors, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  deleteAutoCut,
  getAutoCutSessions,
  isAutoCutJob,
  type AutoCutMeta,
} from "@/lib/api";
import { useJobEvents } from "@/lib/useEvents";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { PageHeader } from "@/components/PageHeader";
import { AutoCutCreateModal } from "@/components/AutoCutCreateModal";
import {
  AutoCutStatusBadge,
  MODE_LABEL,
  aspectLabel,
} from "@/components/AutoCutCommon";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

export default function AutoCutPage() {
  const { t, tf } = useT();
  const router = useRouter();

  const [sessions, setSessions] = useState<AutoCutMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Phiên đang chờ xác nhận xóa
  const [target, setTarget] = useState<AutoCutMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await getAutoCutSessions());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Job auto-cut kết thúc → trạng thái phiên đổi, nạp lại bảng
  useJobEvents((job) => {
    if (!isAutoCutJob(job)) return;
    if (["done", "failed", "canceled"].includes(job.status)) load();
  });

  async function onDelete() {
    if (!target || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAutoCut(target.id);
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
            {t("nav.auto-cut")}
            <InfoHint
              titleKey="help.autocut.title"
              bodyKey="help.autocut.body"
              size={14}
            />
          </span>
        }
        subtitle={t("autocut.subtitle")}
        actions={
          <>
            <Button onClick={() => setCreateOpen(true)}>
              <Scissors size={16} strokeWidth={2} />
              {t("autocut.new")}
            </Button>
          </>
        }
      />

      {error && <ErrorBanner message={t("autocut.load-error")} detail={error} />}

      <Card>
        {sessions && sessions.length > 0 ? (
          // Bảng nhiều cột - màn hẹp thì cuộn ngang thay vì vỡ layout
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("autocut.col-mode")}</th>
                  <th>{t("autocut.col-aspect")}</th>
                  <th>{t("autocut.col-segments")}</th>
                  <th>{t("common.updated")}</th>
                  <th className="w-10">
                    <span className="sr-only">{t("common.delete")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const created = s.segments.filter((x) => x.projectId).length;
                  return (
                    <tr
                      key={s.id}
                      className="row-click"
                      onClick={() => router.push(`/auto-cut/${s.id}`)}
                    >
                      <td>
                        <span className="font-medium">{s.name}</span>
                        <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                          {s.source.relPath}
                        </span>
                      </td>
                      <td>
                        <AutoCutStatusBadge status={s.status} />
                      </td>
                      <td className="text-[var(--text-muted)]">
                        {t(MODE_LABEL[s.mode] ?? "autocut.mode.time")}
                      </td>
                      <td className="text-[var(--text-muted)]">
                        {aspectLabel(s.output.aspect, t)}
                      </td>
                      <td className="text-[var(--text-muted)]">
                        {s.segments.length} / {created}
                      </td>
                      <td className="text-[var(--text-muted)]">
                        {formatDateTime(s.updatedAt)}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          title={t("common.delete")}
                          aria-label={tf("autocut.delete-aria", { name: s.name })}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : sessions ? (
          <EmptyState
            icon={Scissors}
            description={t("autocut.empty")}
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Scissors size={16} strokeWidth={2} />
                {t("autocut.new")}
              </Button>
            }
          />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        )}
      </Card>

      <AutoCutCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          router.push(`/auto-cut/${id}`);
        }}
      />

      {/* Xóa phiên = xóa dữ liệu → bắt gõ DELETE */}
      <ConfirmDeleteModal
        open={target !== null}
        title={t("autocut.delete-title")}
        description={<p>{t("autocut.delete-desc")}</p>}
        items={target ? [`${target.name} - ${target.source.relPath}`] : []}
        busy={deleting}
        error={deleteError}
        onClose={() => setTarget(null)}
        onConfirm={onDelete}
      />
    </div>
  );
}
