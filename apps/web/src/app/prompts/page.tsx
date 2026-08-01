"use client";

import {
  ArrowLeft,
  Pencil,
  Plus,
  Save,
  ScrollText,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  createPrompt,
  deletePrompt,
  getPrompts,
  updatePrompt,
  type PromptTemplate,
} from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { PageHeader } from "@/components/PageHeader";
import { formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";

/** null = đang xem danh sách; id null = tạo mới. */
type Editor = { id: string | null; name: string; content: string };

export default function PromptsPage() {
  const { t, tf } = useT();
  const [prompts, setPrompts] = useState<PromptTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Prompt đang xóa - chặn double-submit nút xóa
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Prompt đang chờ xác nhận xóa (modal gõ DELETE)
  const [deleteTarget, setDeleteTarget] = useState<PromptTemplate | null>(null);

  const load = useCallback(async () => {
    try {
      setPrompts(await getPrompts());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSave() {
    if (!editor || saving) return;
    const name = editor.name.trim();
    if (!name || !editor.content.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editor.id) {
        await updatePrompt(editor.id, { name, content: editor.content });
      } else {
        await createPrompt({ name, content: editor.content });
      }
      setEditor(null);
      load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(p: PromptTemplate) {
    if (deletingId) return;
    setDeletingId(p.id);
    try {
      await deletePrompt(p.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
    }
  }

  // ===== Form tạo mới / sửa - full-width, editor cao hết viewport =====
  if (editor) {
    const valid = editor.name.trim() !== "" && editor.content.trim() !== "";
    return (
      <div className="flex h-[calc(100vh-56px-40px)] w-full flex-col gap-4">
        <PageHeader
          title={editor.id ? t("prompts.edit-title") : t("prompts.create")}
          subtitle={t("prompts.editor-subtitle")}
          actions={
            <>
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => setEditor(null)}
              >
                <ArrowLeft size={15} strokeWidth={2} />
                {t("common.back-to-list")}
              </Button>
              <Button onClick={onSave} disabled={!valid || saving}>
                <Save size={15} strokeWidth={2} />
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </>
          }
        />

        {saveError && (
          <ErrorBanner message={t("prompts.save-error")} detail={saveError} />
        )}

        <Card className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div>
              <label className="label" htmlFor="prompt-name">
                {t("prompts.name-label")}
              </label>
              <input
                id="prompt-name"
                className="input"
                value={editor.name}
                onChange={(e) =>
                  setEditor((s) => (s ? { ...s, name: e.target.value } : s))
                }
                placeholder={t("prompts.name-placeholder")}
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <label className="label" htmlFor="prompt-content">
                {t("prompts.content-label")}
              </label>
              <textarea
                id="prompt-content"
                className="input h-full min-h-[320px] flex-1 resize-none leading-relaxed"
                value={editor.content}
                onChange={(e) =>
                  setEditor((s) => (s ? { ...s, content: e.target.value } : s))
                }
                placeholder={t("prompts.content-placeholder")}
              />
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // ===== Danh sách =====
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            {t("nav.prompts")}
            <InfoHint
              titleKey="help.prompts.title"
              bodyKey="help.prompts.body"
              size={14}
            />
          </span>
        }
        subtitle={t("prompts.subtitle")}
        actions={
          <>
            <Button
              onClick={() => setEditor({ id: null, name: "", content: "" })}
            >
              <Plus size={16} strokeWidth={2} />
              {t("prompts.create")}
            </Button>
          </>
        }
      />

      {error && (
        <ErrorBanner
          message={t("prompts.load-error")}
          detail={error}
        />
      )}

      {prompts && prompts.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {prompts.map((p) => (
            <Card key={p.id} className="flex h-full flex-col">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <ScrollText
                  size={18}
                  strokeWidth={1.75}
                  className="mt-0.5 shrink-0 text-[var(--primary)]"
                />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold">{p.name}</h2>
                  <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-[var(--text-muted)]">
                    {p.content}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
                <span className="text-xs text-[var(--text-muted)]">
                  {tf("prompts.edited", { time: formatRelative(p.updatedAt) })}
                </span>
                <span className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    small
                    onClick={() =>
                      setEditor({ id: p.id, name: p.name, content: p.content })
                    }
                  >
                    <Pencil size={13} strokeWidth={2} />
                    {t("common.edit")}
                  </Button>
                  <Button
                    variant="destructive"
                    small
                    disabled={deletingId === p.id}
                    onClick={() => setDeleteTarget(p)}
                    aria-label={tf("prompts.delete-aria", { name: p.name })}
                  >
                    <Trash2 size={13} strokeWidth={2} />
                    {deletingId === p.id ? t("common.deleting") : t("common.delete")}
                  </Button>
                </span>
              </div>
            </Card>
          ))}
        </div>
      ) : prompts ? (
        <Card>
          <EmptyState
            icon={ScrollText}
            description={t("prompts.empty")}
            action={
              <Button
                onClick={() => setEditor({ id: null, name: "", content: "" })}
              >
                <Plus size={16} strokeWidth={2} />
                {t("prompts.create")}
              </Button>
            }
          />
        </Card>
      ) : (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">
          {t("common.loading")}
        </p>
      )}

      {/* Modal xác nhận xóa prompt mẫu - bắt gõ DELETE */}
      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title={t("prompts.delete-title")}
        description={
          deleteTarget && (
            <>
              {t("prompts.delete-desc-1")}{" "}
              <span className="font-medium">{deleteTarget.name}</span>? {t("common.no-undo")}
            </>
          )
        }
        busy={deleteTarget !== null && deletingId === deleteTarget.id}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget);
        }}
      />
    </div>
  );
}
