"use client";

import { Crop, Loader2, Scissors, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  createClipProjects,
  getClips,
  repurposeProject,
  REPURPOSE_SIZES,
  suggestClips,
  type Clip,
  type CreatedClipProject,
  type ProjectSummary,
  type RepurposeAspect,
} from "@/lib/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";

/** Giây → "mm:ss" (lib/format.ts chưa có helper đồng hồ nên viết tại chỗ). */
function clock(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

const ASPECTS: RepurposeAspect[] = ["9:16", "16:9", "1:1", "4:5"];

/** true = project hiện tại đã đúng tỉ lệ đó (so tỉ lệ, không so kích thước - như server). */
function isSameAspect(
  aspect: RepurposeAspect,
  width?: number,
  height?: number
): boolean {
  if (!width || !height) return false;
  const target = REPURPOSE_SIZES[aspect];
  return Math.abs(width / height - target.width / target.height) < 0.01;
}

/**
 * Hai card đi cùng nhau trong một cột: "Cắt short từ video dài" (AI đọc
 * transcript, gợi ý đoạn hay rồi đẻ project con) và "Tái chế tỉ lệ khung"
 * (project con cùng nội dung, khác khung hình).
 */
export function ProjectClipsCard({
  projectId,
  width,
  height,
  onCreated,
}: {
  projectId: string;
  /** Kích thước hiện tại của project - dùng để khóa nút tỉ lệ trùng. */
  width?: number;
  height?: number;
  /** Gọi sau khi đẻ project con - trang cha reload dữ liệu. */
  onCreated?: () => void;
}) {
  const { t, tf } = useT();

  // ---- Phần 1: cắt short -------------------------------------------------
  const [clips, setClips] = useState<Clip[]>([]);
  const [suggestedAt, setSuggestedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [count, setCount] = useState("5");
  const [minSec, setMinSec] = useState("20");
  const [maxSec, setMaxSec] = useState("60");

  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const [selected, setSelected] = useState<number[]>([]);
  const [autoEdit, setAutoEdit] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedClipProject[]>([]);
  const [createNote, setCreateNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getClips(projectId);
      setClips(res.clips);
      setSuggestedAt(res.suggestedAt);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSuggest() {
    if (suggesting) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const res = await suggestClips(projectId, {
        count: Number(count) || 5,
        minSec: Number(minSec) || 20,
        maxSec: Number(maxSec) || 60,
      });
      setClips(res.clips);
      setSuggestedAt(res.suggestedAt);
      // Gợi ý mới thì lựa chọn cũ trỏ sai index - bỏ hết cho an toàn
      setSelected([]);
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  }

  function toggle(i: number) {
    setSelected((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );
  }

  const allSelected = clips.length > 0 && selected.length === clips.length;

  async function onCreate() {
    if (creating || selected.length === 0) return;
    setCreating(true);
    setCreateError(null);
    setCreated([]);
    setCreateNote(null);
    try {
      const res = await createClipProjects(projectId, {
        indexes: [...selected].sort((a, b) => a - b),
        autoEdit,
      });
      setCreated(res.created);
      setCreateNote(res.note ?? null);
      setSelected([]);
      onCreated?.();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  // ---- Phần 2: tái chế tỉ lệ --------------------------------------------
  const [aspect, setAspect] = useState<RepurposeAspect | null>(null);
  const [newName, setNewName] = useState("");
  const [repurposeAutoEdit, setRepurposeAutoEdit] = useState(false);
  const [repurposing, setRepurposing] = useState(false);
  const [repurposeError, setRepurposeError] = useState<string | null>(null);
  const [repurposed, setRepurposed] = useState<ProjectSummary | null>(null);

  async function onRepurpose() {
    if (repurposing || !aspect) return;
    setRepurposing(true);
    setRepurposeError(null);
    setRepurposed(null);
    try {
      const res = await repurposeProject(projectId, {
        aspect,
        ...(newName.trim() ? { name: newName.trim() } : {}),
        autoEdit: repurposeAutoEdit,
      });
      setRepurposed(res.project);
      setNewName("");
      onCreated?.();
    } catch (e) {
      setRepurposeError(e instanceof Error ? e.message : String(e));
    } finally {
      setRepurposing(false);
    }
  }

  return (
    <>
      <Card
        title={
          <span className="inline-flex items-center gap-1.5">
            {t("clips.title")}
            <InfoHint
              titleKey="help.clips.title"
              bodyKey="help.clips.body"
              size={14}
            />
          </span>
        }
      >
        {loadError && (
          <div className="mb-3">
            <ErrorBanner message={t("clips.load-error")} detail={loadError} />
          </div>
        )}

        {/* Cấu hình gợi ý - hàng gọn, màn hẹp thì tự xuống dòng */}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex w-20 flex-col gap-1 text-xs text-[var(--text-muted)]">
            {t("clips.count")}
            <input
              className="input"
              type="number"
              min={1}
              max={10}
              value={count}
              disabled={suggesting}
              onChange={(e) => setCount(e.target.value)}
            />
          </label>
          <label className="flex w-24 flex-col gap-1 text-xs text-[var(--text-muted)]">
            {t("clips.min-sec")}
            <input
              className="input"
              type="number"
              min={5}
              value={minSec}
              disabled={suggesting}
              onChange={(e) => setMinSec(e.target.value)}
            />
          </label>
          <label className="flex w-24 flex-col gap-1 text-xs text-[var(--text-muted)]">
            {t("clips.max-sec")}
            <input
              className="input"
              type="number"
              min={6}
              value={maxSec}
              disabled={suggesting}
              onChange={(e) => setMaxSec(e.target.value)}
            />
          </label>
          <Button disabled={suggesting} onClick={onSuggest}>
            {suggesting ? (
              <Loader2 size={14} strokeWidth={2} className="animate-spin" />
            ) : (
              <Sparkles size={14} strokeWidth={2} />
            )}
            {suggesting ? t("clips.suggesting") : t("clips.suggest")}
          </Button>
        </div>

        {/* Gọi AI mất 1-3 phút - nói rõ để người dùng không tưởng treo máy */}
        {suggesting && (
          <p className="mt-2 flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Loader2 size={13} strokeWidth={2} className="animate-spin" />
            {t("clips.suggest-hint")}
          </p>
        )}
        {suggestError && (
          <div className="mt-2">
            <ErrorBanner
              message={t("clips.suggest-error")}
              detail={suggestError}
            />
          </div>
        )}

        {clips.length === 0 ? (
          <EmptyState icon={Scissors} description={t("clips.none")} />
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(allSelected ? [] : clips.map((_, i) => i))
                  }
                />
                {t("clips.select-all")}
              </label>
              {suggestedAt && (
                <span className="text-xs text-[var(--text-muted)]">
                  {tf("clips.suggested-at", {
                    time: formatRelative(suggestedAt),
                  })}
                </span>
              )}
            </div>

            <ul className="flex flex-col gap-1.5">
              {clips.map((c, i) => (
                <li
                  key={`${c.start}-${c.end}-${i}`}
                  className="flex items-start gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-2"
                >
                  <input
                    type="checkbox"
                    className="checkbox mt-1"
                    checked={selected.includes(i)}
                    aria-label={tf("clips.select-aria", { title: c.title })}
                    onChange={() => toggle(i)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-xs text-[var(--text-muted)]">
                        {clock(c.start)} - {clock(c.end)} (
                        {Math.round(c.end - c.start)}s)
                      </span>
                      <span className="chip">
                        {tf("clips.score", { score: c.score })}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[13px] font-semibold leading-snug">
                      {c.title}
                    </p>
                    {c.hook && (
                      <p className="line-clamp-2 text-xs leading-snug text-[var(--text-muted)]">
                        {c.hook}
                      </p>
                    )}
                    {c.reason && (
                      <p className="line-clamp-2 text-xs leading-snug text-[var(--text-muted)]">
                        {c.reason}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="checkbox mt-0.5"
                checked={autoEdit}
                onChange={(e) => setAutoEdit(e.target.checked)}
              />
              <span>
                {t("clips.auto-edit")}
                <span className="block text-[var(--text-muted)]">
                  {t("clips.auto-edit-hint")}
                </span>
              </span>
            </label>

            <div className="flex justify-end">
              <Button
                disabled={creating || selected.length === 0}
                onClick={onCreate}
              >
                {creating ? (
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Scissors size={14} strokeWidth={2} />
                )}
                {creating
                  ? t("clips.creating")
                  : tf("clips.create", { n: selected.length })}
              </Button>
            </div>
          </div>
        )}

        {createError && (
          <div className="mt-2">
            <ErrorBanner
              message={t("clips.create-error")}
              detail={createError}
            />
          </div>
        )}
        {created.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-2.5">
            <span className="text-xs font-medium text-[var(--success)]">
              {tf("clips.created", { n: created.length })}
            </span>
            {created.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="truncate text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
              >
                {p.name}
              </Link>
            ))}
            {createNote && (
              <span className="text-xs text-[var(--text-muted)]">
                {createNote}
              </span>
            )}
          </div>
        )}
      </Card>

      <Card
        title={
          <span className="inline-flex items-center gap-1.5">
            {t("clips.repurpose-title")}
            <InfoHint
              titleKey="help.repurpose.title"
              bodyKey="help.repurpose.body"
              size={14}
            />
          </span>
        }
      >
        <p className="text-xs text-[var(--text-muted)]">
          {t("clips.repurpose-desc")}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {ASPECTS.map((a) => {
            const size = REPURPOSE_SIZES[a];
            const same = isSameAspect(a, width, height);
            const active = aspect === a;
            return (
              <button
                key={a}
                type="button"
                disabled={same || repurposing}
                title={same ? t("clips.same-aspect") : undefined}
                aria-pressed={active}
                onClick={() => setAspect(a)}
                className={`flex min-w-[92px] flex-1 flex-col items-center gap-0.5 rounded-[var(--radius)] border px-3 py-2 transition-colors duration-150 ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--bg-subtle)]"
                } disabled:cursor-not-allowed disabled:opacity-45`}
              >
                <span className="text-[13px] font-semibold">{a}</span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {size.width}x{size.height}
                </span>
              </button>
            );
          })}
        </div>

        <label className="mt-3 flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          {t("clips.new-name")}
          <input
            className="input"
            value={newName}
            disabled={repurposing}
            placeholder={t("clips.new-name-placeholder")}
            onChange={(e) => setNewName(e.target.value)}
          />
        </label>

        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="checkbox"
            checked={repurposeAutoEdit}
            onChange={(e) => setRepurposeAutoEdit(e.target.checked)}
          />
          {t("clips.auto-edit")}
        </label>

        <div className="mt-3 flex justify-end">
          <Button disabled={repurposing || !aspect} onClick={onRepurpose}>
            {repurposing ? (
              <Loader2 size={14} strokeWidth={2} className="animate-spin" />
            ) : (
              <Crop size={14} strokeWidth={2} />
            )}
            {repurposing
              ? t("clips.repurpose-creating")
              : t("clips.repurpose-create")}
          </Button>
        </div>

        {repurposeError && (
          <div className="mt-2">
            <ErrorBanner
              message={t("clips.repurpose-error")}
              detail={repurposeError}
            />
          </div>
        )}
        {repurposed && (
          <p className="mt-2 flex flex-wrap items-center gap-1 text-xs">
            <span className="text-[var(--success)]">
              {t("clips.repurpose-done")}
            </span>
            <Link
              href={`/projects/${repurposed.id}`}
              className="font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
            >
              {repurposed.name}
            </Link>
          </p>
        )}
      </Card>
    </>
  );
}
