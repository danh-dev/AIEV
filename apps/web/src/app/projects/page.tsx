"use client";

import { Clapperboard, Copy, Plus, Ruler, Sparkles, Tag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createProject,
  deleteProject,
  getProjects,
  startProjectEdit,
  type ProjectSummary,
} from "@/lib/api";
import { Card } from "@/components/Card";
import { ProjectBadge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { CloneProjectModal } from "@/components/CloneProjectModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { TagInput } from "@/components/TagInput";
import {
  formatDateTime,
  formatTokens,
  formatUsd,
  KEBAB_RE,
  slugify,
} from "@/lib/format";

const PRESETS = [
  { label: "TikTok/Reels dọc", width: 1080, height: 1920, note: "9:16" },
  { label: "YouTube ngang", width: 1920, height: 1080, note: "16:9" },
  { label: "Vuông", width: 1080, height: 1080, note: "1:1" },
  { label: "Dọc 4:5", width: 1080, height: 1350, note: "Instagram feed" },
  { label: "Ngang 4K", width: 3840, height: 2160, note: "16:9" },
  { label: "Dọc 4K", width: 2160, height: 3840, note: "9:16" },
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

/** Chip bấm được — dùng cho hàng lọc tag và tag dưới tên project. */
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

  // Nhân bản project — project gốc đang chọn + notice sau khi clone xong
  const [cloneSource, setCloneSource] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [cloneNotice, setCloneNotice] = useState<{
    id: string;
    name: string;
  } | null>(null);

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
    // Chạy TUẦN TỰ — server khởi động từng phiên AI, không dội đồng thời
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
      setBulkNotice(
        `Đã bắt đầu edit ${started} project — mở từng project để theo dõi.`
      );
      setSelected(new Set());
    }
    if (errors.length > 0) {
      // Giữ modal mở để đọc lỗi — các project khác vẫn đã chạy
      setBulkErrors(errors);
    } else {
      setBulkOpen(false);
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
        title="Videos Project"
        subtitle="Mỗi project là một video trong video-projects/"
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} strokeWidth={2} />
            Tạo project
          </Button>
        }
      />

      {error && (
        <ErrorBanner message="Không tải được danh sách project." detail={error} />
      )}

      {bulkNotice && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success)]">
          <Sparkles size={15} strokeWidth={2} className="shrink-0" />
          {bulkNotice}
        </div>
      )}

      {cloneNotice && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success)]">
          <Copy size={15} strokeWidth={2} className="shrink-0" />
          <span>
            Đã nhân bản thành{" "}
            <span className="font-medium">{cloneNotice.name}</span> —{" "}
            <Link
              href={`/projects/${cloneNotice.id}`}
              className="font-medium underline underline-offset-2"
            >
              mở project mới
            </Link>
          </span>
        </div>
      )}

      <Card>
        {selected.size > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius)] bg-[var(--bg-subtle)] px-3 py-2">
            <span className="text-sm font-medium">
              Đã chọn {selected.size} project
            </span>
            <span className="flex-1" />
            <Button
              variant="secondary"
              small
              onClick={() => setSelected(new Set())}
            >
              Bỏ chọn
            </Button>
            <Button variant="destructive" small onClick={openDelete}>
              <Trash2 size={14} strokeWidth={2} />
              Xóa đã chọn
            </Button>
            <Button small onClick={openBulkEdit}>
              <Sparkles size={14} strokeWidth={2} />
              Tạo video ({selected.size})
            </Button>
          </div>
        ) : (
          tagCounts.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <Tag
                size={14}
                strokeWidth={2}
                className="text-[var(--text-muted)]"
                aria-label="Lọc theo tag"
              />
              <FilterChip
                active={tagFilter.length === 0}
                onClick={() => setTagFilter([])}
              >
                Tất cả
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
                    aria-label="Chọn tất cả project"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                  />
                </th>
                <th>Tên</th>
                <th>Kích thước</th>
                <th>Trạng thái</th>
                <th>Token AI</th>
                <th>Tạo lúc</th>
                <th>Sửa cuối</th>
                <th className="w-10">
                  <span className="sr-only">Nhân bản</span>
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
                      aria-label={`Chọn ${p.name}`}
                      checked={selected.has(p.id)}
                      onChange={() => toggleOne(p.id)}
                    />
                  </td>
                  <td>
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-2 text-xs text-[var(--text-muted)]">
                      {p.id}
                    </span>
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
                    {(p.tokensUsed ?? 0) > 0 ? formatTokens(p.tokensUsed) : "—"}
                  </td>
                  <td className="text-[var(--text-muted)]">
                    {formatDateTime(p.createdAt)}
                  </td>
                  <td className="text-[var(--text-muted)]">
                    {formatDateTime(p.updatedAt)}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      title="Nhân bản project"
                      aria-label={`Nhân bản ${p.name}`}
                      onClick={() =>
                        setCloneSource({ id: p.id, name: p.name })
                      }
                      className="rounded-[var(--radius)] p-1.5 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
                    >
                      <Copy size={15} strokeWidth={2} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : projects && projects.length > 0 ? (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            Không có project nào khớp tag đang lọc.
          </p>
        ) : projects ? (
          <EmptyState
            icon={Clapperboard}
            description="Chưa có project nào. Tạo project đầu tiên để bắt đầu dựng video."
            action={
              <Button onClick={openCreate}>
                <Plus size={16} strokeWidth={2} />
                Tạo project
              </Button>
            }
          />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            Đang tải…
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

      {/* Modal xác nhận xóa nhiều project */}
      <Modal
        title="Xóa project đã chọn"
        open={deleteOpen}
        onClose={() => {
          if (!deleting) setDeleteOpen(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
            >
              Hủy
            </Button>
            <Button
              variant="destructive"
              disabled={deleting || selectedProjects.length === 0}
              onClick={onDeleteSelected}
            >
              <Trash2 size={14} strokeWidth={2} />
              {deleting && deleteProgress
                ? `Đang xóa ${deleteProgress.done}/${deleteProgress.total}…`
                : `Xóa ${selectedProjects.length} project`}
            </Button>
          </>
        }
      >
        {deleteErrors.length > 0 && (
          <ErrorBanner
            message={`Không xóa được ${deleteErrors.length} project.`}
            detail={deleteErrors.join("\n")}
          />
        )}
        {selectedProjects.length > 0 ? (
          <>
            <p className="text-sm">
              Các project sau sẽ bị xóa. Toàn bộ folder{" "}
              <code className="rounded bg-[var(--bg-subtle)] px-1 text-xs">
                video-projects/&lt;id&gt;
              </code>{" "}
              sẽ bị xóa vĩnh viễn, không khôi phục được.
            </p>
            <ul className="flex flex-col gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
              {selectedProjects.map((p) => (
                <li key={p.id} className="text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-[var(--text-muted)]">
                    video-projects/{p.id}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            Không còn project nào được chọn.
          </p>
        )}
      </Modal>

      {/* Modal tạo video hàng loạt bằng AI */}
      <Modal
        title="Tạo video bằng AI"
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
              {bulkErrors.length > 0 ? "Đóng" : "Hủy"}
            </Button>
            <Button
              disabled={bulkRunning || selectedProjects.length === 0}
              onClick={onBulkEdit}
            >
              <Sparkles size={15} strokeWidth={2} />
              {bulkRunning && bulkProgress
                ? `Đang bắt đầu ${bulkProgress.done}/${bulkProgress.total}…`
                : `Bắt đầu edit ${selectedProjects.length} project`}
            </Button>
          </>
        }
      >
        {bulkErrors.length > 0 && (
          <ErrorBanner
            message={`Không bắt đầu được ${bulkErrors.length} project.`}
            detail={bulkErrors.join("\n")}
          />
        )}
        {selectedProjects.length > 0 ? (
          <>
            <p className="text-sm">
              AI sẽ tạo các video SONG SONG với nhau theo brief đã lưu của từng
              project (render nặng chạy tối đa 2 việc cùng lúc). Các project:
            </p>
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
                Dặn dò thêm (áp dụng cho tất cả)
              </label>
              <textarea
                id="bulk-extra-notes"
                className="input"
                rows={2}
                value={bulkNotes}
                disabled={bulkRunning}
                onChange={(e) => setBulkNotes(e.target.value)}
                placeholder="vd: Ưu tiên bản dưới 60 giây, mở đầu bằng câu hook mạnh…"
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            Không còn project nào được chọn.
          </p>
        )}
      </Modal>

      {/* Modal tạo project */}
      <Modal
        title="Tạo project mới"
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button onClick={onCreate} disabled={!canCreate || creating}>
              {creating ? "Đang tạo…" : "Tạo project"}
            </Button>
          </>
        }
      >
        {createError && <ErrorBanner message={createError} />}
        <div>
          <label className="label" htmlFor="project-name">
            Tên
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
            placeholder="vd: Mổ xẻ paper GPT-5"
          />
        </div>
        <div>
          <label className="label" htmlFor="project-id">
            ID (tên folder)
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
            placeholder="tự tạo từ tên…"
          />
          {idValid ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Tự tạo từ tên, sửa được.
            </p>
          ) : (
            <p className="mt-1 text-xs text-[var(--danger)]">
              ID phải là kebab-case: chữ thường, số, gạch nối (vd: my-video-1).
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="project-tags">
            Tags
          </label>
          <TagInput id="project-tags" tags={tags} onChange={setTags} />
        </div>
        <div>
          <span className="label">Định dạng video</span>
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
                    {preset.label}
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
                Tùy chỉnh
              </span>
              <span
                className={`text-[11px] ${
                  customActive ? "opacity-80" : "text-[var(--text-muted)]"
                }`}
              >
                {customActive ? `${width}×${height}` : "tự nhập kích thước"}
              </span>
            </button>
          </div>
          {customActive && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="project-width">
                  Rộng (px)
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
                  Cao (px)
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
              Khác
            </button>
            {customFps && (
              <input
                aria-label="FPS tùy chỉnh"
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
