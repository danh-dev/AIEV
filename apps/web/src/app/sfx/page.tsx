"use client";

import {
  AudioLines,
  Music,
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
  deleteMusic,
  deleteSfx,
  getMusic,
  getSfx,
  mediaUrl,
  patchMusic,
  patchSfx,
  uploadMusic,
  uploadSfx,
  type MusicEntry,
  type SfxEntry,
} from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { formatDurationMs } from "@/lib/format";
import { useT } from "@/lib/i18n";

const RECOMMENDED_TAG = "hay-dung";

const sfxUrl = (file: string) => mediaUrl("assets/sound-effects/" + file);

const musicFileUrl = (file: string) => mediaUrl("assets/music/" + file);

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
  const { t, tf } = useT();
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

  // File đang xóa - chặn double-submit nút xóa
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  // File đang chờ xác nhận xóa (modal gõ DELETE)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

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
      setActionError(tf("sfx.play-error", { name: entryFile }));
    };
    audioRef.current = audio;
    setActionError(null);
    setPlaying(entryFile);
    audio.play().catch(() => setPlaying(null));
  }

  /** Toggle đề xuất - optimistic update, revert nếu API lỗi. */
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
      setDeleteTarget(null);
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
            <th>{t("sfx.col-file")}</th>
            <th>{t("common.tags")}</th>
            <th>{t("sfx.col-duration")}</th>
            <th>{t("sfx.col-desc")}</th>
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
                    aria-label={playing === e.file ? t("sfx.stop") : t("sfx.play")}
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
                  {e.description || "-"}
                </td>
                <td>
                  <span className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => toggleRecommended(e)}
                      aria-label={rec ? t("sfx.unrecommend") : t("sfx.recommend")}
                      title={rec ? t("sfx.unrecommend") : t("sfx.recommend")}
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
                      aria-label={tf("sfx.edit-aria", { name: e.file })}
                      title={t("sfx.edit-title")}
                      className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
                    >
                      <Pencil size={14} strokeWidth={2} />
                    </button>
                    <Button
                      variant="destructive"
                      small
                      disabled={deletingFile === e.file}
                      onClick={() => setDeleteTarget(e.file)}
                      aria-label={tf("assets.delete-aria", { name: e.file })}
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
        title={t("nav.sfx")}
        subtitle={t("sfx.subtitle")}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Upload size={15} strokeWidth={2} />
            {t("sfx.add")}
          </Button>
        }
      />

      {error && (
        <ErrorBanner
          message={t("sfx.load-error")}
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
          placeholder={t("sfx.search-placeholder")}
          aria-label={t("sfx.search-aria")}
        />
      </div>

      {entries === null ? (
        <Card>
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={AudioLines}
            description={t("sfx.empty")}
            action={
              <Button onClick={() => setOpen(true)}>
                <Upload size={15} strokeWidth={2} />
                {t("sfx.add")}
              </Button>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={SearchX}
            description={tf("sfx.no-match", { q })}
          />
        </Card>
      ) : (
        <>
          {/* Khu đề xuất - AI ưu tiên dùng khi brief đặt sfxMode "recommended" */}
          <Card
            title={tf("sfx.recommended-title", { n: recommended.length })}
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
                description={t("sfx.rec-empty")}
              />
            )}
          </Card>

          <Card title={tf("sfx.library-title", { n: library.length })}>
            {library.length > 0 ? (
              renderTable(library, false)
            ) : (
              <EmptyState
                icon={AudioLines}
                description={t("sfx.all-in-rec")}
              />
            )}
          </Card>
        </>
      )}

      {/* Nhạc nền - thư viện riêng tại assets/music/, AI tự chọn theo mood khi brief bật */}
      <MusicSection />

      {/* Modal upload */}
      <Modal
        title={t("sfx.add")}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={onUpload} disabled={!file || uploading}>
              {uploading ? t("common.uploading") : t("assets.upload")}
            </Button>
          </>
        }
      >
        {uploadError && <ErrorBanner message={uploadError} />}
        <div>
          <label className="label" htmlFor="sfx-file">
            {t("sfx.file-label")}
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
            {t("sfx.tags-label")}
          </label>
          <input
            id="sfx-tags"
            className="input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={t("sfx.tags-placeholder")}
          />
        </div>
        <div>
          <label className="label" htmlFor="sfx-desc">
            {t("sfx.col-desc")}
          </label>
          <textarea
            id="sfx-desc"
            className="input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("sfx.desc-placeholder")}
          />
        </div>
      </Modal>

      {/* Modal sửa description + tags */}
      <Modal
        title={
          editing
            ? tf("sfx.edit-modal-title", { name: editing.file })
            : t("sfx.edit-fallback")
        }
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
              {t("common.cancel")}
            </Button>
            <Button onClick={onSaveEdit} disabled={savingEdit}>
              {savingEdit ? t("common.saving") : t("common.save")}
            </Button>
          </>
        }
      >
        {editError && <ErrorBanner message={editError} />}
        <div>
          <label className="label" htmlFor="sfx-edit-desc">
            {t("sfx.col-desc")}
          </label>
          <textarea
            id="sfx-edit-desc"
            className="input"
            rows={2}
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            placeholder={t("sfx.desc-placeholder")}
          />
        </div>
        <div>
          <label className="label" htmlFor="sfx-edit-tags">
            {t("sfx.tags-label")}
          </label>
          <input
            id="sfx-edit-tags"
            className="input"
            value={editTags}
            onChange={(e) => setEditTags(e.target.value)}
            placeholder={t("sfx.tags-placeholder")}
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("sfx.rec-tag-hint")}
          </p>
        </div>
      </Modal>

      {/* Modal xác nhận xóa sound effect - bắt gõ DELETE */}
      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title={t("sfx.delete-title")}
        description={
          deleteTarget && (
            <>
              {t("sfx.delete-desc-1")}{" "}
              <span className="font-medium">{deleteTarget}</span>? {t("sfx.delete-desc-2")}
            </>
          )
        }
        busy={deleteTarget !== null && deletingFile === deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget);
        }}
      />
    </div>
  );
}

/**
 * Section "Nhạc nền" - thư viện assets/music/ (cùng pattern với sound effects).
 * Tags = mood (nang-luong, chill, cam-hung, cang-thang, vui-ve…) để AI chọn
 * bài hợp nội dung khi brief đặt musicMode "auto".
 */
function MusicSection() {
  const { t, tf } = useT();
  const [entries, setEntries] = useState<MusicEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
  const [editing, setEditing] = useState<MusicEntry | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [editTags, setEditTags] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // File đang xóa - chặn double-submit nút xóa
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  // File đang chờ xác nhận xóa (modal gõ DELETE)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await getMusic());
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
    const audio = new Audio(musicFileUrl(entryFile));
    audio.onended = () => setPlaying(null);
    audio.onerror = () => {
      setPlaying(null);
      setActionError(tf("sfx.play-error", { name: entryFile }));
    };
    audioRef.current = audio;
    setActionError(null);
    setPlaying(entryFile);
    audio.play().catch(() => setPlaying(null));
  }

  function openEdit(entry: MusicEntry) {
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
      const updated = await patchMusic(editing.file, {
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
    setActionError(null);
    setDeletingFile(entryFile);
    try {
      await deleteMusic(entryFile);
      if (playing === entryFile) {
        audioRef.current?.pause();
        setPlaying(null);
      }
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingFile(null);
      setDeleteTarget(null);
    }
  }

  async function onUpload() {
    if (!file || uploading) return;
    setUploading(true);
    setUploadError(null);
    try {
      await uploadMusic(file, tags.trim(), description.trim());
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

  return (
    <>
      <Card
        title={tf("music.title", { n: entries?.length ?? 0 })}
        actions={
          <span className="flex items-center gap-2">
            <Music size={16} strokeWidth={2} className="text-[var(--primary)]" />
            <Button small onClick={() => setOpen(true)}>
              <Upload size={13} strokeWidth={2} />
              {t("music.add-short")}
            </Button>
          </span>
        }
      >
        {error && (
          <ErrorBanner message={t("music.load-error")} detail={error} />
        )}
        {actionError && <ErrorBanner message={actionError} />}

        {entries === null ? (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={Music}
            description={t("music.empty")}
            action={
              <Button onClick={() => setOpen(true)}>
                <Upload size={15} strokeWidth={2} />
                {t("music.add")}
              </Button>
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="w-12"></th>
                <th>{t("sfx.col-file")}</th>
                <th>{t("music.col-mood")}</th>
                <th>{t("sfx.col-duration")}</th>
                <th>{t("sfx.col-desc")}</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.file}>
                  <td>
                    <button
                      type="button"
                      onClick={() => togglePlay(e.file)}
                      aria-label={playing === e.file ? t("sfx.stop") : t("sfx.play")}
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
                      {e.tags.map((t) => (
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
                    {e.description || "-"}
                  </td>
                  <td>
                    <span className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(e)}
                        aria-label={tf("sfx.edit-aria", { name: e.file })}
                        title={t("sfx.edit-title")}
                        className="flex h-8 w-8 items-center justify-center rounded-[var(--radius)] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
                      >
                        <Pencil size={14} strokeWidth={2} />
                      </button>
                      <Button
                        variant="destructive"
                        small
                        disabled={deletingFile === e.file}
                        onClick={() => setDeleteTarget(e.file)}
                        aria-label={tf("assets.delete-aria", { name: e.file })}
                      >
                        <Trash2 size={14} strokeWidth={2} />
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Modal upload nhạc */}
      <Modal
        title={t("music.add")}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={onUpload} disabled={!file || uploading}>
              {uploading ? t("common.uploading") : t("assets.upload")}
            </Button>
          </>
        }
      >
        {uploadError && <ErrorBanner message={uploadError} />}
        <div>
          <label className="label" htmlFor="music-file">
            {t("music.file-label")}
          </label>
          <input
            id="music-file"
            type="file"
            accept="audio/*"
            className="input h-auto py-1.5"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <label className="label" htmlFor="music-tags">
            {t("music.tags-label")}
          </label>
          <input
            id="music-tags"
            className="input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={t("music.tags-placeholder")}
          />
        </div>
        <div>
          <label className="label" htmlFor="music-desc">
            {t("sfx.col-desc")}
          </label>
          <textarea
            id="music-desc"
            className="input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("music.desc-placeholder")}
          />
        </div>
      </Modal>

      {/* Modal sửa description + tags */}
      <Modal
        title={
          editing
            ? tf("sfx.edit-modal-title", { name: editing.file })
            : t("music.edit-fallback")
        }
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
              {t("common.cancel")}
            </Button>
            <Button onClick={onSaveEdit} disabled={savingEdit}>
              {savingEdit ? t("common.saving") : t("common.save")}
            </Button>
          </>
        }
      >
        {editError && <ErrorBanner message={editError} />}
        <div>
          <label className="label" htmlFor="music-edit-desc">
            {t("sfx.col-desc")}
          </label>
          <textarea
            id="music-edit-desc"
            className="input"
            rows={2}
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            placeholder={t("music.desc-placeholder")}
          />
        </div>
        <div>
          <label className="label" htmlFor="music-edit-tags">
            {t("music.tags-label")}
          </label>
          <input
            id="music-edit-tags"
            className="input"
            value={editTags}
            onChange={(e) => setEditTags(e.target.value)}
            placeholder={t("music.tags-placeholder")}
          />
        </div>
      </Modal>

      {/* Modal xác nhận xóa bài nhạc - bắt gõ DELETE */}
      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title={t("music.delete-title")}
        description={
          deleteTarget && (
            <>
              {t("music.delete-desc-1")}{" "}
              <span className="font-medium">{deleteTarget}</span>? {t("sfx.delete-desc-2")}
            </>
          )
        }
        busy={deleteTarget !== null && deletingFile === deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget);
        }}
      />
    </>
  );
}
