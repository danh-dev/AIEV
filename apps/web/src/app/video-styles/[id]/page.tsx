"use client";

import { ArrowLeft, Check, RotateCcw, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  deleteVideoStyle,
  getVideoStyleDetail,
  resetVideoStyle,
  updateVideoStyle,
  type ManagedVideoStyleDetail,
  type VideoStyleInput,
} from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { useT } from "@/lib/i18n";

/**
 * Sửa một phong cách dựng.
 *
 * KHÁC ô chọn phong cách trong Brief: ở đó cố tình KHÔNG hiện `art`/`avoid` (là
 * prompt chỉ đạo mỹ thuật gửi Gemini, dài và bằng tiếng Anh - người đi chọn
 * không cần đọc). Ở đây thì bắt buộc phải hiện: không sửa được hai field đó thì
 * phong cách tự tạo ra chẳng có chỉ đạo mỹ thuật nào, tức là không dùng được.
 */
export default function VideoStyleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { t, tf } = useT();

  const [style, setStyle] = useState<ManagedVideoStyleDetail | null>(null);
  const [form, setForm] = useState<VideoStyleInput | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const apply = useCallback((s: ManagedVideoStyleDetail) => {
    setStyle(s);
    setForm({
      name: s.name,
      art: s.art,
      avoid: s.avoid,
      palette: s.palette,
      motion: s.motion,
    });
    setDirty(false);
  }, []);

  useEffect(() => {
    let stale = false;
    getVideoStyleDetail(id)
      .then((s) => {
        if (stale) return;
        apply(s);
        setError(null);
      })
      .catch((e) => {
        if (stale) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      stale = true;
    };
  }, [id, apply]);

  function set<K extends keyof VideoStyleInput>(key: K, value: VideoStyleInput[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setDirty(true);
    setSavedAt(null);
  }

  const valid =
    form !== null &&
    form.name.trim() !== "" &&
    form.art.trim() !== "" &&
    form.avoid.trim() !== "" &&
    form.motion.trim() !== "";

  async function onSave() {
    if (!form || !valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateVideoStyle(id, form);
      // Giữ nguyên danh sách project đang dùng - PUT không trả về usage
      setStyle((cur) => (cur ? { ...cur, ...saved, usage: cur.usage } : cur));
      setDirty(false);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onReset() {
    if (resetting) return;
    setResetting(true);
    setError(null);
    try {
      await resetVideoStyle(id);
      apply(await getVideoStyleDetail(id));
      setSavedAt(Date.now());
      setResetOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting(false);
    }
  }

  async function onDelete() {
    if (deleting || !style) return;
    setDeleting(true);
    try {
      // force khi đang có project dùng: modal ĐÃ liệt kê đủ tên các project đó
      // và nói rõ chúng sẽ về "AI tự quyết", nên đây không còn là xóa ngầm nữa.
      // Chốt chặn 409 của server vẫn giữ nguyên cho các đường gọi khác (agent, CLI).
      await deleteVideoStyle(id, style.usage.length > 0);
      router.push("/video-styles");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  // Ô chọn phong cách trong Brief ưu tiên BẢN DỊCH theo key `vstyle.<id>.name`
  // (và `.desc`) rồi mới tới dữ liệu server. Với 20 phong cách mặc định thì key
  // đó có sẵn, nên đổi tên ở đây prompt gửi AI đổi theo nhưng NHÃN trên ô chọn
  // thì không - phải nói ra, chứ để người dùng tự đoán là mất buổi.
  const nameKey = `vstyle.${id}.name`;
  const translatedName = t(nameKey);
  const hasTranslation = translatedName !== nameKey;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={style ? style.name : id}
        subtitle={t("vstyle.detail.subtitle")}
        actions={
          <>
            <Link href="/video-styles">
              <Button variant="secondary">
                <ArrowLeft size={15} strokeWidth={2} />
                {t("common.back-to-list")}
              </Button>
            </Link>
            {style?.builtin && (
              <Button
                variant="secondary"
                disabled={resetting}
                onClick={() => setResetOpen(true)}
              >
                <RotateCcw size={15} strokeWidth={2} />
                {resetting ? t("vstyle.detail.resetting") : t("vstyle.detail.reset")}
              </Button>
            )}
            <Button
              variant="destructive"
              disabled={!style}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 size={15} strokeWidth={2} />
              {t("common.delete")}
            </Button>
            <Button onClick={onSave} disabled={!dirty || !valid || saving}>
              <Save size={15} strokeWidth={2} />
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </>
        }
      />

      {error && (
        <ErrorBanner message={t("vstyle.detail.action-error")} detail={error} />
      )}
      {savedAt && !dirty && !error && (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--success-bg)] px-4 py-2 text-sm text-[var(--success)]">
          {t("common.saved")}
        </div>
      )}

      {form && style ? (
        <>
          {style.builtin && (
            <p className="text-xs text-[var(--text-muted)]">
              {t("vstyle.detail.builtin-note")}
            </p>
          )}

          <Card className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="label" htmlFor="vstyle-id">
                  {t("vstyle.detail.id-label")}
                </label>
                <input
                  id="vstyle-id"
                  className="input font-mono"
                  value={style.id}
                  readOnly
                  disabled
                />
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {t("vstyle.detail.id-hint")}
                </p>
              </div>
              <div>
                <label className="label" htmlFor="vstyle-name">
                  {t("vstyle.detail.name-label")}
                </label>
                <input
                  id="vstyle-name"
                  className="input"
                  value={form.name}
                  disabled={saving}
                  onChange={(e) => set("name", e.target.value)}
                />
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {t("vstyle.detail.name-hint")}
                </p>
                {hasTranslation && (
                  <p className="mt-1 text-xs text-[var(--danger)]">
                    {tf("vstyle.detail.name-translated", {
                      name: translatedName,
                      id,
                    })}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="vstyle-art">
                {t("vstyle.detail.art-label")}
              </label>
              <textarea
                id="vstyle-art"
                className="input min-h-[110px] resize-y leading-relaxed"
                value={form.art}
                disabled={saving}
                spellCheck={false}
                placeholder={t("vstyle.detail.art-placeholder")}
                onChange={(e) => set("art", e.target.value)}
              />
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {t("vstyle.detail.art-hint")}
              </p>
            </div>

            <div>
              <label className="label" htmlFor="vstyle-avoid">
                {t("vstyle.detail.avoid-label")}
              </label>
              <textarea
                id="vstyle-avoid"
                className="input min-h-[70px] resize-y leading-relaxed"
                value={form.avoid}
                disabled={saving}
                spellCheck={false}
                placeholder={t("vstyle.detail.avoid-placeholder")}
                onChange={(e) => set("avoid", e.target.value)}
              />
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {t("vstyle.detail.avoid-hint")}
              </p>
            </div>

            <div>
              <label className="label" htmlFor="vstyle-motion">
                {t("vstyle.detail.motion-label")}
              </label>
              <textarea
                id="vstyle-motion"
                className="input min-h-[110px] resize-y leading-relaxed"
                value={form.motion}
                disabled={saving}
                placeholder={t("vstyle.detail.motion-placeholder")}
                onChange={(e) => set("motion", e.target.value)}
              />
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {t("vstyle.detail.motion-hint")}
              </p>
            </div>

            {/* Bảng màu: KHÔNG dùng select 2 dòng - lựa chọn này đổi hẳn cách màu
                thương hiệu áp vào ảnh, nên phải đọc được hậu quả trước khi chọn */}
            <div>
              <span className="label">{t("vstyle.detail.palette-label")}</span>
              <div
                role="radiogroup"
                aria-label={t("vstyle.detail.palette-label")}
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <PaletteCard
                  active={form.palette === "brand"}
                  disabled={saving}
                  title={t("vstyle.detail.palette-brand")}
                  desc={t("vstyle.detail.palette-brand-desc")}
                  onSelect={() => set("palette", "brand")}
                />
                <PaletteCard
                  active={form.palette === "loose"}
                  disabled={saving}
                  title={t("vstyle.detail.palette-loose")}
                  desc={t("vstyle.detail.palette-loose-desc")}
                  badge={t("vstyle.loose-badge")}
                  onSelect={() => set("palette", "loose")}
                />
              </div>
            </div>

            <p className="text-xs text-[var(--text-muted)]">
              {t("vstyle.detail.required")}
            </p>
          </Card>

          <Card className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">
              {t("vstyle.detail.usage-title")}
            </h2>
            {style.usage.length > 0 ? (
              <>
                <ul className="flex flex-col gap-1">
                  {style.usage.map((u) => (
                    <li
                      key={`${u.kind}:${u.id}`}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="chip">
                        {t(`vstyle.detail.kind.${u.kind}`)}
                      </span>
                      <span className="font-medium">{u.name}</span>
                      <span className="font-mono text-xs text-[var(--text-muted)]">
                        {u.id}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-[var(--text-muted)]">
                  {t("vstyle.detail.usage-hint")}
                </p>
              </>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                {t("vstyle.detail.usage-empty")}
              </p>
            )}
          </Card>
        </>
      ) : !error ? (
        <Card>
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        </Card>
      ) : null}

      {/* Xóa: modal liệt kê ĐỦ tên project đang dùng trước khi bắt gõ DELETE -
          xóa xong chúng về "AI tự quyết", người dùng phải thấy trước điều đó */}
      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("vstyle.detail.delete-title")}
        description={
          style && (
            <>
              <p>
                {t("vstyle.detail.delete-desc-1")}{" "}
                <span className="font-medium">{style.name}</span>?{" "}
                {t("common.no-undo")}
              </p>
              {style.usage.length > 0 && (
                <p className="mt-2">
                  {tf("vstyle.detail.delete-in-use", { n: style.usage.length })}
                </p>
              )}
              {style.builtin && (
                <p className="mt-2 text-[var(--text-muted)]">
                  {t("vstyle.detail.delete-builtin")}
                </p>
              )}
            </>
          )
        }
        items={style?.usage.map((u) => u.name)}
        busy={deleting}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDelete}
      />

      {/* Khôi phục bản gốc: KHÔNG phá dữ liệu người khác nên dùng modal thường,
          không bắt gõ DELETE (xem ghi chú trong ConfirmDeleteModal) */}
      <Modal
        title={t("vstyle.detail.reset-title")}
        open={resetOpen}
        onClose={() => {
          if (!resetting) setResetOpen(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={resetting}
              onClick={() => setResetOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={onReset} disabled={resetting}>
              <RotateCcw size={15} strokeWidth={2} />
              {resetting ? t("vstyle.detail.resetting") : t("vstyle.detail.reset")}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t("vstyle.detail.reset-desc")}</p>
      </Modal>
    </div>
  );
}

function PaletteCard({
  active,
  disabled,
  title,
  desc,
  badge,
  onSelect,
}: {
  active: boolean;
  disabled: boolean;
  title: string;
  desc: string;
  badge?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-w-0 flex-col gap-1 rounded-[var(--radius)] border p-3 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-[var(--primary)] bg-[var(--primary-soft)]"
          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--text-muted)]"
      }`}
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span
          className={`text-[13px] font-semibold ${
            active ? "text-[var(--primary)]" : "text-[var(--text)]"
          }`}
        >
          {title}
        </span>
        {badge && (
          <span className="rounded-full bg-[var(--danger-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--danger)]">
            {badge}
          </span>
        )}
        {active && (
          <Check
            size={13}
            strokeWidth={2.5}
            aria-hidden="true"
            className="ml-auto shrink-0 text-[var(--primary)]"
          />
        )}
      </span>
      <span className="text-[11px] leading-snug text-[var(--text-muted)]">
        {desc}
      </span>
    </button>
  );
}
