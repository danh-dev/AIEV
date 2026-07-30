"use client";

import { Image as ImageIcon, Images, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  createImageProject,
  deleteImageProject,
  getImageProjects,
  getJobs,
  imageFileUrl,
  type ImageProject,
} from "@/lib/api";
import { useJobEvents } from "@/lib/useEvents";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
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
import { formatRelative } from "@/lib/format";

// ============ Danh sách dự án ảnh ============

function ImageProjectList({ onCreate }: { onCreate: () => void }) {
  const router = useRouter();
  const [list, setList] = useState<ImageProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tiến trình thật của job image-gen theo projectId — cho ProgressBar mini trên card
  const [genProgress, setGenProgress] = useState<
    Record<string, { progress: number; step: string }>
  >({});

  // Chọn nhiều dự án ảnh để xóa
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);

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

  // Job "image-gen" đổi trạng thái → cập nhật sống danh sách + progress card
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
      // job vừa chạy → đánh dấu card generating ngay, không chờ refetch
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

  function toggleSelect(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onDeleteSelected() {
    if (bulkDeleting || selected.size === 0 || !list) return;
    const targets = list.filter((p) => selected.has(p.id));
    if (
      !window.confirm(
        `Xóa ${targets.length} dự án ảnh đã chọn?\n\n${targets
          .map((p) => `· ${p.name}`)
          .join("\n")}\n\nToàn bộ ảnh của các dự án này sẽ bị xóa vĩnh viễn.`
      )
    )
      return;
    setBulkDeleting(true);
    setBulkErrors([]);
    // Xóa TUẦN TỰ — lỗi nào gom lại hiện sau
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
    setSelected(new Set());
    setBulkErrors(errors);
    await load();
  }

  return (
    <>
      {error && (
        <ErrorBanner message="Không tải được danh sách dự án ảnh." detail={error} />
      )}
      {bulkErrors.length > 0 && (
        <ErrorBanner
          message={`Không xóa được ${bulkErrors.length} dự án ảnh.`}
          detail={bulkErrors.join("\n")}
        />
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] bg-[var(--bg-subtle)] px-3 py-2">
          <span className="text-sm font-medium">
            Đã chọn {selected.size} dự án ảnh
          </span>
          <span className="flex-1" />
          <Button
            variant="secondary"
            small
            disabled={bulkDeleting}
            onClick={() => setSelected(new Set())}
          >
            Bỏ chọn
          </Button>
          <Button
            variant="destructive"
            small
            disabled={bulkDeleting}
            onClick={onDeleteSelected}
          >
            <Trash2 size={14} strokeWidth={2} />
            {bulkDeleting ? "Đang xóa…" : "Xóa đã chọn"}
          </Button>
        </div>
      )}

      {list && list.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4">
          {list.map((p) => {
            const thumb = p.final ?? p.background;
            return (
              <div
                key={p.id}
                role="link"
                tabIndex={0}
                onClick={() => router.push(`/images/${p.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") router.push(`/images/${p.id}`);
                }}
                className="card relative cursor-pointer overflow-hidden p-0 text-left transition-colors duration-150 hover:border-[var(--primary)]"
              >
                <span
                  className="absolute left-2 top-2 z-10 flex items-center justify-center rounded-[var(--radius)] bg-[var(--surface)] p-1 shadow-[var(--shadow-card)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    className="checkbox block"
                    aria-label={`Chọn ${p.name}`}
                    checked={selected.has(p.id)}
                    disabled={bulkDeleting}
                    onChange={() => toggleSelect(p.id)}
                  />
                </span>
                <div className="flex h-40 items-center justify-center overflow-hidden bg-[var(--bg-subtle)]">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageFileUrl(p.id, thumb, p.updatedAt)}
                      alt={p.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon
                      size={28}
                      strokeWidth={1.5}
                      className="text-[var(--text-muted)] opacity-40"
                    />
                  )}
                </div>
                <div className="flex flex-col gap-2 p-3">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ImageStatusBadge status={p.status} />
                    <AspectChip aspect={p.aspect} />
                    <span className="ml-auto text-xs text-[var(--text-muted)]">
                      {formatRelative(p.updatedAt)}
                    </span>
                  </div>
                  {p.status === "generating" && (
                    <ProgressBar
                      progress={genProgress[p.id]?.progress ?? 0}
                      step={genProgress[p.id]?.step || "Đang tạo"}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : list ? (
        <Card>
          <EmptyState
            icon={Images}
            description="Chưa có dự án ảnh nào. Tạo ảnh đầu tiên — Gemini vẽ nền, Remotion đặt chữ theo Style Design."
            action={
              <Button onClick={onCreate}>
                <Plus size={16} strokeWidth={2} />
                Tạo ảnh mới
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            Đang tải…
          </p>
        </Card>
      )}
    </>
  );
}

// ============ Trang ============

export default function ImagesPage() {
  const router = useRouter();

  // Modal "Tạo ảnh mới" — id sinh tự động từ tên phía server (auto-ID ẩn)
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
        title="Images Project"
        subtitle="Gemini vẽ ảnh nền · Remotion đặt chữ đồng bộ Style Design"
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} strokeWidth={2} />
            Tạo ảnh mới
          </Button>
        }
      />

      <p className="text-[13px] text-[var(--text-muted)]">
        Ảnh tạo ra tuân theo Style Design đã chọn — quản lý tại tab{" "}
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
        title="Tạo ảnh mới"
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
              Hủy
            </Button>
            <Button onClick={onCreate} disabled={!canCreate || creating}>
              <Plus size={15} strokeWidth={2} />
              {creating ? "Đang tạo…" : "Tạo ảnh"}
            </Button>
          </>
        }
      >
        {createError && <ErrorBanner message={createError} />}
        <div>
          <label className="label" htmlFor="image-name">
            Tên
          </label>
          <input
            id="image-name"
            className="input"
            autoFocus
            value={name}
            disabled={creating}
            onChange={(e) => setName(e.target.value)}
            placeholder="vd: Background chiến dịch automation"
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
