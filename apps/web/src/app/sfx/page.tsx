"use client";

import {
  AudioLines,
  Pencil,
  Pause,
  Play,
  Search,
  SearchX,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteSfx,
  getSfx,
  mediaUrl,
  patchSfx,
  uploadSfx,
  type SfxEntry,
} from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { formatDurationMs } from "@/lib/format";

const RECOMMENDED_TAG = "hay-dung";

const sfxUrl = (file: string) => mediaUrl("assets/sound-effects/" + file);

const isRecommended = (e: SfxEntry) => e.tags.includes(RECOMMENDED_TAG);

function matches(e: SfxEntry, q: string): boolean {
  if (!q) return true;
  const hay = `${e.file} ${e.tags.join(" ")} ${e.description}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((term) => hay.includes(term));
}

export default function SfxPage() {
  const [entries, setEntries] = useState<SfxEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Nghe thử: một audio element dùng chung
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  // Upload modal
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Edit modal
  const [editing, setEditing] = useState<SfxEntry | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [editTags, setEditTags] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // File đang xóa — chặn double-submit nút xóa
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await getSfx());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [load]);

  function togglePlay(entryFile: string) {
    if (playing === entryFile) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(sfxUrl(entryFile));
    audio.onended = () => setPlaying(null);
    audio.onerror = () => {
      setPlaying(null);
      setActionError(`Không phát được file ${entryFile}.`);
    };
    audioRef.current = audio;
    setActionError(null);
    setPlaying(entryFile);
    audio.play().catch(() => setPlaying(null));
  }

  /** Toggle đề xuất — optimistic update, revert nếu API lỗi. */
  async function toggleRecommended(entry: SfxEntry) {
    const next = !isRecommended(entry);
    setActionError(null);
    setEntries((list) =>
      (list ?? []).map((e) =>
        e.file === entry.file
          ? {
              ...e,
              tags: next
                ? [...e.tags, RECOMMENDED_TAG]
                : e.tags.filter((t) => t !== RECOMMENDED_TAG),
            }
          : e
      )
    );
    try {
      const updated = await patchSfx(entry.file, { recommended: next });
      setEntries((list) =>
        (list ?? []).map((e) => (e.file === entry.file ? updated : e))
      );
    } catch (e) {
      // revert
      setEntries((list) =>
        (list ?? []).map((x) => (x.file === entry.file ? entry : x))
      );
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  function openEdit(entry: SfxEntry) {
    setEditing(entry);
    setEditDesc(entry.description);
    setEditTags(entry.tags.join(", "));
    setEditError(null);
  }

  async function onSaveEdit() {
    if (!editing || savingEdit) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const tagList = editTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const updated = await patchSfx(editing.file, {
        description: editDesc.trim(),
        tags: tagList,
      });
      setEntries((list) =>
        (list ?? []).map((e) => (e.file === editing.file ? updated : e))
      );
      setEditing(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEdit(false);
    }
  }

  async function onDelete(entryFile: string) {
    if (deletingFile) return;
    if (!window.confirm(`Xóa sound effect "${entryFile}"?`)) return;
    setActionError(null);
    setDeletingFile(entryFile);
    try {
      await deleteSfx(entryFile);
      if (playing === entryFile) {
        audioRef.current?.pause();
        setPlaying(null);
      }
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingFile(null);
    }
  }

  async function onUpload() {
    if (!file || uploading) return;
    setUploading(true);
    setUploadError(null);
    try {
      await uploadSfx(file, tags.trim(), description.trim());
      setOpen(false);
      setFile(null);
      setTags("");
      setDescription("");
      await load();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  function renderTable(list: SfxEntry[], recommendedSection: boolean) {
    return (
      <table className="table">
        <thead>
          <tr>
            <th className="w-12"></th>
            <th>Tên file</th>
            <th>Tags</th>
            <th>Thời lượng</th>
            <th>Mô tả</th>
            <th className="w-28"></th>
          </tr>
        </thead>
        <tbody>
          {list.map((e) => {
            const rec = isRecommended(e);
            return (
              <tr
                key={e.file}
                className={recommendedSection ? "bg-[var(--primary-soft)]/40" : ""}
              >
                <td>
                  <button
                    type="button"
                    onClick={() => togglePlay(e.file)}
                    aria-label={playing === e.file ? "Dừng" : "Nghe thử"}
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150 ${
                      playing === e.file
                        ? "bg-[var(--primary)]"
                        : "bg-[var(--primary-soft)] text-[var(--primary)] hover:bg-[var(--primary)] hover:text-[var(--primary-soft)]"
                    }`}
                  >
                    {playing === e.file ? (
                      <Pause
                        size={14}
                        strokeWidth={2}
                        className="text-[var(--primary-soft)]"
                      />
                    ) : (
                      <Play size={14} strokeWidth={2} />
                    )}
                  </button>
                </td>
                <td className="font-medium">{e.file}</td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    {e.tags
                      .filter((t) => t !== RECOMMENDED_TAG)
                      .map((t) => (
                        <span key={t} className="chip">
                          {t}
                        </span>
                      ))}
                  </span>
                </td>
                <td className="text-[var(--text-muted)]">
                  {formatDurationMs(e.durationMs)}
                </td>
                <td className="max-w-xs truncate text-[var(--text-muted)]">
                  {e.description || "—"}
                </td>
                <td>
                  <span className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => toggleRecommended(e)}
                      aria-label={rec ? "Bỏ đề xuất" : "Đánh dấu đề xuất"}
                      title={rec ? "Bỏ đề xuất" : "Đánh dấu đề xuất"}
                      className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] ${
                        rec ? "text-[var(--primary)]" : "text-[var(--text-muted)]"
                      }`}
                    >
                      <Star
                        size={15}
                        strokeWidth={2}
                        fill={rec ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(e)}
                      aria-label={`Sửa ${e.file}`}
                      title="Sửa mô tả & tags"
                      className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
                    >
                      <Pencil size={14} strokeWidth={2} />
                    </button>
                    <Button
                      variant="destructive"
                      small
                      disabled={deletingFile === e.file}
                      onClick={() => onDelete(e.file)}
                      aria-label={`Xóa ${e.file}`}
                    >
                      <Trash2 size={14} strokeWidth={2} />
                    </Button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  const q = search.trim();
  const filtered = (entries ?? []).filter((e) => matches(e, q));
  const recommended = filtered.filter(isRecommended);
  const library = filtered.filter((e) => !isRecommended(e));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Sound Effects"
        subtitle="Thư viện dùng chung tại assets/sound-effects/"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Upload size={15} strokeWidth={2} />
            Thêm sound effect
          </Button>
        }
      />

      {error && (
        <ErrorBanner
          message="Không tải được thư viện sound effect."
          detail={error}
        />
      )}
      {actionError && <ErrorBanner message={actionError} />}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search
          size={15}
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-muted)]"
        />
        <input
          className="input pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo tên, tag, mô tả…"
          aria-label="Tìm sound effect"
        />
      </div>

      {entries === null ? (
        <Card>
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            Đang tải…
          </p>
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={AudioLines}
            description="Thư viện trống. Thêm sound effect (whoosh, pop, click…) để dùng khi lắp ráp video."
            action={
              <Button onClick={() => setOpen(true)}>
                <Upload size={15} strokeWidth={2} />
                Thêm sound effect
              </Button>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={SearchX}
            description={`Không tìm thấy sound effect nào khớp "${q}".`}
          />
        </Card>
      ) : (
        <>
          {/* Khu đề xuất — AI ưu tiên dùng khi brief đặt sfxMode "recommended" */}
          <Card
            title={`Đề xuất (${recommended.length})`}
            actions={
              <Star
                size={16}
                strokeWidth={2}
                fill="currentColor"
                className="text-[var(--primary)]"
              />
            }
          >
            {recommended.length > 0 ? (
              renderTable(recommended, true)
            ) : (
              <EmptyState
                icon={Star}
                description='Chưa có sound effect đề xuất nào. Bấm ngôi sao ở một sound bên dưới để đưa vào bộ đề xuất — AI sẽ ưu tiên dùng.'
              />
            )}
          </Card>

          <Card title={`Thư viện (${library.length})`}>
            {library.length > 0 ? (
              renderTable(library, false)
            ) : (
              <EmptyState
                icon={AudioLines}
                description="Tất cả sound effect khớp bộ lọc đều đang nằm ở khu đề xuất."
              />
            )}
          </Card>
        </>
      )}

      {/* Modal upload */}
      <Modal
        title="Thêm sound effect"
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button onClick={onUpload} disabled={!file || uploading}>
              {uploading ? "Đang tải lên…" : "Tải lên"}
            </Button>
          </>
        }
      >
        {uploadError && <ErrorBanner message={uploadError} />}
        <div>
          <label className="label" htmlFor="sfx-file">
            File audio
          </label>
          <input
            id="sfx-file"
            type="file"
            accept="audio/*"
            className="input h-auto py-1.5"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <label className="label" htmlFor="sfx-tags">
            Tags (phân cách bằng dấu phẩy)
          </label>
          <input
            id="sfx-tags"
            className="input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="vd: whoosh, transition, nhanh"
          />
        </div>
        <div>
          <label className="label" htmlFor="sfx-desc">
            Mô tả
          </label>
          <textarea
            id="sfx-desc"
            className="input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Dùng khi nào, cảm giác ra sao…"
          />
        </div>
      </Modal>

      {/* Modal sửa description + tags */}
      <Modal
        title={editing ? `Sửa: ${editing.file}` : "Sửa sound effect"}
        open={editing !== null}
        onClose={() => {
          if (!savingEdit) setEditing(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={savingEdit}
              onClick={() => setEditing(null)}
            >
              Hủy
            </Button>
            <Button onClick={onSaveEdit} disabled={savingEdit}>
              {savingEdit ? "Đang lưu…" : "Lưu"}
            </Button>
          </>
        }
      >
        {editError && <ErrorBanner message={editError} />}
        <div>
          <label className="label" htmlFor="sfx-edit-desc">
            Mô tả
          </label>
          <textarea
            id="sfx-edit-desc"
            className="input"
            rows={2}
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            placeholder="Dùng khi nào, cảm giác ra sao…"
          />
        </div>
        <div>
          <label className="label" htmlFor="sfx-edit-tags">
            Tags (phân cách bằng dấu phẩy)
          </label>
          <input
            id="sfx-edit-tags"
            className="input"
            value={editTags}
            onChange={(e) => setEditTags(e.target.value)}
            placeholder="vd: whoosh, transition, nhanh"
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Tag &quot;hay-dung&quot; đánh dấu sound thuộc bộ đề xuất — dùng nút ngôi sao
            để bật/tắt nhanh.
          </p>
        </div>
      </Modal>
    </div>
  );
}
