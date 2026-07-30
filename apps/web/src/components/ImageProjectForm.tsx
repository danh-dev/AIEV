"use client";

/**
 * Phần dùng chung của tính năng Tạo ảnh:
 * - nhãn loại ảnh / tỉ lệ / trạng thái (ImageStatusBadge, AspectChip)
 * - ImageProjectFields: form prompt + loại + tỉ lệ + overlay chữ (Remotion đặt)
 *   — dùng ở cả modal "Tạo ảnh mới" và trang chi tiết images/[id].
 */

import { Loader2, Plus, X } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  getGeminiImageModels,
  type ImageAspect,
  type ImageKind,
  type ImageOverlay,
  type ImageProjectStatus,
  type ProviderModel,
} from "@/lib/api";
import { useProviders } from "@/components/ModelPicker";
import { StyleSelect } from "@/components/StyleSelect";

/**
 * Danh sách model ảnh Gemini live — lazy: chỉ fetch khi user chạm vào select
 * lần đầu (load()). Không cache cứng phía client — server đã cache 1h, mỗi lần
 * mount hook lại là một lần fetch mới để nhận model Google vừa phát hành.
 */
export function useGeminiImageModels() {
  const [models, setModels] = useState<ProviderModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setLoading(true);
    try {
      const { models } = await getGeminiImageModels();
      setModels(models);
    } catch {
      // lỗi mạng → cho phép thử lại ở lần focus sau, UI vẫn còn danh sách tĩnh
      startedRef.current = false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { models, loading, load };
}

// ---- Nhãn & options ----

export const KIND_OPTIONS: { value: ImageKind; label: string }[] = [
  { value: "background", label: "Background" },
  { value: "3d", label: "Minh họa 3D" },
  { value: "character", label: "Nhân vật" },
  { value: "texture", label: "Texture Liquid Glass" },
  { value: "product", label: "Ảnh sản phẩm" },
  { value: "concept", label: "Concept quảng cáo" },
];

export const KIND_LABEL: Record<ImageKind, string> = Object.fromEntries(
  KIND_OPTIONS.map((o) => [o.value, o.label])
) as Record<ImageKind, string>;

export const ASPECT_OPTIONS: {
  value: ImageAspect;
  width: number;
  height: number;
  note: string;
}[] = [
  { value: "9:16", width: 1080, height: 1920, note: "Dọc" },
  { value: "16:9", width: 1920, height: 1080, note: "Ngang" },
  { value: "1:1", width: 1080, height: 1080, note: "Vuông" },
  { value: "4:5", width: 1080, height: 1350, note: "Feed" },
];

export const STATUS_LABEL: Record<ImageProjectStatus, string> = {
  draft: "Nháp",
  generating: "Đang tạo",
  done: "Hoàn thành",
  error: "Lỗi",
};

const STATUS_TONE: Record<ImageProjectStatus, string> = {
  draft: "badge-muted",
  generating: "badge-running",
  done: "badge-success",
  error: "badge-danger",
};

export function ImageStatusBadge({ status }: { status: ImageProjectStatus }) {
  return (
    <span className={`badge ${STATUS_TONE[status] ?? "badge-muted"}`}>
      <span
        className={`badge-dot ${status === "generating" ? "badge-dot-pulse" : ""}`}
      />
      {STATUS_LABEL[status] ?? String(status)}
    </span>
  );
}

/** Icon thuần CSS mô phỏng tỉ lệ khung — cùng kiểu preset video ở trang Projects. */
export function AspectIcon({
  width,
  height,
  size = 22,
}: {
  width: number;
  height: number;
  /** Cạnh dài của icon (px) — 20 cho bản gọn ở trang chi tiết. */
  size?: number;
}) {
  const style =
    width >= height
      ? { width: size, aspectRatio: `${width} / ${height}` }
      : { height: size, aspectRatio: `${width} / ${height}` };
  return (
    <span className="flex h-6 w-6 items-center justify-center" aria-hidden>
      <span
        className="block rounded-[3px] border-[1.5px] border-current"
        style={style}
      />
    </span>
  );
}

export function AspectChip({ aspect }: { aspect: ImageAspect }) {
  return <span className="chip">{aspect}</span>;
}

export const DEFAULT_OVERLAY: ImageOverlay = {
  title: "",
  subtitle: "",
  stats: [],
  cta: "",
  showLogo: true,
};

/** Giá trị form (không gồm tên) — modal tạo mới và trang chi tiết dùng chung. */
export interface ImageDraft {
  prompt: string;
  kind: ImageKind;
  aspect: ImageAspect;
  overlay: ImageOverlay;
  /** Model Gemini tạo nền — null = mặc định của server (Nano Banana 2). */
  model: string | null;
  /** Style Design ảnh phải tuân theo — null = style mặc định. */
  styleId: string | null;
}

export const DEFAULT_IMAGE_DRAFT: ImageDraft = {
  prompt: "",
  kind: "background",
  aspect: "9:16",
  overlay: DEFAULT_OVERLAY,
  model: null,
  styleId: null,
};

/** Heading section 12px uppercase + divider mảnh — dùng ở chế độ sectioned. */
export function FormSectionHeading({ children }: { children: ReactNode }) {
  return (
    <p className="border-t border-[var(--border)] pt-3 text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">
      {children}
    </p>
  );
}

export function ImageProjectFields({
  value,
  onChange,
  disabled = false,
  idPrefix,
  showModel = true,
  sectioned = false,
}: {
  value: ImageDraft;
  onChange: (patch: Partial<ImageDraft>) => void;
  disabled?: boolean;
  /** Tiền tố id các control — tránh trùng id khi form xuất hiện 2 nơi. */
  idPrefix: string;
  /** false = ẩn select model (trang chi tiết đã có select riêng ở hàng hành động). */
  showModel?: boolean;
  /**
   * true = chia form thành section có divider + heading uppercase
   * ("Định dạng", "Chữ trên ảnh…") và grid tỉ lệ gọn hơn — trang chi tiết dùng.
   */
  sectioned?: boolean;
}) {
  const { prompt, kind, aspect, overlay, model, styleId } = value;
  const { providers } = useProviders();
  const geminiModels =
    providers?.find((p) => p.id === "gemini")?.models ?? [];
  const {
    models: liveModels,
    loading: modelsLoading,
    load: loadModels,
  } = useGeminiImageModels();
  // Chưa fetch live → tạm hiển thị danh sách tĩnh từ /api/providers
  const modelOptions = liveModels ?? geminiModels;
  // Model đã lưu không (chưa) nằm trong danh sách → vẫn hiển thị bằng id thô
  const modelMissing =
    model !== null && !modelOptions.some((m) => m.id === model);

  function patchOverlay(patch: Partial<ImageOverlay>) {
    onChange({ overlay: { ...overlay, ...patch } });
  }

  function setStat(index: number, patch: Partial<{ label: string; value: string }>) {
    patchOverlay({
      stats: overlay.stats.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });
  }

  return (
    <>
      <div>
        <label className="label" htmlFor={`${idPrefix}-style`}>
          Style Design
        </label>
        <StyleSelect
          id={`${idPrefix}-style`}
          value={styleId}
          disabled={disabled}
          onChange={(v) => onChange({ styleId: v })}
        />
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Ảnh tạo ra bắt buộc tuân theo màu, font, logo và tone của style này.
        </p>
      </div>

      <div>
        <label className="label" htmlFor={`${idPrefix}-prompt`}>
          Yêu cầu tạo ảnh
        </label>
        <textarea
          id={`${idPrefix}-prompt`}
          className="input"
          rows={3}
          value={prompt}
          disabled={disabled}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="vd: Background digital marketing với các icon automation bay lơ lửng, phong cách 3D hiện đại..."
        />
      </div>

      <div>
        <label className="label" htmlFor={`${idPrefix}-kind`}>
          Loại ảnh
        </label>
        <select
          id={`${idPrefix}-kind`}
          className="input"
          value={kind}
          disabled={disabled}
          onChange={(e) => onChange({ kind: e.target.value as ImageKind })}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {showModel && (
        <div>
          <label className="label" htmlFor={`${idPrefix}-model`}>
            Model tạo nền (Gemini)
          </label>
          <select
            id={`${idPrefix}-model`}
            className="input"
            value={model ?? ""}
            disabled={disabled}
            onFocus={loadModels}
            onChange={(e) => onChange({ model: e.target.value || null })}
          >
            <option value="">Mặc định (Nano Banana 2)</option>
            {modelMissing && <option value={model!}>{model}</option>}
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {modelsLoading ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <Loader2 size={12} strokeWidth={2} className="animate-spin" />
              Đang tải model…
            </p>
          ) : (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Danh sách lấy trực tiếp từ Google · Lite rẻ/nhanh hơn · Pro chất
              lượng cao nhất
            </p>
          )}
        </div>
      )}

      {sectioned && <FormSectionHeading>Định dạng</FormSectionHeading>}
      <div>
        <span className="label">Tỉ lệ</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ASPECT_OPTIONS.map((o) => {
            const active = aspect === o.value;
            return (
              <button
                key={o.value}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ aspect: o.value })}
                className={`flex flex-col items-center gap-1 rounded-[var(--radius)] border text-center transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                  sectioned ? "p-2" : "p-3"
                } ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                    : "border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-subtle)]"
                }`}
              >
                <AspectIcon
                  width={o.width}
                  height={o.height}
                  size={sectioned ? 20 : 22}
                />
                <span className="text-[13px] leading-tight font-medium">
                  {o.value}
                </span>
                <span
                  className={`text-[11px] ${
                    active ? "opacity-80" : "text-[var(--text-muted)]"
                  }`}
                >
                  {o.width}×{o.height} · {o.note}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {sectioned && (
        <FormSectionHeading>Chữ trên ảnh (Remotion đặt)</FormSectionHeading>
      )}
      <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
        {!sectioned && (
          <p className="text-[13px] font-medium">
            Nội dung chữ trên ảnh{" "}
            <span className="font-normal text-[var(--text-muted)]">
              (Remotion đặt — đồng bộ Design System)
            </span>
          </p>
        )}
        <div>
          <label className="label" htmlFor={`${idPrefix}-ov-title`}>
            Tiêu đề
          </label>
          <input
            id={`${idPrefix}-ov-title`}
            className="input"
            value={overlay.title}
            disabled={disabled}
            onChange={(e) => patchOverlay({ title: e.target.value })}
            placeholder="vd: Tự động hóa marketing"
          />
        </div>
        <div>
          <label className="label" htmlFor={`${idPrefix}-ov-subtitle`}>
            Phụ đề
          </label>
          <input
            id={`${idPrefix}-ov-subtitle`}
            className="input"
            value={overlay.subtitle}
            disabled={disabled}
            onChange={(e) => patchOverlay({ subtitle: e.target.value })}
            placeholder="vd: Tiết kiệm 10 giờ mỗi tuần"
          />
        </div>
        <div>
          <span className="label">Số liệu</span>
          <div className="flex flex-col gap-2">
            {overlay.stats.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="input h-8 flex-1 text-[13px]"
                  aria-label={`Nhãn số liệu ${i + 1}`}
                  value={s.label}
                  disabled={disabled}
                  onChange={(e) => setStat(i, { label: e.target.value })}
                  placeholder="Nhãn — vd: Khách hàng"
                />
                <input
                  className="input h-8 w-28 text-[13px]"
                  aria-label={`Giá trị số liệu ${i + 1}`}
                  value={s.value}
                  disabled={disabled}
                  onChange={(e) => setStat(i, { value: e.target.value })}
                  placeholder="vd: 10K+"
                />
                <button
                  type="button"
                  aria-label={`Xóa số liệu ${i + 1}`}
                  disabled={disabled}
                  className="rounded-[var(--radius)] p-1 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg)] hover:text-[var(--danger)]"
                  onClick={() =>
                    patchOverlay({
                      stats: overlay.stats.filter((_, j) => j !== i),
                    })
                  }
                >
                  <X size={14} strokeWidth={2} />
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={disabled}
              className="inline-flex w-fit items-center gap-1 text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)] disabled:opacity-50"
              onClick={() =>
                patchOverlay({
                  stats: [...overlay.stats, { label: "", value: "" }],
                })
              }
            >
              <Plus size={13} strokeWidth={2} />
              Thêm số liệu
            </button>
          </div>
        </div>
        <div>
          <label className="label" htmlFor={`${idPrefix}-ov-cta`}>
            CTA
          </label>
          <input
            id={`${idPrefix}-ov-cta`}
            className="input"
            value={overlay.cta}
            disabled={disabled}
            onChange={(e) => patchOverlay({ cta: e.target.value })}
            placeholder="vd: Dùng thử miễn phí"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor={`${idPrefix}-ov-logo`}
            className="cursor-pointer text-sm font-medium"
          >
            Hiện logo brand
          </label>
          <button
            id={`${idPrefix}-ov-logo`}
            type="button"
            role="switch"
            aria-checked={overlay.showLogo}
            aria-label="Hiện logo brand"
            disabled={disabled}
            className="switch"
            onClick={() => patchOverlay({ showLogo: !overlay.showLogo })}
          />
        </div>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Ảnh nền do Gemini tạo sẽ không chứa chữ — mọi chữ do hệ thống đặt để
        đúng font và màu brand.
      </p>
    </>
  );
}
