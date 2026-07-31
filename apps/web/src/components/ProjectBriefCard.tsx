"use client";

import {
  AlertTriangle,
  Check,
  ChevronUp,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Save,
  ScrollText,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  getPrompts,
  getSkills,
  updateBrief,
  type Brief,
  type MusicMode,
  type PromptTemplate,
  type SfxMode,
  type SkillMeta,
} from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { TagInput } from "@/components/TagInput";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useGeminiImageModels } from "@/components/ImageProjectForm";
import { useProviders } from "@/components/ModelPicker";
import {
  StyleSelect,
  styleDisplayName,
  useStyles,
} from "@/components/StyleSelect";

export const DEFAULT_BRIEF: Brief = {
  sourceDescription: "",
  // Khớp defaultBrief() phía server — lệch default là lưu sớm sẽ âm thầm đổi hành vi
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

export const SFX_MODE_LABEL: Record<SfxMode, string> = {
  recommended: "Dùng bộ đề xuất",
  library: "AI tự tìm trong thư viện",
  none: "Không dùng",
};

export const MUSIC_MODE_LABEL: Record<MusicMode, string> = {
  auto: "AI tự chọn theo mood",
  none: "Không dùng",
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

/** Badge Có/Không nhỏ cho tóm tắt compact. */
function YesNoBadge({ label, value }: { label: string; value: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none ${
        value
          ? "bg-[var(--success-bg)] text-[var(--success)]"
          : "bg-[var(--bg-subtle)] text-[var(--text-muted)]"
      }`}
    >
      {value ? (
        <Check size={11} strokeWidth={2.5} />
      ) : (
        <Minus size={11} strokeWidth={2.5} />
      )}
      {label}
    </span>
  );
}

export function ProjectBriefCard({
  projectId,
  brief,
  onSaved,
  onDraftChange,
  compact = false,
}: {
  projectId: string;
  brief: Brief | undefined;
  onSaved: (brief: Brief) => void;
  /** Báo bản nháp hiện tại lên parent mỗi lần gõ — modal "Bắt đầu edit" dùng giá trị này */
  onDraftChange?: (brief: Brief) => void;
  /** Chế độ gọn sau khi đã bắt đầu edit — tóm tắt chỉ đọc, bấm "Chỉnh sửa" mở form đầy đủ. */
  compact?: boolean;
}) {
  const [form, setForm] = useState<Brief>(DEFAULT_BRIEF);
  // compact: đang mở form đầy đủ in-place hay chỉ hiện tóm tắt
  const [expandedForm, setExpandedForm] = useState(false);
  const [keywordInput, setKeywordInput] = useState("");
  const [showKeywords, setShowKeywords] = useState(false);
  // Bố cục Key: false = AI tự đề xuất & sử dụng (mặc định), true = user tự chỉ định
  const [keyManual, setKeyManual] = useState(false);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Style Design — cache module-level, tên style dùng ở tóm tắt compact
  const { data: stylesData } = useStyles();

  // Ảnh minh họa AI — model Gemini lazy fetch khi user chạm select "Model vẽ"
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
    form.illustrationModel !== null &&
    !illustrationModelOptions.some((m) => m.id === form.illustrationModel);

  // Nạp giá trị từ project detail một lần khi brief về (không clobber khi đang gõ)
  const initialized = useRef(false);
  useEffect(() => {
    if (brief && !initialized.current) {
      initialized.current = true;
      const initial = { ...DEFAULT_BRIEF, ...brief };
      setForm(initial);
      // Brief đã có key chỉ định sẵn → mở chế độ "Tự chỉ định" để user thấy được
      setKeyManual(initial.mainKey.trim() !== "" || initial.relatedKeys.length > 0);
      onDraftChange?.(initial);
    }
  }, [brief, onDraftChange]);

  useEffect(() => {
    getSkills()
      .then(setSkills)
      .catch(() => setSkills([]));
    getPrompts()
      .then(setPrompts)
      .catch(() => setPrompts([]));
  }, []);

  function set<K extends keyof Brief>(key: K, value: Brief[K]) {
    setSaved(false);
    setForm((f) => {
      const next = { ...f, [key]: value };
      onDraftChange?.(next);
      return next;
    });
  }

  function addKeyword() {
    const kw = keywordInput.trim();
    if (!kw) return;
    setKeywordInput("");
    if (form.highlightKeywords.includes(kw)) return;
    set("highlightKeywords", [...form.highlightKeywords, kw]);
  }

  /** Đổ content của prompt mẫu vào ô "Yêu cầu edit" — confirm nếu sắp ghi đè. */
  function applyPrompt(id: string) {
    const p = prompts.find((x) => x.id === id);
    if (!p) return;
    if (form.notes.trim() && form.notes !== p.content) {
      const ok = window.confirm(
        `Thay nội dung "Yêu cầu edit" hiện tại bằng prompt mẫu "${p.name}"?`
      );
      if (!ok) return;
    }
    set("notes", p.content);
  }

  async function onSave() {
    // Brief thật chưa nạp về (mạng chậm/lỗi) mà lưu là ghi đè mọi thứ bằng default
    if (!initialized.current) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updateBrief(projectId, form);
      setForm({ ...DEFAULT_BRIEF, ...result });
      setSaved(true);
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // Đã có keyword chỉ định sẵn → luôn hiện danh sách, không cần bấm link mở
  const keywordsOpen = showKeywords || form.highlightKeywords.length > 0;

  // Compact + chưa bấm "Chỉnh sửa" → chỉ hiện tóm tắt chỉ đọc
  const showSummary = compact && !expandedForm;

  const summaryRowLabel = "w-24 shrink-0 pt-px text-xs text-[var(--text-muted)]";
  const summary = (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex gap-2">
        <span className={summaryRowLabel}>Mô tả gốc</span>
        <span className="min-w-0 flex-1 truncate">
          {form.sourceDescription.trim() || (
            <span className="text-[var(--text-muted)]">Chưa mô tả</span>
          )}
        </span>
      </div>
      <div className="flex gap-2">
        <span className={summaryRowLabel}>Yêu cầu edit</span>
        <span className="min-w-0 flex-1">
          {form.notes.trim() ? (
            <span className="line-clamp-2 whitespace-pre-line">
              {form.notes}
            </span>
          ) : (
            <span className="text-[var(--text-muted)]">Chưa có</span>
          )}
        </span>
      </div>
      <div className="flex gap-2">
        <span className={summaryRowLabel}>Tùy chọn</span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <YesNoBadge label="Cắt" value={form.autoCut} />
          <YesNoBadge label="Phụ đề" value={form.subtitles} />
          <YesNoBadge label="Highlight" value={form.highlightEnabled} />
          <YesNoBadge label="Bố cục Key" value={form.keyLayoutEnabled} />
          <YesNoBadge label="Minh họa AI" value={form.autoIllustrations} />
        </span>
      </div>
      <div className="flex gap-2">
        <span className={summaryRowLabel}>Style Design</span>
        <span className="min-w-0 flex-1 truncate">
          {styleDisplayName(stylesData, form.styleId)}
        </span>
      </div>
      <div className="flex gap-2">
        <span className={summaryRowLabel}>Skill</span>
        <span className="min-w-0 flex-1 truncate">
          {form.skill ?? "Để AI tự chọn"}
        </span>
      </div>
      <div className="flex gap-2">
        <span className={summaryRowLabel}>Sound effect</span>
        <span className="min-w-0 flex-1 truncate">
          {SFX_MODE_LABEL[form.sfxMode]}
        </span>
      </div>
    </div>
  );

  if (showSummary) {
    return (
      <Card
        title="Kịch bản edit (Brief)"
        actions={
          <Button
            variant="secondary"
            small
            onClick={() => setExpandedForm(true)}
          >
            <Pencil size={13} strokeWidth={2} />
            Chỉnh sửa
          </Button>
        }
      >
        {summary}
      </Card>
    );
  }

  return (
    <Card
      title="Kịch bản edit (Brief)"
      actions={
        compact ? (
          <Button
            variant="secondary"
            small
            onClick={() => setExpandedForm(false)}
          >
            <ChevronUp size={13} strokeWidth={2} />
            Thu gọn
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {error && (
          <ErrorBanner message="Không lưu được brief." detail={error} />
        )}

        {/* 1. Mô tả video gốc */}
        <div>
          <FieldLabel
            htmlFor="brief-source"
            label="Mô tả video gốc"
            hint="Cho AI biết bối cảnh: video quay gì, ai nói, nói về chủ đề gì."
          />
          <textarea
            id="brief-source"
            className="input"
            rows={3}
            value={form.sourceDescription}
            onChange={(e) => set("sourceDescription", e.target.value)}
            placeholder="vd: Clip talking-head tôi nói về 3 sai lầm khi chạy quảng cáo, ~90 giây, quay dọc"
          />
        </div>

        {/* 2. Yêu cầu edit (prompt) — nội dung chính gửi AI */}
        <div>
          <FieldLabel
            htmlFor="brief-notes"
            label="Yêu cầu edit (prompt)"
            hint="Nội dung chính gửi cho AI — mô tả bạn muốn video được edit thế nào."
          />
          <div className="mb-1.5 flex items-center gap-2">
            <select
              className="input h-8 flex-1 text-[13px]"
              value=""
              onChange={(e) => applyPrompt(e.target.value)}
              aria-label="Dùng prompt mẫu"
            >
              <option value="" disabled>
                {prompts.length > 0
                  ? "Dùng prompt mẫu…"
                  : "Chưa có prompt mẫu nào"}
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
              Quản lý prompt
            </Link>
          </div>
          <textarea
            id="brief-notes"
            className="input"
            rows={6}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="vd: Edit theo phong cách Noti TikTok — chữ động nhấn ý chính, phụ đề karaoke, giữ tông chuyên nghiệp, chèn b-roll khi nhắc tới sản phẩm…"
          />
        </div>

        {/* 3. Các toggle tính năng */}
        <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
          <Switch
            id="brief-autocut"
            checked={form.autoCut}
            onChange={(v) => set("autoCut", v)}
            label="Tự động cắt ngắn video"
            hint="AI cắt bỏ khoảng lặng, đoạn thừa"
          />
          <Switch
            id="brief-subtitles"
            checked={form.subtitles}
            onChange={(v) => set("subtitles", v)}
            label="Tạo phụ đề"
            hint="Phụ đề karaoke theo giọng nói"
          />
          <Switch
            id="brief-highlight"
            checked={form.highlightEnabled}
            onChange={(v) => set("highlightEnabled", v)}
            label="Làm nổi bật key chính"
            hint="AI tự phân tích nội dung và chọn keyword để highlight"
          />
          {/* Nâng cao: chỉ định thêm keyword — chỉ hiện khi toggle BẬT */}
          {form.highlightEnabled && (
            <div className="border-t border-[var(--border)] pt-2.5">
              {!keywordsOpen ? (
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
                  onClick={() => setShowKeywords(true)}
                >
                  <Plus size={13} strokeWidth={2} />
                  Chỉ định thêm keyword (tùy chọn)
                </button>
              ) : (
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]"
                    htmlFor="brief-keyword"
                  >
                    Keyword chỉ định thêm (tùy chọn) — AI vẫn tự chọn thêm
                  </label>
                  {form.highlightKeywords.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {form.highlightKeywords.map((kw) => (
                        <span key={kw} className="chip">
                          {kw}
                          <button
                            type="button"
                            aria-label={`Xóa keyword ${kw}`}
                            className="text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--danger)]"
                            onClick={() =>
                              set(
                                "highlightKeywords",
                                form.highlightKeywords.filter((k) => k !== kw)
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
                    placeholder="Gõ keyword rồi Enter để thêm…"
                  />
                </div>
              )}
            </div>
          )}
          <Switch
            id="brief-key-layout"
            checked={form.keyLayoutEnabled}
            onChange={(v) => set("keyLayoutEnabled", v)}
            label="Bố cục Key chính / Key liên quan"
            hint="Key chính hiện ở vùng TRÊN video, các key liên quan hiện ở vùng DƯỚI theo nội dung đang nói"
          />
          {/* Chế độ chọn key — chỉ hiện khi toggle BẬT */}
          {form.keyLayoutEnabled && (
            <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-2.5">
              <div className="flex gap-1.5" role="radiogroup" aria-label="Cách chọn key">
                {(
                  [
                    [false, "AI tự đề xuất & sử dụng"],
                    [true, "Tự chỉ định key"],
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
                        set("mainKey", "");
                        set("relatedKeys", []);
                      }
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {!keyManual ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Không cần điền gì — AI tự phân tích nội dung video, đề xuất key
                  chính + 3–6 key liên quan và tự dùng đúng thời điểm.
                </p>
              ) : (
                <>
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]"
                      htmlFor="brief-main-key"
                    >
                      Key chính
                    </label>
                    <input
                      id="brief-main-key"
                      className="input h-8 text-[13px]"
                      value={form.mainKey}
                      onChange={(e) => set("mainKey", e.target.value)}
                      placeholder="vd: MCP chính thức của TikTok"
                    />
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      AI dùng NGUYÊN VĂN key này. Bỏ trống thì AI vẫn tự chọn.
                    </p>
                  </div>
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]"
                      htmlFor="brief-related-keys"
                    >
                      Key liên quan
                    </label>
                    <TagInput
                      id="brief-related-keys"
                      tags={form.relatedKeys}
                      onChange={(tags) => set("relatedKeys", tags)}
                      placeholder="Gõ key rồi Enter để thêm…"
                    />
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      AI bắt buộc dùng đủ các key này, đúng lúc nội dung nhắc tới.
                      Bỏ trống thì AI tự chọn 3–6 key.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
          <Switch
            id="brief-illustrations"
            checked={form.autoIllustrations}
            onChange={(v) => set("autoIllustrations", v)}
            label="Ảnh minh họa AI (Gemini)"
            hint="Claude tự chọn ý chính trong video, Gemini vẽ minh họa đồng bộ Style Design rồi ghép vào (~$0.05/ảnh)"
          />
          {/* Chọn model vẽ — chỉ hiện khi toggle BẬT */}
          {form.autoIllustrations && (
            <div className="border-t border-[var(--border)] pt-2.5">
              <label
                className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]"
                htmlFor="brief-illustration-model"
              >
                Model vẽ
              </label>
              <select
                id="brief-illustration-model"
                className="input h-8 text-[13px]"
                value={form.illustrationModel ?? ""}
                onFocus={loadIllustrationModels}
                onChange={(e) =>
                  set("illustrationModel", e.target.value || null)
                }
              >
                <option value="">Mặc định (Nano Banana 2)</option>
                {illustrationModelMissing && (
                  <option value={form.illustrationModel!}>
                    {form.illustrationModel}
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
                  Đang tải model…
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
                  checked={form.illustrationText}
                  onChange={(e) => set("illustrationText", e.target.checked)}
                />
                <span>
                  Ảnh có chữ (Gemini tự vẽ chữ vào ảnh)
                  <span className="block text-xs font-normal text-[var(--text-muted)]">
                    Tắt = ảnh nền sạch, chữ do hệ thống đặt (không lỗi chính
                    tả). Bật = chữ nằm trong ảnh, bám nội dung hơn — AI sẽ tự
                    kiểm chính tả.
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
                  Cần GEMINI_API_KEY (tab Kết nối) — nếu thiếu, AI sẽ bỏ qua
                  phần minh họa.
                </p>
              )}
            </div>
          )}
        </div>

        {/* 4. Style Design — NGAY TRÊN Skill, sản phẩm cưỡng chế theo style */}
        <div>
          <FieldLabel
            htmlFor="brief-style"
            label="Style Design"
            hint="Sản phẩm bắt buộc tuân theo style này 100% — ghi đè mọi quy định màu/font trong skill/prompt."
          />
          <StyleSelect
            id="brief-style"
            value={form.styleId}
            onChange={(v) => set("styleId", v)}
          />
        </div>

        {/* 5. Skill */}
        <div>
          <FieldLabel
            htmlFor="brief-skill"
            label="Skill dùng để edit"
            hint="Quy trình/phong cách edit đã lưu sẵn — để trống thì AI tự chọn skill phù hợp."
          />
          <select
            id="brief-skill"
            className="input"
            value={form.skill ?? ""}
            onChange={(e) => set("skill", e.target.value || null)}
          >
            <option value="">Để AI tự chọn</option>
            {skills.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
                {s.description
                  ? ` — ${s.description.length > 60 ? `${s.description.slice(0, 60)}…` : s.description}`
                  : ""}
              </option>
            ))}
          </select>
        </div>

        {/* 6. Sound effect */}
        <div>
          <FieldLabel
            label="Sound effect"
            hint="Âm thanh hiệu ứng (whoosh, pop…) AI chèn theo nhịp video."
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
                  checked={form.sfxMode === mode}
                  onChange={() => set("sfxMode", mode)}
                />
                {SFX_MODE_LABEL[mode]}
              </label>
            ))}
          </div>

          {/* Nhạc nền — thư viện assets/music/, AI duck tự động khi có thoại */}
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <FieldLabel
              label="Nhạc nền"
              hint="AI chọn một bài trong thư viện Nhạc nền hợp mood nội dung, tự giảm âm lượng (duck) khi có thoại."
            />
            <div
              className="flex flex-col gap-1.5"
              role="radiogroup"
              aria-label="Nhạc nền"
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
                    checked={form.musicMode === mode}
                    onChange={() => set("musicMode", mode)}
                  />
                  {MUSIC_MODE_LABEL[mode]}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={onSave} disabled={saving || !brief}>
            <Save size={15} strokeWidth={2} />
            {saving ? "Đang lưu…" : "Lưu brief"}
          </Button>
          {saved && (
            <span className="text-sm font-medium text-[var(--success)]">
              Đã lưu brief.
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
