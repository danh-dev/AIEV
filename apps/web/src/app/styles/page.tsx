"use client";

import { Palette, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  createStyle,
  deleteStyle,
  getStyles,
  mediaUrl,
  type StyleColors,
  type StyleDesign,
} from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { InfoHint } from "@/components/InfoHint";
import { PageHeader } from "@/components/PageHeader";
import { TagInput } from "@/components/TagInput";
import { refreshStyles } from "@/components/StyleSelect";
import { formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";

/** Thứ tự 5 màu trên dải swatch - trùng thứ tự form editor. */
const SWATCH_KEYS: (keyof StyleColors)[] = [
  "primary",
  "secondary",
  "background",
  "text",
  "accent",
];

/** Dải 5 ô màu của style - màu style là DATA của user, render bằng inline style. */
function SwatchStrip({ colors }: { colors: StyleColors }) {
  return (
    <div className="flex h-10 overflow-hidden rounded-t-[var(--radius-lg)]">
      {SWATCH_KEYS.map((k) => (
        <span
          key={k}
          className="flex-1"
          style={{ backgroundColor: colors[k] }}
          title={`${k}: ${colors[k]}`}
        />
      ))}
    </div>
  );
}

export default function StylesPage() {
  const { t, tf } = useT();
  const router = useRouter();
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [list, setList] = useState<StyleDesign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Modal "Tạo style"
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [cloneFrom, setCloneFrom] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Chọn nhiều style để xóa
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await getStyles();
      setDefaultId(r.defaultId);
      setList(r.styles);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setName("");
    setTags([]);
    setCloneFrom("");
    setCreateError(null);
    setCreateOpen(true);
  }

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
    const targets = list.filter((s) => selected.has(s.id));
    setBulkDeleting(true);
    setBulkErrors([]);
    // Xóa TUẦN TỰ - lỗi nào (vd style cuối cùng / LAST_STYLE) gom hiện sau
    const errors: string[] = [];
    for (const s of targets) {
      try {
        await deleteStyle(s.id);
      } catch (e) {
        errors.push(
          `${s.name} (${s.id}): ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
    setBulkDeleting(false);
    setBulkDeleteOpen(false);
    setSelected(new Set());
    setBulkErrors(errors);
    refreshStyles();
    await load();
  }

  async function onCreate() {
    if (!name.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const s = await createStyle({
        name: name.trim(),
        ...(tags.length > 0 ? { tags } : {}),
        ...(cloneFrom ? { cloneFrom } : {}),
      });
      refreshStyles();
      setCreateOpen(false);
      router.push(`/styles/${s.id}`);
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
            {t("nav.styles")}
            <InfoHint
              titleKey="help.styles.title"
              bodyKey="help.styles.body"
              size={14}
            />
          </span>
        }
        subtitle={t("stylesPage.subtitle")}
        actions={
          <>
            <Button onClick={openCreate}>
              <Plus size={16} strokeWidth={2} />
              {t("stylesPage.create")}
            </Button>
          </>
        }
      />

      {error && (
        <ErrorBanner message={t("stylesPage.load-error")} detail={error} />
      )}
      {bulkErrors.length > 0 && (
        <ErrorBanner
          message={tf("stylesPage.delete-errors", { n: bulkErrors.length })}
          detail={bulkErrors.join("\n")}
        />
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] bg-[var(--bg-subtle)] px-3 py-2">
          <span className="text-sm font-medium">
            {tf("stylesPage.selected", { n: selected.size })}
          </span>
          <span className="flex-1" />
          <Button
            variant="secondary"
            small
            disabled={bulkDeleting}
            onClick={() => setSelected(new Set())}
          >
            {t("common.deselect")}
          </Button>
          <Button
            variant="destructive"
            small
            disabled={bulkDeleting}
            onClick={() => setBulkDeleteOpen(true)}
          >
            <Trash2 size={14} strokeWidth={2} />
            {bulkDeleting ? t("common.deleting") : t("common.delete-selected")}
          </Button>
        </div>
      )}

      {list && list.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4">
          {list.map((s) => (
            <div
              key={s.id}
              role="link"
              tabIndex={0}
              onClick={() => router.push(`/styles/${s.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter") router.push(`/styles/${s.id}`);
              }}
              className="card relative cursor-pointer overflow-hidden p-0 text-left transition-colors duration-150 hover:border-[var(--primary)]"
            >
              <span
                className="absolute left-2 top-2 flex items-center justify-center rounded-[var(--radius)] bg-[var(--surface)] p-1 shadow-[var(--shadow-card)]"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  className="checkbox block"
                  aria-label={tf("common.select-aria", { name: s.name })}
                  checked={selected.has(s.id)}
                  disabled={bulkDeleting}
                  onChange={() => toggleSelect(s.id)}
                />
              </span>
              <SwatchStrip colors={s.colors} />
              <div className="flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">
                    {s.name}
                  </p>
                  {s.id === defaultId && (
                    <span className="shrink-0 rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-[11px] font-medium leading-none text-[var(--primary)]">
                      {t("styles.default")}
                    </span>
                  )}
                </div>
                {s.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {s.tags.map((t) => (
                      <span key={t} className="chip">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {s.logoPath && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(s.logoPath)}
                      alt={tf("stylesPage.logo-alt", { name: s.name })}
                      className="h-6 w-auto max-w-[96px] rounded-[3px] border border-[var(--border)] bg-[var(--bg-subtle)] object-contain p-0.5"
                    />
                  )}
                  <span className="ml-auto text-xs text-[var(--text-muted)]">
                    {formatRelative(s.updatedAt)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : list ? (
        <Card>
          <EmptyState
            icon={Palette}
            description={t("stylesPage.empty")}
            action={
              <Button onClick={openCreate}>
                <Plus size={16} strokeWidth={2} />
                {t("stylesPage.create")}
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        </Card>
      )}

      {/* Modal xác nhận xóa nhiều style - bắt gõ DELETE */}
      <ConfirmDeleteModal
        open={bulkDeleteOpen}
        title={t("stylesPage.delete-selected-title")}
        description={
          <p>{tf("stylesPage.delete-desc", { n: selected.size })}</p>
        }
        items={(list ?? [])
          .filter((s) => selected.has(s.id))
          .map((s) => s.name)}
        busy={bulkDeleting}
        confirmLabel={tf("stylesPage.delete-n", { n: selected.size })}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={onDeleteSelected}
      />

      {/* Modal tạo style mới */}
      <Modal
        title={t("stylesPage.create")}
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
            <Button onClick={onCreate} disabled={!name.trim() || creating}>
              <Plus size={15} strokeWidth={2} />
              {creating ? t("common.creating") : t("stylesPage.create")}
            </Button>
          </>
        }
      >
        {createError && (
          <ErrorBanner message={t("stylesPage.create-error")} detail={createError} />
        )}
        <div>
          <label className="label" htmlFor="style-new-name">
            {t("stylesPage.name-label")}
          </label>
          <input
            id="style-new-name"
            className="input"
            autoFocus
            value={name}
            disabled={creating}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("stylesPage.name-placeholder")}
          />
        </div>
        <div>
          <label className="label" htmlFor="style-new-tags">
            {t("common.tags")}
          </label>
          <TagInput id="style-new-tags" tags={tags} onChange={setTags} />
        </div>
        <div>
          <label className="label" htmlFor="style-new-clone">
            {t("stylesPage.clone-from")}
          </label>
          <select
            id="style-new-clone"
            className="input"
            value={cloneFrom}
            disabled={creating}
            onChange={(e) => setCloneFrom(e.target.value)}
          >
            <option value="">{t("stylesPage.blank")}</option>
            {(list ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("stylesPage.clone-hint")}
          </p>
        </div>
      </Modal>
    </div>
  );
}
