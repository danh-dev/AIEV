"use client";

import {
  ArrowLeft,
  Check,
  Download,
  Image as ImageIcon,
  Loader2,
  Save,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  deleteStyle,
  deleteStyleFont,
  getStyles,
  mediaUrl,
  setDefaultStyle,
  styleFontGoogle,
  updateStyle,
  uploadStyleFont,
  uploadStyleLogo,
  type FileInfo,
  type StyleColors,
  type StyleDesign,
  type StyleEffects,
  type StyleFontSlot,
} from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { ErrorBanner } from "@/components/ErrorBanner";
import {
  MediaPreviewModal,
  ZoomableThumb,
  imageFileInfo,
} from "@/components/MediaPreviewModal";
import { PageHeader } from "@/components/PageHeader";
import { TagInput } from "@/components/TagInput";
import { refreshStyles } from "@/components/StyleSelect";
import { formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";

// label là KEY dictionary - dịch bằng t() lúc render.
const COLOR_FIELDS: { key: keyof StyleColors; label: string }[] = [
  { key: "primary", label: "styleDetail.color.primary" },
  { key: "secondary", label: "styleDetail.color.secondary" },
  { key: "background", label: "styleDetail.color.background" },
  { key: "text", label: "styleDetail.color.text" },
  { key: "accent", label: "styleDetail.color.accent" },
];

// Khớp server: chấp nhận cả hex 6 và 8 chữ số (#rrggbb / #rrggbbaa)
const HEX_RE = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
// Fallback CHỈ cho value của <input type="color"> khi hex user gõ chưa hợp lệ
// - đây là DATA brand của user, không phải màu UI (token UI nằm ở globals.css).
const COLOR_INPUT_FALLBACK = "#000000";

/** Lấy #rrggbb (6 chữ số đầu) - <input type="color"> và gradient preview
 *  cần dạng 6 chữ số, hex 8 chữ số đưa thẳng vào là đen thui/không nhận. */
function hex6(v: string): string {
  return v.slice(0, 7).toLowerCase();
}

/** Hiệu ứng mặc định cho style cũ chưa có field effects. */
const DEFAULT_EFFECTS: StyleEffects = { gradient: true, liquidGlass: true };

/** Font Google phổ biến hỗ trợ đầy đủ glyph tiếng Việt - gợi ý datalist. */
const GOOGLE_FONT_SUGGESTIONS = [
  "Be Vietnam Pro",
  "Inter",
  "Montserrat",
  "Roboto",
  "Lexend",
  "Nunito",
  "Archivo",
  "Space Grotesk",
  "Sora",
  "Manrope",
];

const FONT_SLOTS: { slot: StyleFontSlot; label: string }[] = [
  { slot: "heading", label: "styleDetail.font.heading" },
  { slot: "body", label: "styleDetail.font.body" },
];

function ColorField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const { t } = useT();
  const valid = HEX_RE.test(value);
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} ${t("styleDetail.palette-aria")}`}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-0.5"
          value={valid ? hex6(value) : COLOR_INPUT_FALLBACK}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          id={id}
          className="input h-9 flex-1 font-mono text-xs"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#rrggbb"
        />
      </div>
    </div>
  );
}

/**
 * Preview mini - dải 5 swatch + chữ mẫu trên nền style. Mọi màu ở đây là
 * DATA brand của user (inline style), không phải token UI.
 */
function StylePreview({ style }: { style: StyleDesign }) {
  const c = style.colors;
  const fx = style.effects ?? DEFAULT_EFFECTS;
  const highlightStyle: CSSProperties =
    fx.gradient && HEX_RE.test(c.primary) && HEX_RE.test(c.secondary)
      ? {
          backgroundImage: `linear-gradient(90deg, ${hex6(c.primary)}, ${hex6(c.secondary)})`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }
      : { color: c.primary };
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
      <div className="flex h-8">
        {COLOR_FIELDS.map(({ key }) => (
          <span
            key={key}
            className="flex-1"
            style={{ backgroundColor: c[key] }}
            title={`${key}: ${c[key]}`}
          />
        ))}
      </div>
      <div
        className="flex items-baseline gap-4 px-4 py-3"
        style={{ backgroundColor: c.background }}
      >
        <span
          className="text-[26px] font-bold leading-none"
          style={{ color: c.text }}
        >
          Aa Ắộ
        </span>
        <span className="text-[26px] font-bold leading-none" style={highlightStyle}>
          Aa Ắộ
        </span>
      </div>
    </div>
  );
}

export default function StyleDetailPage() {
  const params = useParams<{ id: string }>();
  const styleId = params.id;
  const router = useRouter();
  const { t, tf } = useT();

  const [style, setStyle] = useState<StyleDesign | null>(null);
  // Xem logo ở kích thước thật - logo 14px cao thì không kiểm được chất lượng
  const [preview, setPreview] = useState<FileInfo | null>(null);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [settingDefault, setSettingDefault] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Tải font từ Google theo tên - trạng thái riêng từng slot
  const [fontDl, setFontDl] = useState<
    Partial<Record<StyleFontSlot, { busy?: boolean; error?: string }>>
  >({});

  // Upload file font thủ công (collapse) - một input file dùng chung
  const [manualFontOpen, setManualFontOpen] = useState(false);
  const [fontBusy, setFontBusy] = useState<StyleFontSlot | null>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const fontSlotRef = useRef<StyleFontSlot>("heading");

  const load = useCallback(async () => {
    try {
      // Hợp đồng không có GET /api/styles/:id - lấy danh sách rồi tìm theo id
      const r = await getStyles();
      setDefaultId(r.defaultId);
      const s = r.styles.find((x) => x.id === styleId) ?? null;
      if (!s) {
        setNotFound(true);
        return;
      }
      setStyle(s);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [styleId]);

  useEffect(() => {
    load();
  }, [load]);

  function patch(p: Partial<StyleDesign>) {
    setSaved(false);
    setStyle((s) => (s ? { ...s, ...p } : s));
  }

  const effects = style?.effects ?? DEFAULT_EFFECTS;

  async function onSave() {
    if (!style || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const s = await updateStyle(styleId, {
        name: style.name,
        tags: style.tags,
        colors: style.colors,
        fonts: style.fonts,
        effects: style.effects ?? DEFAULT_EFFECTS,
        tone: style.tone,
        guidelines: style.guidelines,
      });
      setStyle(s);
      setSaved(true);
      refreshStyles();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onSetDefault() {
    if (settingDefault) return;
    setSettingDefault(true);
    setSaveError(null);
    try {
      const { defaultId: next } = await setDefaultStyle(styleId);
      setDefaultId(next);
      refreshStyles();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettingDefault(false);
    }
  }

  // Modal xác nhận xóa style - bắt gõ DELETE (thay window.confirm)
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function onDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteStyle(styleId);
      refreshStyles();
      router.push("/styles");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  async function onLogoPicked(file: File) {
    setUploadingLogo(true);
    setSaveError(null);
    try {
      const s = await uploadStyleLogo(styleId, file);
      setStyle((cur) => (cur ? { ...cur, logoPath: s.logoPath } : s));
      refreshStyles();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingLogo(false);
    }
  }

  /** Tải font từ Google Fonts theo tên đang gõ trong ô của slot. */
  async function onFontGoogle(slot: StyleFontSlot) {
    if (!style || fontDl[slot]?.busy) return;
    const family = style.fonts[slot].trim();
    if (!family) {
      setFontDl((m) => ({
        ...m,
        [slot]: { error: t("styleDetail.font-name-required") },
      }));
      return;
    }
    setFontDl((m) => ({ ...m, [slot]: { busy: true } }));
    try {
      const s = await styleFontGoogle(styleId, slot, family);
      // Chỉ merge phần server đổi - không clobber các field đang sửa dở
      setStyle((cur) =>
        cur
          ? { ...cur, fonts: s.fonts, fontFiles: s.fontFiles, updatedAt: s.updatedAt }
          : s
      );
      setFontDl((m) => ({ ...m, [slot]: {} }));
      refreshStyles();
    } catch (e) {
      setFontDl((m) => ({
        ...m,
        [slot]: { error: e instanceof Error ? e.message : String(e) },
      }));
    }
  }

  async function onFontPicked(slot: StyleFontSlot, file: File) {
    setFontBusy(slot);
    setSaveError(null);
    try {
      const s = await uploadStyleFont(styleId, slot, file);
      setStyle((cur) => (cur ? { ...cur, fontFiles: s.fontFiles } : s));
      refreshStyles();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setFontBusy(null);
    }
  }

  async function onFontRemove(slot: StyleFontSlot) {
    setFontBusy(slot);
    setSaveError(null);
    try {
      const s = await deleteStyleFont(styleId, slot);
      setStyle((cur) => (cur ? { ...cur, fontFiles: s.fontFiles } : s));
      refreshStyles();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setFontBusy(null);
    }
  }

  const isDefault = defaultId === styleId;
  const busy = saving || deleting;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={style?.name ?? styleId}
        subtitle={
          style
            ? tf("styleDetail.updated", { time: formatRelative(style.updatedAt) })
            : undefined
        }
        actions={
          <Button variant="secondary" onClick={() => router.push("/styles")}>
            <ArrowLeft size={15} strokeWidth={2} />
            {t("nav.styles")}
          </Button>
        }
      />

      {style && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
          {isDefault && (
            <span className="rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-[11px] font-medium leading-none text-[var(--primary)]">
              {t("styles.default")}
            </span>
          )}
          <span>ID: {style.id}</span>
        </div>
      )}

      {loadError && (
        <ErrorBanner message={t("styleDetail.load-error")} detail={loadError} />
      )}
      {notFound && (
        <ErrorBanner
          message={tf("styleDetail.not-found", { id: styleId })}
          detail={t("styleDetail.not-found-detail")}
        />
      )}
      {saveError && <ErrorBanner message={t("common.save-error")} detail={saveError} />}
      {deleteError && (
        <ErrorBanner message={t("styleDetail.delete-error")} detail={deleteError} />
      )}

      {style && (
        <>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {/* ============ Cột trái - Nhận diện ============ */}
            <Card title={t("styleDetail.identity")}>
              <div className="flex flex-col gap-4">
                <StylePreview style={style} />

                <div>
                  <label className="label" htmlFor="style-name">
                    {t("stylesPage.name-label")}
                  </label>
                  <input
                    id="style-name"
                    className="input"
                    value={style.name}
                    disabled={busy}
                    onChange={(e) => patch({ name: e.target.value })}
                    placeholder={t("stylesPage.name-placeholder")}
                  />
                </div>

                <div>
                  <label className="label" htmlFor="style-tags">
                    {t("common.tags")}
                  </label>
                  <TagInput
                    id="style-tags"
                    tags={style.tags}
                    onChange={(tags) => patch({ tags })}
                  />
                </div>

                <div>
                  <span className="label">{t("styleDetail.palette")}</span>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                    {COLOR_FIELDS.map(({ key, label }) => (
                      <ColorField
                        key={key}
                        id={`style-color-${key}`}
                        label={t(label)}
                        value={style.colors[key] ?? ""}
                        disabled={busy}
                        onChange={(v) =>
                          patch({ colors: { ...style.colors, [key]: v } })
                        }
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <span className="label">{t("styleDetail.effects")}</span>
                  <div className="flex flex-col gap-3">
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        className="checkbox mt-0.5"
                        checked={effects.gradient}
                        disabled={busy}
                        onChange={(e) =>
                          patch({
                            effects: { ...effects, gradient: e.target.checked },
                          })
                        }
                      />
                      <span>
                        <span className="block text-sm font-medium">
                          Gradient
                        </span>
                        <span className="block text-xs text-[var(--text-muted)]">
                          {t("styleDetail.gradient-hint")}
                        </span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        className="checkbox mt-0.5"
                        checked={effects.liquidGlass}
                        disabled={busy}
                        onChange={(e) =>
                          patch({
                            effects: {
                              ...effects,
                              liquidGlass: e.target.checked,
                            },
                          })
                        }
                      />
                      <span>
                        <span className="block text-sm font-medium">
                          Liquid Glass
                        </span>
                        <span className="block text-xs text-[var(--text-muted)]">
                          {t("styleDetail.liquid-hint")}
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </Card>

            {/* ============ Cột phải - Chữ & Logo ============ */}
            <Card title={t("styleDetail.type-logo")}>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3">
                  {FONT_SLOTS.map(({ slot, label }) => {
                    const dl = fontDl[slot];
                    const relPath = style.fontFiles?.[slot] ?? null;
                    const fileName = relPath ? relPath.split("/").pop() : null;
                    return (
                      <div key={slot}>
                        <label className="label" htmlFor={`style-font-${slot}`}>
                          {t(label)}
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id={`style-font-${slot}`}
                            className="input flex-1"
                            list="google-fonts-vn"
                            value={style.fonts[slot]}
                            disabled={busy || !!dl?.busy}
                            onChange={(e) => {
                              patch({
                                fonts: {
                                  ...style.fonts,
                                  [slot]: e.target.value,
                                },
                              });
                              // Gõ tên mới → xóa kết quả tải cũ của slot
                              setFontDl((m) => ({ ...m, [slot]: {} }));
                            }}
                            placeholder="vd: Be Vietnam Pro"
                          />
                          <Button
                            variant="secondary"
                            small
                            className="shrink-0"
                            disabled={busy || !!dl?.busy}
                            onClick={() => onFontGoogle(slot)}
                          >
                            {dl?.busy ? (
                              <Loader2
                                size={13}
                                strokeWidth={2}
                                className="animate-spin"
                              />
                            ) : (
                              <Download size={13} strokeWidth={2} />
                            )}
                            {dl?.busy ? t("styleDetail.downloading") : t("styleDetail.download-font")}
                          </Button>
                        </div>
                        {dl?.error && (
                          <p className="mt-1 text-xs text-[var(--danger)]">
                            {dl.error}
                          </p>
                        )}
                        {fileName ? (
                          <p className="mt-1 flex items-center gap-1 text-xs text-[var(--success)]">
                            <Check size={12} strokeWidth={2.5} />
                            {t("styleDetail.font-ready")} {fileName}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            {t("styleDetail.font-missing")}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  <datalist id="google-fonts-vn">
                    {GOOGLE_FONT_SUGGESTIONS.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>

                  <button
                    type="button"
                    className="self-start text-xs text-[var(--text-muted)] underline underline-offset-2 transition-colors duration-150 hover:text-[var(--text)]"
                    onClick={() => setManualFontOpen((o) => !o)}
                  >
                    {t("styleDetail.manual-upload")}
                  </button>

                  {manualFontOpen && (
                    <div className="flex flex-col gap-2">
                      {FONT_SLOTS.map(({ slot }) => {
                        const relPath = style.fontFiles?.[slot] ?? null;
                        const fileName = relPath
                          ? relPath.split("/").pop()
                          : null;
                        const label =
                          slot === "heading" ? "Heading" : "Body";
                        return (
                          <div
                            key={slot}
                            className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2"
                          >
                            <span className="w-16 shrink-0 text-[13px] font-medium">
                              {label}
                            </span>
                            <span
                              className={`min-w-0 flex-1 truncate text-[13px] ${
                                fileName ? "" : "text-[var(--text-muted)]"
                              }`}
                              title={fileName ?? undefined}
                            >
                              {fileName ?? t("styleDetail.no-font-file")}
                            </span>
                            <Button
                              variant="secondary"
                              small
                              disabled={fontBusy !== null || busy}
                              onClick={() => {
                                fontSlotRef.current = slot;
                                fontInputRef.current?.click();
                              }}
                            >
                              <Upload size={13} strokeWidth={2} />
                              {fontBusy === slot ? t("styleDetail.downloading") : t("styleDetail.upload-file")}
                            </Button>
                            {fileName && (
                              <button
                                type="button"
                                aria-label={tf("styleDetail.remove-font-aria", { label })}
                                disabled={fontBusy !== null || busy}
                                className="rounded-[var(--radius)] p-1 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg)] hover:text-[var(--danger)] disabled:opacity-50"
                                onClick={() => onFontRemove(slot)}
                              >
                                <X size={14} strokeWidth={2} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                      <input
                        ref={fontInputRef}
                        type="file"
                        accept=".ttf,.otf,.woff,.woff2"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) onFontPicked(fontSlotRef.current, f);
                          e.target.value = "";
                        }}
                      />
                    </div>
                  )}
                </div>

                <div>
                  <span className="label">Logo</span>
                  <div className="flex items-center gap-3">
                    {style.logoPath ? (
                      <ZoomableThumb
                        file={imageFileInfo(style.logoPath, {
                          name: tf("stylesPage.logo-alt", { name: style.name }),
                        })}
                        alt={tf("stylesPage.logo-alt", { name: style.name })}
                        onOpen={setPreview}
                        className="h-14 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)]"
                        imgClassName="h-full w-auto p-2"
                        iconSize={16}
                      />
                    ) : (
                      <span className="flex h-14 w-14 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)]">
                        <ImageIcon
                          size={18}
                          strokeWidth={1.5}
                          className="text-[var(--text-muted)] opacity-40"
                        />
                      </span>
                    )}
                    <Button
                      variant="secondary"
                      small
                      disabled={uploadingLogo || busy}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      <Upload size={14} strokeWidth={2} />
                      {uploadingLogo ? t("common.uploading") : t("styleDetail.upload-logo")}
                    </Button>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept=".png,.jpg,.jpeg,.svg,.webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onLogoPicked(f);
                        e.target.value = "";
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label className="label" htmlFor="style-tone">
                    Tone
                  </label>
                  <input
                    id="style-tone"
                    className="input"
                    value={style.tone}
                    disabled={busy}
                    onChange={(e) => patch({ tone: e.target.value })}
                    placeholder={t("styleDetail.tone-placeholder")}
                  />
                </div>

                <div>
                  <label className="label" htmlFor="style-guidelines">
                    Guidelines
                  </label>
                  <textarea
                    id="style-guidelines"
                    className="input"
                    rows={5}
                    value={style.guidelines}
                    disabled={busy}
                    onChange={(e) => patch({ guidelines: e.target.value })}
                    placeholder={t("styleDetail.guidelines-placeholder")}
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* Hàng hành động cuối trang */}
          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
            <Button onClick={onSave} disabled={busy}>
              <Save size={15} strokeWidth={2} />
              {saving ? t("common.saving") : t("common.save")}
            </Button>
            {!isDefault && (
              <Button
                variant="secondary"
                disabled={settingDefault || busy}
                onClick={onSetDefault}
              >
                <Star size={14} strokeWidth={2} />
                {settingDefault ? t("styleDetail.setting-default") : t("styleDetail.set-default")}
              </Button>
            )}
            {saved && (
              <span className="text-sm text-[var(--success)]">{t("common.saved")}</span>
            )}
            <button
              type="button"
              disabled={busy}
              className="ml-auto flex items-center gap-1.5 text-xs font-medium text-[var(--danger)] transition-colors duration-150 hover:opacity-75 disabled:opacity-50"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 size={13} strokeWidth={2} />
              {deleting ? t("common.deleting") : t("styleDetail.delete")}
            </button>
          </div>

          <p className="text-xs text-[var(--text-muted)]">
            {t("styleDetail.note")}
          </p>
        </>
      )}

      {/* Modal xác nhận xóa style - bắt gõ DELETE */}
      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("styleDetail.delete")}
        description={
          <>
            {t("styleDetail.delete-desc-1")}{" "}
            <span className="font-medium">{style?.name ?? styleId}</span>? {t("styleDetail.delete-desc-2")}
          </>
        }
        busy={deleting}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDelete}
      />

      <MediaPreviewModal file={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
