"use client";

/**
 * Modal "Tạo skill bằng AI" - 2 bước:
 * 1. Form brief (mục đích, nền tảng, khung, fps, phụ đề…) → POST
 *    /api/skills/generate (gọi thẳng server origin, có thể chạy 1–3 phút).
 * 2. Duyệt draft: sửa tên + nội dung SKILL.md rồi lưu qua POST /api/skills.
 *
 * Lỗi 422 BAD_SKILL_OUTPUT (AI trả sai định dạng) → nhảy sang bước 2 với
 * content = raw để user tự sửa tay, kèm cảnh báo.
 */

import { ArrowLeft, RefreshCw, Save, Sparkles } from "lucide-react";
import { useState } from "react";
import {
  ApiError,
  createSkill,
  generateSkill,
  SkillGenerateError,
  type SkillGenerateInput,
  type SkillMeta,
} from "@/lib/api";
import { Button } from "@/components/Button";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { formatTokens, KEBAB_RE } from "@/lib/format";
import { useT } from "@/lib/i18n";

const PLATFORM_OPTIONS = [
  "TikTok",
  "YouTube",
  "Facebook",
  "Instagram",
  "Khác",
] as const;

const ASPECT_OPTIONS = ["9:16", "16:9", "1:1", "4:5"] as const;
type AspectOption = (typeof ASPECT_OPTIONS)[number];

const FPS_OPTIONS = [30, 60] as const;

// label là KEY dictionary - dịch bằng t() lúc render.
const CAPTION_OPTIONS: {
  value: "karaoke" | "sentence" | "none";
  label: string;
}[] = [
  { value: "karaoke", label: "skillGen.caption.karaoke" },
  { value: "sentence", label: "skillGen.caption.sentence" },
  { value: "none", label: "skillGen.caption.none" },
];

/** Giá trị "không dùng skill mẫu" trong select baseSkill. */
const NO_BASE = "";

/** Skill mẫu gợi ý mặc định nếu tồn tại trong danh sách. */
const SUGGESTED_BASE = "noti-tiktok-vn";

interface FormState {
  goal: string;
  platform: (typeof PLATFORM_OPTIONS)[number];
  aspect: AspectOption;
  fps: 30 | 60;
  duration: string;
  style: string;
  captions: "karaoke" | "sentence" | "none";
  highlights: boolean;
  sfx: boolean;
  baseSkill: string;
  name: string;
  notes: string;
}

function initialForm(skills: SkillMeta[]): FormState {
  return {
    goal: "",
    platform: "TikTok",
    aspect: "9:16",
    fps: 30,
    duration: "",
    style: "",
    captions: "karaoke",
    highlights: true,
    sfx: true,
    baseSkill: skills.some((s) => s.name === SUGGESTED_BASE)
      ? SUGGESTED_BASE
      : NO_BASE,
    name: "",
    notes: "",
  };
}

function toInput(f: FormState): SkillGenerateInput {
  return {
    goal: f.goal.trim(),
    ...(f.name.trim() ? { name: f.name.trim() } : {}),
    ...(f.platform !== "Khác" ? { platform: f.platform } : {}),
    aspect: f.aspect,
    fps: f.fps,
    ...(f.duration.trim() ? { duration: f.duration.trim() } : {}),
    ...(f.style.trim() ? { style: f.style.trim() } : {}),
    captions: f.captions,
    highlights: f.highlights,
    sfx: f.sfx,
    ...(f.baseSkill ? { baseSkill: f.baseSkill } : {}),
    ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
  };
}

/** Nhóm nút segmented nhỏ (khung / fps) - active nền primary-soft. */
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={String(o)}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(o)}
            className={`rounded-[var(--radius)] border px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                : "border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-subtle)]"
            }`}
          >
            {String(o)}
          </button>
        );
      })}
    </div>
  );
}

export function SkillGenerateModal({
  open,
  skills,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Danh sách skill hiện có - nguồn select "Skill mẫu tham khảo". */
  skills: SkillMeta[];
  onClose: () => void;
  /** Lưu thành công - parent đóng modal, reload danh sách, điều hướng. */
  onSaved: (name: string) => void;
}) {
  const { t, tf } = useT();
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<FormState>(() => initialForm(skills));
  const [formInitialized, setFormInitialized] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Kết quả bước 2
  const [draftName, setDraftName] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftTokens, setDraftTokens] = useState<number | null>(null);
  /** true = draft là raw từ lỗi 422 - AI trả sai định dạng, user sửa tay. */
  const [fromRaw, setFromRaw] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nameConflict, setNameConflict] = useState(false);

  // Gợi ý baseSkill mặc định khi danh sách skill về sau lúc mount modal
  if (!formInitialized && skills.length > 0) {
    setFormInitialized(true);
    if (!form.baseSkill && skills.some((s) => s.name === SUGGESTED_BASE)) {
      setForm((f) => ({ ...f, baseSkill: SUGGESTED_BASE }));
    }
  }

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const goalValid = form.goal.trim().length > 0;
  const nameHintInvalid =
    form.name.trim() !== "" && !KEBAB_RE.test(form.name.trim());
  const draftNameValid = KEBAB_RE.test(draftName);

  async function onGenerate() {
    if (!goalValid || nameHintInvalid || generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await generateSkill(toInput(form));
      setDraftName(res.name);
      setDraftContent(res.content);
      setDraftTokens(res.tokens.input + res.tokens.output);
      setFromRaw(false);
      setNameConflict(false);
      setSaveError(null);
      setStep(2);
    } catch (e) {
      if (e instanceof SkillGenerateError && e.status === 422 && e.raw) {
        // AI trả sai định dạng - đưa raw cho user tự sửa rồi lưu
        setDraftName(form.name.trim());
        setDraftContent(e.raw);
        setDraftTokens(null);
        setFromRaw(true);
        setNameConflict(false);
        setSaveError(null);
        setStep(2);
      } else {
        setGenError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setGenerating(false);
    }
  }

  async function onSave() {
    if (!draftNameValid || !draftContent.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    setNameConflict(false);
    try {
      await createSkill({ name: draftName, content: draftContent });
      onSaved(draftName);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setNameConflict(true);
      } else {
        setSaveError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  }

  function close() {
    if (generating || saving) return;
    onClose();
  }

  const busy = generating || saving;

  return (
    <Modal
      wide
      title={step === 1 ? t("skills.create-ai") : t("skillGen.review-title")}
      open={open}
      onClose={close}
      footer={
        step === 1 ? (
          <>
            <Button variant="secondary" onClick={close} disabled={generating}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={onGenerate}
              disabled={!goalValid || nameHintInvalid || generating}
            >
              <Sparkles size={16} strokeWidth={2} />
              {generating ? t("common.creating") : t("skills.create-ai")}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => setStep(1)}
              disabled={busy}
            >
              <ArrowLeft size={14} strokeWidth={2} />
              {t("skillGen.edit-answers")}
            </Button>
            <Button variant="secondary" onClick={onGenerate} disabled={busy}>
              <RefreshCw size={14} strokeWidth={2} />
              {generating ? t("skillGen.regenerating") : t("skillGen.regenerate")}
            </Button>
            <Button
              onClick={onSave}
              disabled={!draftNameValid || !draftContent.trim() || busy}
            >
              <Save size={14} strokeWidth={2} />
              {saving ? t("common.saving") : t("skillGen.save")}
            </Button>
          </>
        )
      }
    >
      {step === 1 ? (
        <>
          {genError && (
            <ErrorBanner message={t("skillGen.gen-error")} detail={genError} />
          )}

          <div>
            <label className="label" htmlFor="sg-goal">
              {t("skillGen.goal-label")}
            </label>
            <textarea
              id="sg-goal"
              className="input min-h-[64px]"
              rows={3}
              disabled={generating}
              value={form.goal}
              onChange={(e) => patch({ goal: e.target.value })}
              placeholder={t("skillGen.goal-placeholder")}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="sg-platform">
                {t("skillGen.platform")}
              </label>
              <select
                id="sg-platform"
                className="input"
                disabled={generating}
                value={form.platform}
                onChange={(e) =>
                  patch({ platform: e.target.value as FormState["platform"] })
                }
              >
                {PLATFORM_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p === "Khác" ? t("projects.other") : p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="sg-duration">
                {t("skillGen.duration")}
              </label>
              <input
                id="sg-duration"
                className="input"
                disabled={generating}
                value={form.duration}
                onChange={(e) => patch({ duration: e.target.value })}
                placeholder="30–60s"
              />
            </div>
            <div>
              <span className="label">{t("skillGen.aspect")}</span>
              <Segmented
                options={ASPECT_OPTIONS}
                value={form.aspect}
                disabled={generating}
                ariaLabel={t("skillGen.aspect")}
                onChange={(aspect) => patch({ aspect })}
              />
            </div>
            <div>
              <span className="label">FPS</span>
              <Segmented
                options={FPS_OPTIONS}
                value={form.fps}
                disabled={generating}
                ariaLabel="FPS"
                onChange={(fps) => patch({ fps })}
              />
            </div>
            <div>
              <label className="label" htmlFor="sg-style">
                {t("skillGen.style")}
              </label>
              <input
                id="sg-style"
                className="input"
                disabled={generating}
                value={form.style}
                onChange={(e) => patch({ style: e.target.value })}
                placeholder={t("skillGen.style-placeholder")}
              />
            </div>
            <div>
              <label className="label" htmlFor="sg-captions">
                {t("brief.subtitles")}
              </label>
              <select
                id="sg-captions"
                className="input"
                disabled={generating}
                value={form.captions}
                onChange={(e) =>
                  patch({ captions: e.target.value as FormState["captions"] })
                }
              >
                {CAPTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.label)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="sg-base">
                {t("skillGen.base")}
              </label>
              <select
                id="sg-base"
                className="input"
                disabled={generating}
                value={form.baseSkill}
                onChange={(e) => patch({ baseSkill: e.target.value })}
              >
                <option value={NO_BASE}>{t("skillGen.no-base")}</option>
                {skills.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="sg-name">
                {t("skillGen.name-label")}
              </label>
              <input
                id="sg-name"
                className="input"
                disabled={generating}
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="vd: tiktok-review-congnghe"
              />
              {nameHintInvalid ? (
                <p className="mt-1 text-xs text-[var(--danger)]">
                  {t("skills.kebab-error")}
                </p>
              ) : (
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {t("skillGen.name-hint")}
                </p>
              )}
            </div>
            <div className="flex flex-col justify-end gap-2">
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  className="checkbox"
                  disabled={generating}
                  checked={form.highlights}
                  onChange={(e) => patch({ highlights: e.target.checked })}
                />
                <span className="text-sm">Keyword highlight</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  className="checkbox"
                  disabled={generating}
                  checked={form.sfx}
                  onChange={(e) => patch({ sfx: e.target.checked })}
                />
                <span className="text-sm">
                  {t("skillGen.sfx-sync")}
                </span>
              </label>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="sg-notes">
              {t("skillGen.notes")}
            </label>
            <textarea
              id="sg-notes"
              className="input min-h-[48px]"
              rows={2}
              disabled={generating}
              value={form.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder={t("skillGen.notes-placeholder")}
            />
          </div>

          {generating && (
            <div className="flex flex-col gap-1.5 rounded-[var(--radius)] bg-[var(--bg-subtle)] px-3 py-2.5">
              <div
                className="progress-indeterminate"
                aria-label={t("skillGen.generating-aria")}
              />
              <p className="text-xs text-[var(--text-muted)]">
                {t("skillGen.generating")}
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          {fromRaw && (
            <ErrorBanner message={t("skillGen.bad-format")} />
          )}
          {saveError && (
            <ErrorBanner message={t("skillGen.save-error")} detail={saveError} />
          )}

          <div>
            <label className="label" htmlFor="sg-draft-name">
              {t("skillGen.draft-name")}
            </label>
            <input
              id="sg-draft-name"
              className="input"
              disabled={busy}
              value={draftName}
              onChange={(e) => {
                setDraftName(e.target.value);
                setNameConflict(false);
              }}
              placeholder="ten-skill-kebab-case"
            />
            {nameConflict ? (
              <p className="mt-1 text-xs text-[var(--danger)]">
                {t("skillGen.name-conflict")}
              </p>
            ) : (
              draftName &&
              !draftNameValid && (
                <p className="mt-1 text-xs text-[var(--danger)]">
                  {t("skills.kebab-error")}
                </p>
              )
            )}
          </div>

          <div>
            <label className="label" htmlFor="sg-draft-content">
              {t("skillGen.content-label")}
            </label>
            <textarea
              id="sg-draft-content"
              className="input max-h-[max(420px,calc(90vh-320px))] min-h-[420px] font-mono text-xs leading-relaxed"
              disabled={busy}
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              spellCheck={false}
            />
          </div>

          {draftTokens !== null && (
            <p className="text-xs text-[var(--text-muted)]">
              {tf("skillGen.tokens-used", { n: formatTokens(draftTokens) })}
            </p>
          )}

          {generating && (
            <div className="flex flex-col gap-1.5 rounded-[var(--radius)] bg-[var(--bg-subtle)] px-3 py-2.5">
              <div
                className="progress-indeterminate"
                aria-label={t("skillGen.regenerating-aria")}
              />
              <p className="text-xs text-[var(--text-muted)]">
                {t("skillGen.regenerating-note")}
              </p>
            </div>
          )}
          {genError && (
            <ErrorBanner message={t("skillGen.regen-error")} detail={genError} />
          )}
        </>
      )}
    </Modal>
  );
}
