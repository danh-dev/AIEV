"use client";

import {
  CheckCircle2,
  Clapperboard,
  Copy,
  FileText,
  Pencil,
  Play,
  Plus,
  Ruler,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cleanProjectJunk,
  createJob,
  createProject,
  deleteProject,
  getProjectJunk,
  getProjects,
  renameProject,
  startProjectEdit,
  type ProjectSummary,
} from "@/lib/api";
import { Card } from "@/components/Card";
import { ProjectBadge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { CloneProjectModal } from "@/components/CloneProjectModal";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { TagInput } from "@/components/TagInput";
import {
  formatBytes,
  formatDateTime,
  formatTokens,
  formatUsd,
  KEBAB_RE,
  slugify,
} from "@/lib/format";
import { useT } from "@/lib/i18n";

// label là KEY dictionary - dịch bằng t() lúc render.
const PRESETS = [
  { label: "projects.preset.tiktok", width: 1080, height: 1920, note: "9:16" },
  { label: "projects.preset.youtube", width: 1920, height: 1080, note: "16:9" },
  { label: "projects.preset.square", width: 1080, height: 1080, note: "1:1" },
  { label: "projects.preset.portrait45", width: 1080, height: 1350, note: "Instagram feed" },
  { label: "projects.preset.landscape4k", width: 3840, height: 2160, note: "16:9" },
  { label: "projects.preset.portrait4k", width: 2160, height: 3840, note: "9:16" },
] as const;

const FPS_OPTIONS = [24, 25, 30, 60] as const;

/** Icon thuần CSS mô phỏng tỉ lệ khung hình của preset. */
function AspectIcon({ width, height }: { width: number; height: number }) {
  const style =
    width >= height
      ? { width: 22, aspectRatio: `${width} / ${height}` }
      : { height: 22, aspectRatio: `${width} / ${height}` };
  return (
    <span className="flex h-6 w-6 items-center justify-center" aria-hidden>
      <span
        className="block rounded-[3px] border-[1.5px] border-current"
        style={style}
      />
    </span>
  );
}

/** Chip bấm được - dùng cho hàng lọc tag và tag dưới tên project. */
function FilterChip({
  active,
  onClick,
  children,
  small,
}: {
  active: boolean;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border transition-colors duration-150 ${
        small ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      } ${
        active
          ? "border-[var(--primary)] bg-[var(--primary-soft)] font-medium text-[var(--primary)]"
          : "border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}

export default function ProjectsPage() {
  const { t, tf } = useT();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lọc theo tag (multi-select, OR)
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  // Chọn nhiều project để xóa
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<string[]>([]);

  // Tạo video hàng loạt (bulk edit AI) cho các project đã chọn
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  // Bulk "Xóa file rác" + "Render final" trên các project đã chọn
  const [junkBusy, setJunkBusy] = useState(false);
  const [renderBusy, setRenderBusy] = useState(false);
  const [bulkActionNotice, setBulkActionNotice] = useState<string | null>(null);
  const [bulkActionErrors, setBulkActionErrors] = useState<string[]>([]);

  // Nhân bản project - project gốc đang chọn + notice sau khi clone xong
  const [cloneSource, setCloneSource] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [cloneNotice, setCloneNotice] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Đổi tên project - project đang sửa (null = modal đóng) + tên đang gõ.
  // Chỉ đổi TÊN HIỂN THỊ, id (tên thư mục) giữ nguyên.
  const [renameTarget, setRenameTarget] = useState<ProjectSummary | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Modal tạo project
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  // User đã tự sửa ID → ngừng auto-sync từ tên
  const [idDirty, setIdDirty] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1920);
  const [fps, setFps] = useState(30);
  // User chọn "Tùy chỉnh" kích thước / "Khác" cho FPS
  const [customSize, setCustomSize] = useState(false);
  const [customFps, setCustomFps] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await getProjects());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Mọi tag đang tồn tại + số project mỗi tag
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects ?? []) {
      for (const t of p.tags ?? []) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "vi"));
  }, [projects]);

  const filtered = useMemo(() => {
    if (!projects) return null;
    if (tagFilter.length === 0) return projects;
    return projects.filter((p) =>
      (p.tags ?? []).some((t) => tagFilter.includes(t))
    );
  }, [projects, tagFilter]);

  function toggleTag(tag: string) {
    setTagFilter((cur) =>
      cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]
    );
  }

  // ---- Chọn / bỏ chọn ----

  const allSelected =
    !!filtered && filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const someSelected =
    !!filtered && !allSelected && filtered.some((p) => selected.has(p.id));

  function toggleOne(projectId: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function toggleAll() {
    if (!filtered) return;
    setSelected((cur) => {
      const next = new Set(cur);
      if (allSelected) {
        for (const p of filtered) next.delete(p.id);
      } else {
        for (const p of filtered) next.add(p.id);
      }
      return next;
    });
  }

  const selectedProjects = useMemo(
    () => (projects ?? []).filter((p) => selected.has(p.id)),
    [projects, selected]
  );

  function openDelete() {
    setDeleteErrors([]);
    setDeleteProgress(null);
    setDeleteOpen(true);
  }

  async function onDeleteSelected() {
    if (deleting || selectedProjects.length === 0) return;
    setDeleting(true);
    setDeleteErrors([]);
    const targets = selectedProjects;
    const errors: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      setDeleteProgress({ done: i + 1, total: targets.length });
      try {
        await deleteProject(targets[i].id);
      } catch (e) {
        errors.push(
          `${targets[i].name} (${targets[i].id}): ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }
    setDeleting(false);
    setDeleteProgress(null);
    setSelected(new Set());
    await load();
    if (errors.length > 0) {
      setDeleteErrors(errors);
    } else {
      setDeleteOpen(false);
    }
  }

  // ---- Tạo video hàng loạt bằng AI ----

  function openBulkEdit() {
    setBulkErrors([]);
    setBulkProgress(null);
    setBulkNotice(null);
    setBulkNotes("");
    setBulkOpen(true);
  }

  async function onBulkEdit() {
    if (bulkRunning || selectedProjects.length === 0) return;
    setBulkRunning(true);
    setBulkErrors([]);
    const targets = selectedProjects;
    const errors: string[] = [];
    // Vòng lặp này chỉ tuần tự hóa các HTTP CALL: POST /:id/edit trả 202 ngay
    // (fire-and-forget), nên chọn N project là N phiên AI chạy ĐỒNG THỜI phía
    // server. Muốn giới hạn số phiên chạy song song thì phải làm ở backend
    // (hàng đợi phiên) - client không biết lúc nào một phiên kết thúc để nối tiếp.
    for (let i = 0; i < targets.length; i++) {
      setBulkProgress({ done: i + 1, total: targets.length });
      try {
        await startProjectEdit(targets[i].id, bulkNotes);
      } catch (e) {
        errors.push(
          `${targets[i].name} (${targets[i].id}): ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }
    setBulkRunning(false);
    setBulkProgress(null);
    const started = targets.length - errors.length;
    if (started > 0) {
      setBulkNotice(tf("projects.bulk-started", { n: started }));
      setSelected(new Set());
    }
    if (errors.length > 0) {
      // Giữ modal mở để đọc lỗi - các project khác vẫn đã chạy
      setBulkErrors(errors);
    } else {
      setBulkOpen(false);
    }
  }

  // ---- Xóa file rác hàng loạt ----

  async function onBulkCleanJunk() {
    if (junkBusy || renderBusy || selectedProjects.length === 0) return;
    setJunkBusy(true);
    setBulkActionNotice(null);
    setBulkActionErrors([]);
    const targets = selectedProjects;
    const errors: string[] = [];
    try {
      // Quét file rác từng project để confirm MỘT lần với tổng dung lượng
      const junks: {
        id: string;
        name: string;
        items: number;
        bytes: number;
      }[] = [];
      for (const p of targets) {
        try {
          const junk = await getProjectJunk(p.id);
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
          tf("projects.junk-confirm", {
            items: totalItems,
            projects: junks.length,
            size: formatBytes(totalBytes),
          })
        )
      )
        return;
      // Xóa tuần tự - project đang có job server trả 409, gom lỗi và đi tiếp
      let freed = 0;
      let deleted = 0;
      let cleaned = 0;
      for (const j of junks) {
        try {
          const result = await cleanProjectJunk(j.id);
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
          tf("projects.junk-freed", {
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

  // ---- Render final hàng loạt ----

  async function onBulkRenderFinal() {
    if (junkBusy || renderBusy || selectedProjects.length === 0) return;
    setRenderBusy(true);
    setBulkActionNotice(null);
    setBulkActionErrors([]);
    const targets = selectedProjects;
    const errors: string[] = [];
    let created = 0;
    // Submit đúng job như nút "Render final" đơn lẻ - queue tự điều phối,
    // project chưa đủ điều kiện (chưa có draft…) server tự trả lỗi
    for (const p of targets) {
      try {
        await createJob({ projectId: p.id, type: "assemble-final" });
        created++;
      } catch (e) {
        errors.push(
          `${p.name} (${p.id}): ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
    setRenderBusy(false);
    if (created > 0) {
      setBulkActionNotice(tf("projects.render-queued", { n: created }));
    }
    if (errors.length > 0) setBulkActionErrors(errors);
    await load();
  }

  // ---- Đổi tên project ----

  function openRename(p: ProjectSummary) {
    setRenameError(null);
    setRenameName(p.name);
    setRenameTarget(p);
  }

  async function onRename() {
    if (!renameTarget || renaming) return;
    const next = renameName.trim();
    // Xóa trắng tên rồi lưu: báo lỗi rõ ràng thay vì lặng lẽ giữ tên cũ
    if (!next) {
      setRenameError(t("projects.name-required"));
      return;
    }
    if (next === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      await renameProject(renameTarget.id, next);
      setRenameTarget(null);
      await load();
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : String(e));
    } finally {
      setRenaming(false);
    }
  }

  // ---- Tạo project ----

  function openCreate() {
    setName("");
    setId("");
    setIdDirty(false);
    setTags([]);
    setWidth(1080);
    setHeight(1920);
    setFps(30);
    setCustomSize(false);
    setCustomFps(false);
    setCreateError(null);
    setOpen(true);
  }

  const idValid = id === "" || KEBAB_RE.test(id);
  const canCreate =
    idValid && name.trim().length > 0 && width > 0 && height > 0 && fps > 0;

  // Preset đang khớp kích thước hiện tại (nếu không ở chế độ tùy chỉnh)
  const matchedPreset =
    !customSize &&
    PRESETS.find((p) => p.width === width && p.height === height);
  const customActive = customSize || !matchedPreset;

  async function onCreate() {
    if (!canCreate || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const p = await createProject({
        id: id || undefined,
        name: name.trim(),
        width,
        height,
        fps,
        tags: tags.length > 0 ? tags : undefined,
      });
      setOpen(false);
      router.push(`/projects/${p.id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            {t("nav.projects")}
            <InfoHint
              titleKey="help.projects.title"
              bodyKey="help.projects.body"
              size={14}
            />
          </span>
        }
        subtitle={t("projects.subtitle")}
        actions={
          <>
            <Button onClick={openCreate}>
              <Plus size={16} strokeWidth={2} />
              {t("projects.create")}
            </Button>
          </>
        }
      />

      {error && (
        <ErrorBanner message={t("projects.load-error")} detail={error} />
      )}

      {bulkNotice && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success)]">
          <Sparkles size={15} strokeWidth={2} className="shrink-0" />
          {bulkNotice}
        </div>
      )}

      {bulkActionNotice && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success)]">
          <CheckCircle2 size={15} strokeWidth={2} className="shrink-0" />
          {bulkActionNotice}
        </div>
      )}

      {bulkActionErrors.length > 0 && (
        <ErrorBanner
          message={tf("projects.bulk-action-errors", { n: bulkActionErrors.length })}
          detail={bulkActionErrors.join("\n")}
        />
      )}

      {cloneNotice && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success)]">
          <Copy size={15} strokeWidth={2} className="shrink-0" />
          <span>
            {t("projects.cloned-to")}{" "}
            <span className="font-medium">{cloneNotice.name}</span> -{" "}
            <Link
              href={`/projects/${cloneNotice.id}`}
              className="font-medium underline underline-offset-2"
            >
              {t("projects.open-new")}
            </Link>
          </span>
        </div>
      )}

      <Card>
        {selected.size > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius)] bg-[var(--bg-subtle)] px-3 py-2">
            <span className="text-sm font-medium">
              {tf("projects.selected", { n: selected.size })}
            </span>
            <span className="flex-1" />
            <Button
              variant="secondary"
              small
              disabled={junkBusy || renderBusy}
              onClick={() => setSelected(new Set())}
            >
              {t("common.deselect")}
            </Button>
            {/* Nút (i) đặt CẠNH nút thao tác (không lồng trong <button>) */}
            <span className="inline-flex items-center gap-1">
              <Button
                variant="secondary"
                small
                disabled={junkBusy || renderBusy}
                onClick={onBulkCleanJunk}
              >
                <Trash2 size={14} strokeWidth={2} />
                {junkBusy ? t("junk.cleaning") : t("junk.clean")}
              </Button>
              <InfoHint
                titleKey="help.projects-junk.title"
                bodyKey="help.projects-junk.body"
              />
            </span>
            <Button
              variant="destructive"
              small
              disabled={junkBusy || renderBusy}
              onClick={openDelete}
            >
              <Trash2 size={14} strokeWidth={2} />
              {t("common.delete-selected")}
            </Button>
            <span className="inline-flex items-center gap-1">
              <Button
                small
                disabled={junkBusy || renderBusy}
                onClick={onBulkRenderFinal}
              >
                <Play size={14} strokeWidth={2} />
                {renderBusy
                  ? t("projects.creating-jobs")
                  : tf("projects.render-final-n", { n: selected.size })}
              </Button>
              <InfoHint
                titleKey="help.projects-render.title"
                bodyKey="help.projects-render.body"
              />
            </span>
            <span className="inline-flex items-center gap-1">
              <Button
                small
                disabled={junkBusy || renderBusy}
                onClick={openBulkEdit}
              >
                <Sparkles size={14} strokeWidth={2} />
                {tf("projects.make-video-n", { n: selected.size })}
              </Button>
              <InfoHint
                titleKey="help.projects-bulk-edit.title"
                bodyKey="help.projects-bulk-edit.body"
              />
            </span>
          </div>
        ) : (
          tagCounts.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <Tag
                size={14}
                strokeWidth={2}
                className="text-[var(--text-muted)]"
                aria-label={t("projects.filter-by-tag")}
              />
              <FilterChip
                active={tagFilter.length === 0}
                onClick={() => setTagFilter([])}
              >
                {t("common.all")}
              </FilterChip>
              {tagCounts.map(([tag, count]) => (
                <FilterChip
                  key={tag}
                  active={tagFilter.includes(tag)}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                  <span className="opacity-70">{count}</span>
                </FilterChip>
              ))}
            </div>
          )
        )}

        {filtered && filtered.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    className="checkbox align-middle"
                    aria-label={t("projects.select-all")}
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                  />
                </th>
                <th>{t("common.name")}</th>
                <th>{t("common.size")}</th>
                <th>{t("common.status")}</th>
                <th>{t("projects.col-tokens")}</th>
                <th>{t("common.created")}</th>
                <th>{t("common.updated")}</th>
                <th className="w-20">
                  <span className="sr-only">{t("project.actions-aria")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className="row-click"
                  onClick={() => router.push(`/projects/${p.id}`)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="checkbox align-middle"
                      aria-label={tf("common.select-aria", { name: p.name })}
                      checked={selected.has(p.id)}
                      onChange={() => toggleOne(p.id)}
                    />
                  </td>
                  <td>
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-2 text-xs text-[var(--text-muted)]">
                      {p.id}
                    </span>
                    {/* Nguồn gốc: project do Text to video sinh ra thì nói rõ và
                        cho bấm thẳng về phiên đó - không thì nhìn danh sách chỉ
                        thấy một project lạ mọc ra, không hiểu ở đâu ra */}
                    {p.textToVideoId && (
                      <Link
                        href={`/text-to-video/${p.textToVideoId}`}
                        title={tf("project.from-ttv-title", { id: p.textToVideoId })}
                        onClick={(e) => e.stopPropagation()}
                        className="ml-2 inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-0.5 align-middle text-[11px] font-medium text-[var(--text-muted)] transition-colors duration-150 hover:border-[var(--primary)] hover:text-[var(--primary)]"
                      >
                        <FileText size={11} strokeWidth={2} aria-hidden="true" />
                        {t("project.from-ttv")}
                      </Link>
                    )}
                    {(p.tags ?? []).length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {p.tags.map((t) => (
                          <FilterChip
                            key={t}
                            small
                            active={tagFilter.includes(t)}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTag(t);
                            }}
                          >
                            {t}
                          </FilterChip>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="text-[var(--text-muted)]">
                    {p.width}×{p.height} · {p.fps}fps
                  </td>
                  <td>
                    <ProjectBadge status={p.status} />
                  </td>
                  <td
                    className="text-[var(--text-muted)]"
                    title={
                      (p.tokensUsed ?? 0) > 0
                        ? `${p.tokensUsed.toLocaleString("vi-VN")} token${
                            (p.costUsd ?? 0) > 0
                              ? ` · ${formatUsd(p.costUsd)}`
                              : ""
                          }`
                        : undefined
                    }
                  >
                    {(p.tokensUsed ?? 0) > 0 ? formatTokens(p.tokensUsed) : "-"}
                  </td>
                  <td className="text-[var(--text-muted)]">
                    {formatDateTime(p.createdAt)}
                  </td>
                  <td className="text-[var(--text-muted)]">
                    {formatDateTime(p.updatedAt)}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <span className="flex items-center gap-0.5">
                      <button
                        type="button"
                        title={t("projects.rename")}
                        aria-label={tf("projects.rename-aria", { name: p.name })}
                        onClick={() => openRename(p)}
                        className="rounded-[var(--radius)] p-1.5 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
                      >
                        <Pencil size={15} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        title={t("clone.title")}
                        aria-label={tf("projects.clone-aria", { name: p.name })}
                        onClick={() =>
                          setCloneSource({ id: p.id, name: p.name })
                        }
                        className="rounded-[var(--radius)] p-1.5 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
                      >
                        <Copy size={15} strokeWidth={2} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : projects && projects.length > 0 ? (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("projects.no-tag-match")}
          </p>
        ) : projects ? (
          <EmptyState
            icon={Clapperboard}
            description={t("projects.empty")}
            action={
              <Button onClick={openCreate}>
                <Plus size={16} strokeWidth={2} />
                {t("projects.create")}
              </Button>
            }
          />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        )}
      </Card>

      {/* Modal nhân bản project */}
      <CloneProjectModal
        source={cloneSource}
        onClose={() => setCloneSource(null)}
        onCloned={async (p) => {
          setCloneSource(null);
          setCloneNotice({ id: p.id, name: p.name });
          await load();
        }}
      />

      {/* Modal đổi tên project - chỉ đổi tên hiển thị, id giữ nguyên */}
      <Modal
        title={t("projects.rename-title")}
        open={renameTarget !== null}
        onClose={() => {
          if (!renaming) setRenameTarget(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={renaming}
              onClick={() => setRenameTarget(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button disabled={renaming} onClick={onRename}>
              {renaming ? t("common.saving") : t("common.save")}
            </Button>
          </>
        }
      >
        {renameError && <ErrorBanner message={renameError} />}
        <div>
          <label className="label" htmlFor="rename-project-name">
            {t("common.name")}
          </label>
          <input
            id="rename-project-name"
            className="input"
            autoFocus
            value={renameName}
            disabled={renaming}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onRename();
              }
            }}
            placeholder={t("projects.name-placeholder")}
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {tf("projects.rename-hint", { id: renameTarget?.id ?? "" })}
          </p>
        </div>
      </Modal>

      {/* Modal xác nhận xóa nhiều project - bắt gõ DELETE */}
      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("projects.delete-selected-title")}
        description={
          selectedProjects.length > 0 ? (
            <p>
              {t("projects.delete-desc-1")}{" "}
              <code className="rounded bg-[var(--bg-subtle)] px-1 text-xs">
                video-projects/&lt;id&gt;
              </code>{" "}
              {t("projects.delete-desc-2")}
            </p>
          ) : (
            <p className="text-[var(--text-muted)]">
              {t("projects.none-selected")}
            </p>
          )
        }
        items={selectedProjects.map(
          (p) => `${p.name} - video-projects/${p.id}`
        )}
        busy={deleting}
        busyLabel={
          deleteProgress
            ? tf("projects.deleting-progress", {
                done: deleteProgress.done,
                total: deleteProgress.total,
              })
            : t("common.deleting")
        }
        confirmLabel={tf("projects.delete-n", { n: selectedProjects.length })}
        error={
          deleteErrors.length > 0
            ? `${tf("projects.delete-errors", { n: deleteErrors.length })}\n${deleteErrors.join("\n")}`
            : null
        }
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDeleteSelected}
      />

      {/* Modal tạo video hàng loạt bằng AI */}
      <Modal
        title={t("projects.bulk-title")}
        open={bulkOpen}
        onClose={() => {
          if (!bulkRunning) setBulkOpen(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={bulkRunning}
              onClick={() => setBulkOpen(false)}
            >
              {bulkErrors.length > 0 ? t("common.close") : t("common.cancel")}
            </Button>
            <Button
              disabled={bulkRunning || selectedProjects.length === 0}
              onClick={onBulkEdit}
            >
              <Sparkles size={15} strokeWidth={2} />
              {bulkRunning && bulkProgress
                ? tf("projects.bulk-starting", {
                    done: bulkProgress.done,
                    total: bulkProgress.total,
                  })
                : tf("projects.bulk-start", { n: selectedProjects.length })}
            </Button>
          </>
        }
      >
        {bulkErrors.length > 0 && (
          <ErrorBanner
            message={tf("projects.bulk-errors", { n: bulkErrors.length })}
            detail={bulkErrors.join("\n")}
          />
        )}
        {selectedProjects.length > 0 ? (
          <>
            <p className="text-sm">{t("projects.bulk-desc")}</p>
            <ul className="flex flex-col gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
              {selectedProjects.map((p) => (
                <li key={p.id} className="text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-[var(--text-muted)]">
                    {p.id}
                  </span>
                </li>
              ))}
            </ul>
            <div>
              <label className="label" htmlFor="bulk-extra-notes">
                {t("projects.bulk-notes")}
              </label>
              <textarea
                id="bulk-extra-notes"
                className="input"
                rows={2}
                value={bulkNotes}
                disabled={bulkRunning}
                onChange={(e) => setBulkNotes(e.target.value)}
                placeholder={t("projects.notes-placeholder")}
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            {t("projects.none-selected")}
          </p>
        )}
      </Modal>

      {/* Modal tạo project */}
      <Modal
        title={t("projects.create-title")}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={onCreate} disabled={!canCreate || creating}>
              {creating ? t("common.creating") : t("projects.create")}
            </Button>
          </>
        }
      >
        {createError && <ErrorBanner message={createError} />}
        <div>
          <label className="label" htmlFor="project-name">
            {t("common.name")}
          </label>
          <input
            id="project-name"
            className="input"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!idDirty) setId(slugify(e.target.value));
            }}
            placeholder={t("projects.name-placeholder")}
          />
        </div>
        <div>
          <label className="label" htmlFor="project-id">
            {t("projects.id-label")}
          </label>
          <input
            id="project-id"
            className="input h-8 text-xs text-[var(--text-muted)]"
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              // Xóa trắng ID → bật lại auto-sync theo tên
              setIdDirty(e.target.value !== "");
            }}
            placeholder={t("projects.id-placeholder")}
          />
          {idValid ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {t("projects.id-hint")}
            </p>
          ) : (
            <p className="mt-1 text-xs text-[var(--danger)]">
              {t("projects.id-invalid")}
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="project-tags">
            {t("common.tags")}
          </label>
          <TagInput id="project-tags" tags={tags} onChange={setTags} />
        </div>
        <div>
          <span className="label">{t("projects.format")}</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PRESETS.map((preset) => {
              const active =
                !customActive &&
                width === preset.width &&
                height === preset.height;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setCustomSize(false);
                    setWidth(preset.width);
                    setHeight(preset.height);
                  }}
                  className={`flex flex-col items-center gap-1 rounded-[var(--radius)] border p-3 text-center transition-colors duration-150 ${
                    active
                      ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                      : "border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-subtle)]"
                  }`}
                >
                  <AspectIcon width={preset.width} height={preset.height} />
                  <span className="text-[13px] leading-tight font-medium">
                    {t(preset.label)}
                  </span>
                  <span
                    className={`text-[11px] ${
                      active ? "opacity-80" : "text-[var(--text-muted)]"
                    }`}
                  >
                    {preset.width}×{preset.height} · {preset.note}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCustomSize(true)}
              className={`flex flex-col items-center gap-1 rounded-[var(--radius)] border p-3 text-center transition-colors duration-150 ${
                customActive
                  ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                  : "border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-subtle)]"
              }`}
            >
              <span className="flex h-6 w-6 items-center justify-center">
                <Ruler size={18} strokeWidth={1.5} />
              </span>
              <span className="text-[13px] leading-tight font-medium">
                {t("projects.custom")}
              </span>
              <span
                className={`text-[11px] ${
                  customActive ? "opacity-80" : "text-[var(--text-muted)]"
                }`}
              >
                {customActive ? `${width}×${height}` : t("projects.custom-hint")}
              </span>
            </button>
          </div>
          {customActive && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="project-width">
                  {t("projects.width")}
                </label>
                <input
                  id="project-width"
                  className="input"
                  type="number"
                  min={1}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="label" htmlFor="project-height">
                  {t("projects.height")}
                </label>
                <input
                  id="project-height"
                  className="input"
                  type="number"
                  min={1}
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                />
              </div>
            </div>
          )}
        </div>
        <div>
          <span className="label">FPS</span>
          <div className="flex flex-wrap items-center gap-2">
            {FPS_OPTIONS.map((option) => {
              const active = !customFps && fps === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setCustomFps(false);
                    setFps(option);
                  }}
                  className={`h-8 rounded-[var(--radius)] border px-3 text-[13px] font-medium transition-colors duration-150 ${
                    active
                      ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                      : "border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-subtle)]"
                  }`}
                >
                  {option}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCustomFps(true)}
              className={`h-8 rounded-[var(--radius)] border px-3 text-[13px] font-medium transition-colors duration-150 ${
                customFps
                  ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                  : "border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-subtle)]"
              }`}
            >
              {t("projects.other")}
            </button>
            {customFps && (
              <input
                aria-label={t("projects.custom-fps")}
                className="input h-8 w-24"
                type="number"
                min={1}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
              />
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
