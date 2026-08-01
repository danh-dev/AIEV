"use client";

import { CheckCircle2, Image as ImageIcon, Images, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cleanImageJunk,
  createImageProject,
  deleteImageProject,
  getImageJunk,
  getImageProjects,
  getJobs,
  imageFileUrl,
  type ImageProject,
} from "@/lib/api";
import { useJobEvents } from "@/lib/useEvents";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import {
  AspectChip,
  DEFAULT_IMAGE_DRAFT,
  ImageProjectFields,
  ImageStatusBadge,
  type ImageDraft,
} from "@/components/ImageProjectForm";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { ProgressBar } from "@/components/ProgressBar";
import { formatBytes, formatDateTime } from "@/lib/format";
import { useT } from "@/lib/i18n";

// ============ Danh sách dự án ảnh ============

function ImageProjectList({ onCreate }: { onCreate: () => void }) {
  const { t, tf } = useT();
  const router = useRouter();
  const [list, setList] = useState<ImageProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tiến trình thật của job image-gen theo projectId - cho ProgressBar mini trong bảng
  const [genProgress, setGenProgress] = useState<
    Record<string, { progress: number; step: string }>
  >({});

  // Chọn nhiều dự án ảnh
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);

  // Bulk "Xóa file rác" trên các dự án đã chọn
  const [junkBusy, setJunkBusy] = useState(false);
  const [bulkActionNotice, setBulkActionNotice] = useState<string | null>(null);
  const [bulkActionErrors, setBulkActionErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const [projects, jobs] = await Promise.all([
        getImageProjects(),
        // tìm job image-gen còn queued/running khi mới mở trang → seed progress
        getJobs(50).catch(() => []),
      ]);
      setList(projects);
      const map: Record<string, { progress: number; step: string }> = {};
      for (const j of jobs) {
        if (
          j.type === "image-gen" &&
          (j.status === "queued" || j.status === "running")
        ) {
          map[j.projectId] = { progress: j.progress, step: j.step };
        }
      }
      setGenProgress(map);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Job "image-gen" đổi trạng thái → cập nhật sống danh sách + progress
  useJobEvents((job) => {
    if (job.type !== "image-gen") return;
    if (["done", "failed", "canceled"].includes(job.status)) {
      setGenProgress((m) => {
        if (!(job.projectId in m)) return m;
        const next = { ...m };
        delete next[job.projectId];
        return next;
      });
      load();
    } else {
      setGenProgress((m) => ({
        ...m,
        [job.projectId]: { progress: job.progress, step: job.step },
      }));
      // job vừa chạy → đánh dấu generating ngay, không chờ refetch
      setList(
        (cur) =>
          cur?.map((p) =>
            p.id === job.projectId && p.status !== "generating"
              ? { ...p, status: "generating" as const }
              : p
          ) ?? cur
      );
    }
  });

  // ---- Chọn / bỏ chọn ----

  const allSelected =
    !!list && list.length > 0 && list.every((p) => selected.has(p.id));
  const someSelected =
    !!list && !allSelected && list.some((p) => selected.has(p.id));

  function toggleOne(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!list) return;
    setSelected((cur) => {
      const next = new Set(cur);
      if (allSelected) {
        for (const p of list) next.delete(p.id);
      } else {
        for (const p of list) next.add(p.id);
      }
      return next;
    });
  }

  const selectedProjects = useMemo(
    () => (list ?? []).filter((p) => selected.has(p.id)),
    [list, selected]
  );

  // ---- Xóa nhiều dự án ảnh ----

  async function onDeleteSelected() {
    if (bulkDeleting || junkBusy || selectedProjects.length === 0) return;
    const targets = selectedProjects;
    setBulkDeleting(true);
    setBulkErrors([]);
    // Xóa TUẦN TỰ - lỗi nào gom lại hiện sau
    const errors: string[] = [];
    for (const p of targets) {
      try {
        await deleteImageProject(p.id);
      } catch (e) {
        errors.push(
          `${p.name} (${p.id}): ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
    setBulkDeleting(false);
    setBulkDeleteOpen(false);
    setSelected(new Set());
    setBulkErrors(errors);
    await load();
  }

  // ---- Xóa file rác hàng loạt ----

  async function onBulkCleanJunk() {
    if (bulkDeleting || junkBusy || selectedProjects.length === 0) return;
    setJunkBusy(true);
    setBulkActionNotice(null);
    setBulkActionErrors([]);
    const targets = selectedProjects;
    const errors: string[] = [];
    try {
      // Quét file rác từng dự án để confirm MỘT lần với tổng dung lượng
      const junks: { id: string; name: string; items: number; bytes: number }[] =
        [];
      for (const p of targets) {
        try {
          const junk = await getImageJunk(p.id);
          if (junk.items.length > 0) {
            junks.push({
              id: p.id,
              name: p.name,
              items: junk.items.length,
              bytes: junk.totalBytes,
            });
          }
        } catch (e) {
          errors.push(
            `${p.name} (${p.id}): ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
      if (junks.length === 0) {
        if (errors.length > 0) setBulkActionErrors(errors);
        else setBulkActionNotice(t("junk.none"));
        return;
      }
      const totalItems = junks.reduce((sum, j) => sum + j.items, 0);
      const totalBytes = junks.reduce((sum, j) => sum + j.bytes, 0);
      if (
        !window.confirm(
          tf("imagesPage.junk-confirm", {
            items: totalItems,
            projects: junks.length,
            size: formatBytes(totalBytes),
          })
        )
      )
        return;
      // Xóa tuần tự - dự án đang có job server trả 409, gom lỗi và đi tiếp
      let freed = 0;
      let deleted = 0;
      let cleaned = 0;
      for (const j of junks) {
        try {
          const result = await cleanImageJunk(j.id);
          freed += result.freedBytes;
          deleted += result.deleted;
          cleaned++;
        } catch (e) {
          errors.push(
            `${j.name} (${j.id}): ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
      if (cleaned > 0) {
        setBulkActionNotice(
          tf("imagesPage.junk-freed", {
            size: formatBytes(freed),
            items: deleted,
            projects: cleaned,
          })
        );
      }
      if (errors.length > 0) setBulkActionErrors(errors);
      await load();
    } finally {
      setJunkBusy(false);
    }
  }

  return (
    <>
      {error && (
        <ErrorBanner message={t("imagesPage.load-error")} detail={error} />
      )}
      {bulkErrors.length > 0 && (
        <ErrorBanner
          message={tf("imagesPage.bulk-delete-errors", { n: bulkErrors.length })}
          detail={bulkErrors.join("\n")}
        />
      )}
      {bulkActionNotice && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success)]">
          <CheckCircle2 size={15} strokeWidth={2} className="shrink-0" />
          {bulkActionNotice}
        </div>
      )}
      {bulkActionErrors.length > 0 && (
        <ErrorBanner
          message={tf("imagesPage.bulk-action-errors", { n: bulkActionErrors.length })}
          detail={bulkActionErrors.join("\n")}
        />
      )}

      <Card>
        {selected.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius)] bg-[var(--bg-subtle)] px-3 py-2">
            <span className="text-sm font-medium">
              {tf("imagesPage.selected", { n: selected.size })}
            </span>
            <span className="flex-1" />
            <Button
              variant="secondary"
              small
              disabled={bulkDeleting || junkBusy}
              onClick={() => setSelected(new Set())}
            >
              {t("common.deselect")}
            </Button>
            <Button
              variant="secondary"
              small
              disabled={bulkDeleting || junkBusy}
              onClick={onBulkCleanJunk}
            >
              <Trash2 size={14} strokeWidth={2} />
              {junkBusy ? t("junk.cleaning") : t("junk.clean")}
            </Button>
            <Button
              variant="destructive"
              small
              disabled={bulkDeleting || junkBusy}
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 size={14} strokeWidth={2} />
              {bulkDeleting ? t("common.deleting") : t("common.delete-selected")}
            </Button>
          </div>
        )}

        {list && list.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    className="checkbox align-middle"
                    aria-label={t("imagesPage.select-all")}
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                  />
                </th>
                <th className="w-12">
                  <span className="sr-only">{t("imagesPage.col-image")}</span>
                </th>
                <th>{t("common.name")}</th>
                <th>{t("common.status")}</th>
                <th>{t("imagesPage.col-aspect")}</th>
                <th>Model</th>
                <th>{t("common.created")}</th>
                <th>{t("common.updated")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const thumb = p.final ?? p.background;
                return (
                  <tr
                    key={p.id}
                    className="row-click"
                    onClick={() => router.push(`/images/${p.id}`)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="checkbox align-middle"
                        aria-label={tf("common.select-aria", { name: p.name })}
                        checked={selected.has(p.id)}
                        disabled={bulkDeleting}
                        onChange={() => toggleOne(p.id)}
                      />
                    </td>
                    <td>
                      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[var(--radius)] bg-[var(--bg-subtle)]">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={imageFileUrl(p.id, thumb, p.updatedAt)}
                            alt={p.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <ImageIcon
                            size={18}
                            strokeWidth={1.5}
                            className="text-[var(--text-muted)] opacity-60"
                          />
                        )}
                      </span>
                    </td>
                    <td>
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-xs text-[var(--text-muted)]">
                        {p.id}
                      </span>
                    </td>
                    <td>
                      <ImageStatusBadge status={p.status} />
                      {p.status === "generating" && (
                        <div className="mt-1 max-w-48">
                          <ProgressBar
                            progress={genProgress[p.id]?.progress ?? 0}
                            step={genProgress[p.id]?.step || t("imagesPage.generating")}
                          />
                        </div>
                      )}
                    </td>
                    <td>
                      <AspectChip aspect={p.aspect} />
                    </td>
                    <td className="text-[var(--text-muted)]">
                      {p.model ?? t("styles.default")}
                    </td>
                    <td className="text-[var(--text-muted)]">
                      {formatDateTime(p.createdAt)}
                    </td>
                    <td className="text-[var(--text-muted)]">
                      {formatDateTime(p.updatedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : list ? (
          <EmptyState
            icon={Images}
            description={t("imagesPage.empty")}
            action={
              <Button onClick={onCreate}>
                <Plus size={16} strokeWidth={2} />
                {t("imagesPage.create")}
              </Button>
            }
          />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        )}
      </Card>

      {/* Modal xác nhận xóa nhiều dự án ảnh - bắt gõ DELETE */}
      <ConfirmDeleteModal
        open={bulkDeleteOpen}
        title={t("imagesPage.delete-selected-title")}
        description={
          <p>{tf("imagesPage.delete-desc", { n: selectedProjects.length })}</p>
        }
        items={selectedProjects.map((p) => p.name)}
        busy={bulkDeleting}
        confirmLabel={tf("imagesPage.delete-n", { n: selectedProjects.length })}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={onDeleteSelected}
      />
    </>
  );
}

// ============ Trang ============

export default function ImagesPage() {
  const { t } = useT();
  const router = useRouter();

  // Modal "Tạo ảnh mới" - id sinh tự động từ tên phía server (auto-ID ẩn)
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<ImageDraft>(DEFAULT_IMAGE_DRAFT);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function openCreate() {
    setName("");
    setDraft(DEFAULT_IMAGE_DRAFT);
    setCreateError(null);
    setCreateOpen(true);
  }

  const canCreate = name.trim().length > 0 && draft.prompt.trim().length > 0;

  async function onCreate() {
    if (!canCreate || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const p = await createImageProject({
        name: name.trim(),
        prompt: draft.prompt.trim(),
        kind: draft.kind,
        aspect: draft.aspect,
        overlay: draft.overlay,
        styleId: draft.styleId,
        ...(draft.model ? { model: draft.model } : {}),
      });
      setCreateOpen(false);
      router.push(`/images/${p.id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.images")}
        subtitle={t("imagesPage.subtitle")}
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} strokeWidth={2} />
            {t("imagesPage.create")}
          </Button>
        }
      />

      <p className="text-[13px] text-[var(--text-muted)]">
        {t("imagesPage.style-note")}{" "}
        <Link
          href="/styles"
          className="font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
        >
          Style Design
        </Link>
        .
      </p>

      <ImageProjectList onCreate={openCreate} />

      {/* Modal tạo dự án ảnh mới */}
      <Modal
        title={t("imagesPage.create")}
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={creating}
              onClick={() => setCreateOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={onCreate} disabled={!canCreate || creating}>
              <Plus size={15} strokeWidth={2} />
              {creating ? t("common.creating") : t("imagesPage.create-short")}
            </Button>
          </>
        }
      >
        {createError && <ErrorBanner message={createError} />}
        <div>
          <label className="label" htmlFor="image-name">
            {t("common.name")}
          </label>
          <input
            id="image-name"
            className="input"
            autoFocus
            value={name}
            disabled={creating}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("imagesPage.name-placeholder")}
          />
        </div>
        <ImageProjectFields
          value={draft}
          onChange={(p) => setDraft((d) => ({ ...d, ...p }))}
          disabled={creating}
          idPrefix="image-new"
        />
      </Modal>
    </div>
  );
}
