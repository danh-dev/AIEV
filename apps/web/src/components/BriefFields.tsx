"use client";

/**
 * Toàn bộ các TRƯỜNG NHẬP của "Kịch bản edit" (Brief), tách khỏi ProjectBriefCard
 * để dùng lại được ở nơi khác - hiện có: Videos Project (một project) và Auto cut
 * videos (một lần cấu hình cho cả phiên cắt, áp cho mọi video con).
 *
 * Component này KHÔNG biết gì về project/phiên: nó chỉ nhận `value` + báo `onChange`.
 * Chỗ nào lưu, lưu đi đâu là việc của component cha.
 */

import { AlertTriangle, Loader2, Plus, ScrollText, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getPrompts,
  getSkills,
  type Brief,
  type MusicMode,
  type PromptTemplate,
  type SfxMode,
  type SkillMeta,
} from "@/lib/api";
import { TagInput } from "@/components/TagInput";
import { useGeminiImageModels } from "@/components/ImageProjectForm";
import { useProviders } from "@/components/ModelPicker";
import { StyleSelect } from "@/components/StyleSelect";
import { useT } from "@/lib/i18n";

export const DEFAULT_BRIEF: Brief = {
  sourceDescription: "",
  // Khớp defaultBrief() phía server - lệch default là lưu sớm sẽ âm thầm đổi hành vi
  autoCut: true,
  subtitles: true,
  highlightEnabled: true,
  highlightKeywords: [],
  keyLayoutEnabled: true,
  mainKey: "",
  relatedKeys: [],
  skill: null,
  sfxMode: "recommended",
  musicMode: "auto",
  notes: "",
  autoIllustrations: false,
  illustrationModel: null,
  illustrationText: false,
  styleId: null,
};

// Giá trị là KEY dictionary - dịch bằng t() lúc render.
export const SFX_MODE_LABEL: Record<SfxMode, string> = {
  recommended: "brief.sfx.recommended",
  library: "brief.sfx.library",
  none: "brief.sfx.none",
};

export const MUSIC_MODE_LABEL: Record<MusicMode, string> = {
  auto: "brief.music.auto",
  none: "brief.music.none",
};

function Switch({
  checked,
  onChange,
  label,
  hint,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  id: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
        </label>
        {hint && (
          <p className="text-xs text-[var(--text-muted)]">{hint}</p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="switch"
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

/** Label + dòng phụ giải thích cho một field của brief. */
function FieldLabel({
  htmlFor,
  label,
  hint,
}: {
  htmlFor?: string;
  label: string;
  hint: string;
}) {
  const cls = "block text-sm font-medium text-[var(--text)]";
  return (
    <div className="mb-1.5">
      {htmlFor ? (
        <label className={cls} htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className={cls}>{label}</span>
      )}
      <p className="text-xs text-[var(--text-muted)]">{hint}</p>
    </div>
  );
}

export function BriefFields({
  value,
  onChange,
  show,
  disabled = false,
}: {
  value: Brief;
  /** Chỉ gửi phần vừa đổi - cha tự merge để không nuốt thay đổi song song. */
  onChange: (patch: Partial<Brief>) => void;
  /** Ẩn bớt trường không hợp ngữ cảnh - Auto cut ẩn "styleId" và "sourceDescription". */
  show?: { styleId?: boolean; sourceDescription?: boolean };
  /** Khóa toàn bộ form (vd phiên cắt đang chạy) - fieldset tự khóa mọi control con. */
  disabled?: boolean;
}) {
  const { t, tf } = useT();
  const showStyle = show?.styleId ?? true;
  const showSource = show?.sourceDescription ?? true;

  const [keywordInput, setKeywordInput] = useState("");
  const [showKeywords, setShowKeywords] = useState(false);
  // Bố cục Key: false = AI tự đề xuất & sử dụng (mặc định), true = user tự chỉ định
  const [keyManual, setKeyManual] = useState(
    () => value.mainKey.trim() !== "" || value.relatedKeys.length > 0
  );
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);

  // Ảnh minh họa AI - model Gemini lazy fetch khi user chạm select "Model vẽ"
  const { providers } = useProviders();
  const gemini = providers?.find((p) => p.id === "gemini");
  // providers chưa về → chưa kết luận được, không nháy cảnh báo
  const geminiConnected = providers ? (gemini?.connected ?? false) : true;
  const {
    models: liveIllustrationModels,
    loading: illustrationModelsLoading,
    load: loadIllustrationModels,
  } = useGeminiImageModels();
  // Chưa fetch live → tạm dùng danh sách tĩnh từ /api/providers
  const illustrationModelOptions = liveIllustrationModels ?? gemini?.models ?? [];
  // Model đã lưu không (chưa) nằm trong danh sách → vẫn hiển thị bằng id thô
  const illustrationModelMissing =
    value.illustrationModel !== null &&
    !illustrationModelOptions.some((m) => m.id === value.illustrationModel);

  useEffect(() => {
    getSkills()
      .then(setSkills)
      .catch(() => setSkills([]));
    getPrompts()
      .then(setPrompts)
      .catch(() => setPrompts([]));
  }, []);

  // Brief nạp về sau khi mount (fetch xong) mà đã có key chỉ định sẵn → mở chế độ
  // "Tự chỉ định" để user thấy được. Không set false ở chiều ngược lại: xóa hết key
  // trong lúc đang nhập không được phép hất user về chế độ AI.
  useEffect(() => {
    if (value.mainKey.trim() !== "" || value.relatedKeys.length > 0) {
      setKeyManual(true);
    }
  }, [value.mainKey, value.relatedKeys]);

  function set<K extends keyof Brief>(key: K, v: Brief[K]) {
    onChange({ [key]: v } as Partial<Brief>);
  }

  function addKeyword() {
    const kw = keywordInput.trim();
    if (!kw) return;
    setKeywordInput("");
    if (value.highlightKeywords.includes(kw)) return;
    set("highlightKeywords", [...value.highlightKeywords, kw]);
  }

  /** Đổ content của prompt mẫu vào ô "Yêu cầu edit" - confirm nếu sắp ghi đè. */
  function applyPrompt(id: string) {
    const p = prompts.find((x) => x.id === id);
    if (!p) return;
    if (value.notes.trim() && value.notes !== p.content) {
      const ok = window.confirm(
        tf("brief.apply-prompt-confirm", { name: p.name })
      );
      if (!ok) return;
    }
    set("notes", p.content);
  }

  // Đã có keyword chỉ định sẵn → luôn hiện danh sách, không cần bấm link mở
  const keywordsOpen = showKeywords || value.highlightKeywords.length > 0;

  return (
    <fieldset
      disabled={disabled}
      className={`flex flex-col gap-5 ${disabled ? "opacity-60" : ""}`}
    >
      {/* 1. Mô tả video gốc */}
      {showSource && (
        <div>
          <FieldLabel
            htmlFor="brief-source"
            label={t("brief.source-label")}
            hint={t("brief.source-hint")}
          />
          <textarea
            id="brief-source"
            className="input"
            rows={3}
            value={value.sourceDescription}
            onChange={(e) => set("sourceDescription", e.target.value)}
            placeholder={t("brief.source-placeholder")}
          />
        </div>
      )}

      {/* 2. Yêu cầu edit (prompt) - nội dung chính gửi AI */}
      <div>
        <FieldLabel
          htmlFor="brief-notes"
          label={t("brief.notes-label")}
          hint={t("brief.notes-hint")}
        />
        <div className="mb-1.5 flex items-center gap-2">
          <select
            className="input h-8 flex-1 text-[13px]"
            value=""
            onChange={(e) => applyPrompt(e.target.value)}
            aria-label={t("brief.use-prompt-aria")}
          >
            <option value="" disabled>
              {prompts.length > 0
                ? t("brief.use-prompt")
                : t("brief.no-prompts")}
            </option>
            {prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Link
            href="/prompts"
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
          >
            <ScrollText size={13} strokeWidth={2} />
            {t("brief.manage-prompts")}
          </Link>
        </div>
        <textarea
          id="brief-notes"
          className="input"
          rows={6}
          value={value.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder={t("brief.notes-placeholder")}
        />
      </div>

      {/* 3. Các toggle tính năng */}
      <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
        <Switch
          id="brief-autocut"
          checked={value.autoCut}
          onChange={(v) => set("autoCut", v)}
          label={t("brief.autocut-label")}
          hint={t("brief.autocut-hint")}
        />
        <Switch
          id="brief-subtitles"
          checked={value.subtitles}
          onChange={(v) => set("subtitles", v)}
          label={t("brief.subtitles-label")}
          hint={t("brief.subtitles-hint")}
        />
        <Switch
          id="brief-highlight"
          checked={value.highlightEnabled}
          onChange={(v) => set("highlightEnabled", v)}
          label={t("brief.highlight")}
          hint={t("brief.highlight-hint")}
        />
        {/* Nâng cao: chỉ định thêm keyword - chỉ hiện khi toggle BẬT */}
        {value.highlightEnabled && (
          <div className="border-t border-[var(--border)] pt-2.5">
            {!keywordsOpen ? (
              <button
                type="button"
                className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                onClick={() => setShowKeywords(true)}
              >
                <Plus size={13} strokeWidth={2} />
                {t("brief.add-keywords")}
              </button>
            ) : (
              <div>
                <label
                  className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]"
                  htmlFor="brief-keyword"
                >
                  {t("brief.keywords-label")}
                </label>
                {value.highlightKeywords.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {value.highlightKeywords.map((kw) => (
                      <span key={kw} className="chip">
                        {kw}
                        <button
                          type="button"
                          aria-label={tf("brief.remove-keyword-aria", { keyword: kw })}
                          className="text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--danger)]"
                          onClick={() =>
                            set(
                              "highlightKeywords",
                              value.highlightKeywords.filter((k) => k !== kw)
                            )
                          }
                        >
                          <X size={12} strokeWidth={2} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  id="brief-keyword"
                  className="input h-8 text-[13px]"
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addKeyword();
                    }
                  }}
                  placeholder={t("brief.keyword-placeholder")}
                />
              </div>
            )}
          </div>
        )}
        <Switch
          id="brief-key-layout"
          checked={value.keyLayoutEnabled}
          onChange={(v) => set("keyLayoutEnabled", v)}
          label={t("brief.key-layout-label")}
          hint={t("brief.key-layout-hint")}
        />
        {/* Chế độ chọn key - chỉ hiện khi toggle BẬT */}
        {value.keyLayoutEnabled && (
          <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-2.5">
            <div className="flex gap-1.5" role="radiogroup" aria-label={t("brief.key-mode-aria")}>
              {(
                [
                  [false, "brief.key-auto"],
                  [true, "brief.key-manual"],
                ] as const
              ).map(([manual, label]) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={keyManual === manual}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    keyManual === manual
                      ? "border-[var(--primary)] bg-[var(--primary-soft)] font-medium text-[var(--primary)]"
                      : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
                  }`}
                  onClick={() => {
                    setKeyManual(manual);
                    if (!manual) {
                      // Về chế độ AI: xóa key đã chỉ định để AI toàn quyền đề xuất
                      onChange({ mainKey: "", relatedKeys: [] });
                    }
                  }}
                >
                  {t(label)}
                </button>
              ))}
            </div>
            {!keyManual ? (
              <p className="text-xs text-[var(--text-muted)]">
                {t("brief.key-auto-desc")}
              </p>
            ) : (
              <>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]"
                    htmlFor="brief-main-key"
                  >
                    {t("brief.main-key")}
                  </label>
                  <input
                    id="brief-main-key"
                    className="input h-8 text-[13px]"
                    value={value.mainKey}
                    onChange={(e) => set("mainKey", e.target.value)}
                    placeholder={t("brief.main-key-placeholder")}
                  />
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {t("brief.main-key-hint")}
                  </p>
                </div>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]"
                    htmlFor="brief-related-keys"
                  >
                    {t("brief.related-keys")}
                  </label>
                  <TagInput
                    id="brief-related-keys"
                    tags={value.relatedKeys}
                    onChange={(tags) => set("relatedKeys", tags)}
                    placeholder={t("brief.related-keys-placeholder")}
                  />
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {t("brief.related-keys-hint")}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
        <Switch
          id="brief-illustrations"
          checked={value.autoIllustrations}
          onChange={(v) => set("autoIllustrations", v)}
          label={t("brief.illustrations-label")}
          hint={t("brief.illustrations-hint")}
        />
        {/* Chọn model vẽ - chỉ hiện khi toggle BẬT */}
        {value.autoIllustrations && (
          <div className="border-t border-[var(--border)] pt-2.5">
            <label
              className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]"
              htmlFor="brief-illustration-model"
            >
              {t("brief.illustration-model")}
            </label>
            <select
              id="brief-illustration-model"
              className="input h-8 text-[13px]"
              value={value.illustrationModel ?? ""}
              onFocus={loadIllustrationModels}
              onChange={(e) =>
                set("illustrationModel", e.target.value || null)
              }
            >
              <option value="">{t("images.model-default")}</option>
              {illustrationModelMissing && (
                <option value={value.illustrationModel!}>
                  {value.illustrationModel}
                </option>
              )}
              {illustrationModelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {illustrationModelsLoading && (
              <p className="mt-1 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                <Loader2
                  size={12}
                  strokeWidth={2}
                  className="animate-spin"
                />
                {t("images.loading-models")}
              </p>
            )}
            <label
              className="mt-2.5 flex cursor-pointer items-start gap-2 text-sm"
              htmlFor="brief-illustration-text"
            >
              <input
                id="brief-illustration-text"
                type="checkbox"
                className="mt-0.5 accent-[var(--primary)]"
                checked={value.illustrationText}
                onChange={(e) => set("illustrationText", e.target.checked)}
              />
              <span>
                {t("brief.illustration-text")}
                <span className="block text-xs font-normal text-[var(--text-muted)]">
                  {t("brief.illustration-text-hint")}
                </span>
              </span>
            </label>
            {!geminiConnected && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-[var(--danger)]">
                <AlertTriangle
                  size={13}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0"
                />
                {t("brief.gemini-warning")}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 4. Style Design - NGAY TRÊN Skill, sản phẩm cưỡng chế theo style */}
      {showStyle && (
        <div>
          <FieldLabel
            htmlFor="brief-style"
            label="Style Design"
            hint={t("brief.style-hint")}
          />
          <StyleSelect
            id="brief-style"
            value={value.styleId}
            onChange={(v) => set("styleId", v)}
          />
        </div>
      )}

      {/* 5. Skill */}
      <div>
        <FieldLabel
          htmlFor="brief-skill"
          label={t("brief.skill-label")}
          hint={t("brief.skill-hint")}
        />
        <select
          id="brief-skill"
          className="input"
          value={value.skill ?? ""}
          onChange={(e) => set("skill", e.target.value || null)}
        >
          <option value="">{t("brief.ai-pick-skill")}</option>
          {skills.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
              {s.description
                ? ` - ${s.description.length > 60 ? `${s.description.slice(0, 60)}…` : s.description}`
                : ""}
            </option>
          ))}
        </select>
      </div>

      {/* 6. Sound effect */}
      <div>
        <FieldLabel
          label="Sound effect"
          hint={t("brief.sfx-hint")}
        />
        <div className="flex flex-col gap-1.5">
          {(Object.keys(SFX_MODE_LABEL) as SfxMode[]).map((mode) => (
            <label
              key={mode}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="radio"
                name="brief-sfx-mode"
                className="accent-[var(--primary)]"
                checked={value.sfxMode === mode}
                onChange={() => set("sfxMode", mode)}
              />
              {t(SFX_MODE_LABEL[mode])}
            </label>
          ))}
        </div>

        {/* Nhạc nền - thư viện assets/music/, AI duck tự động khi có thoại */}
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <FieldLabel
            label={t("brief.music-label")}
            hint={t("brief.music-hint")}
          />
          <div
            className="flex flex-col gap-1.5"
            role="radiogroup"
            aria-label={t("brief.music-label")}
          >
            {(Object.keys(MUSIC_MODE_LABEL) as MusicMode[]).map((mode) => (
              <label
                key={mode}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="radio"
                  name="brief-music-mode"
                  className="accent-[var(--primary)]"
                  checked={value.musicMode === mode}
                  onChange={() => set("musicMode", mode)}
                />
                {t(MUSIC_MODE_LABEL[mode])}
              </label>
            ))}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
