"use client";

/**
 * Chọn model Claude + chế độ (effort) cho phiên AI - dùng ở:
 * - Modal "Bắt đầu edit bằng AI" (khối AiModelBlock đầy đủ, có badge kết nối)
 * - ChatThread khi tạo phiên MỚI (hàng AiModelInlineRow gọn phía trên input)
 *
 * Danh sách model + trạng thái kết nối lấy từ GET /api/providers, cache
 * module-level trong một phiên UI. Gemini chỉ hiện dạng thông tin - provider
 * đó dành cho tính năng Tạo ảnh, không dùng cho chat/edit.
 */

import { AlertTriangle, Info } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/Badge";
import { Field } from "@/components/Field";
import { Panel } from "@/components/Panel";
import {
  getClaudeModels,
  getProviders,
  type AgentEffort,
  type Provider,
  type ProviderModel,
} from "@/lib/api";
import { useT } from "@/lib/i18n";

export const DEFAULT_MODEL = "claude-fable-5";
export const DEFAULT_EFFORT: AgentEffort = "medium";

export const EFFORT_OPTIONS: {
  value: AgentEffort;
  label: string;
  hint: string;
}[] = [
  // label/hint là KEY dictionary - dịch bằng t() lúc render
  { value: "low", label: "effort.low", hint: "effort.low-hint" },
  { value: "medium", label: "effort.medium", hint: "effort.medium-hint" },
  { value: "high", label: "effort.high", hint: "effort.high-hint" },
];

/** Fallback khi chưa fetch được /api/providers - chỉ để select không trống. */
const FALLBACK_MODELS = [{ id: DEFAULT_MODEL, label: "Claude Fable 5" }];

// KEY dictionary - dịch bằng t() lúc render
const GEMINI_TOOLTIP = "model.gemini-tooltip";

// Cache module-level - providers thay đổi khi sửa .env/đăng nhập lại,
// một lần fetch mỗi phiên UI là đủ.
let providersCache: Provider[] | null = null;
let providersPromise: Promise<Provider[]> | null = null;

/**
 * Bust cache providers - gọi sau khi đổi/xóa API key ở trang Kết nối để các
 * select model/provider nơi khác fetch lại danh sách mới ở lần mount sau.
 */
export function refreshProviders(): void {
  providersCache = null;
  providersPromise = null;
}

export function useProviders(): {
  providers: Provider[] | null;
  error: string | null;
} {
  const [providers, setProviders] = useState<Provider[] | null>(providersCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (providersCache) return;
    let alive = true;
    if (!providersPromise) {
      providersPromise = getProviders().then((r) => {
        providersCache = r.providers;
        return r.providers;
      });
    }
    providersPromise
      .then((list) => {
        if (alive) setProviders(list);
      })
      .catch((e) => {
        // fetch hỏng → cho phép thử lại ở lần mount sau
        providersPromise = null;
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  return { providers, error };
}

/**
 * Danh sách model Claude live - lazy: chỉ fetch khi user chạm vào select Model
 * lần đầu (load()), giống useGeminiImageModels. Server cache 10 phút; chưa
 * fetch xong thì UI vẫn dùng danh sách tĩnh từ /api/providers.
 */
export function useClaudeModels() {
  const [models, setModels] = useState<ProviderModel[] | null>(null);
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      const { models } = await getClaudeModels();
      setModels(models);
    } catch {
      // lỗi mạng → cho phép thử lại ở lần focus sau, UI vẫn còn danh sách tĩnh
      startedRef.current = false;
    }
  }, []);

  return { models, load };
}

interface PickerProps {
  model: string;
  effort: AgentEffort;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: AgentEffort) => void;
  disabled?: boolean;
}

function claudeModels(claude: Provider | undefined) {
  return claude && claude.models.length > 0 ? claude.models : FALLBACK_MODELS;
}

/** Khối "AI thực hiện" trong modal Bắt đầu edit - model + mode + trạng thái kết nối. */
export function AiModelBlock({
  model,
  effort,
  onModelChange,
  onEffortChange,
  disabled = false,
}: PickerProps) {
  const { t } = useT();
  const { providers } = useProviders();
  const claude = providers?.find((p) => p.id === "claude");
  const gemini = providers?.find((p) => p.id === "gemini");
  const { models: liveModels, load: loadClaudeModels } = useClaudeModels();
  // Chưa fetch live → tạm dùng danh sách tĩnh từ /api/providers
  const models = liveModels ?? claudeModels(claude);
  // Model đã lưu không (chưa) nằm trong danh sách → vẫn hiển thị bằng id thô
  const modelMissing = model !== "" && !models.some((m) => m.id === model);

  return (
    <Panel
      title={t("model.performer")}
      actions={
        // "Claude" phải đứng ngay trước huy hiệu: một mình chữ "Đã kết nối"
        // cạnh tiêu đề nhóm "AI thực hiện" thì không nói được là CÁI GÌ đang
        // kết nối. Bản cũ có chữ này, chuyển sang Panel thì rơi mất.
        claude && (
          <span className="flex items-center gap-2">
            <span className="text-meta font-medium">Claude</span>
            {claude.connected ? (
              <Badge
                tone="success"
                label={
                  claude.source === "api-key"
                    ? t("model.connected-api-key")
                    : t("model.connected-subscription")
                }
              />
            ) : (
              <Badge tone="danger" label={t("model.not-connected")} />
            )}
          </span>
        )
      }
    >
      {claude && !claude.connected && (
        <p className="flex items-start gap-2 text-sm font-medium text-[var(--danger)]">
          <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
          {t("model.claude-warning")}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("model.model")} htmlFor="ai-model">
          <select
            id="ai-model"
            className="input"
            value={model}
            disabled={disabled}
            onFocus={loadClaudeModels}
            onChange={(e) => onModelChange(e.target.value)}
          >
            {modelMissing && <option value={model}>{model}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("model.effort")} htmlFor="ai-effort">
          <select
            id="ai-effort"
            className="input"
            value={effort}
            disabled={disabled}
            onChange={(e) => onEffortChange(e.target.value as AgentEffort)}
          >
            {EFFORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)} - {t(o.hint)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {gemini && (
        <p
          className="flex items-center gap-2 text-meta text-[var(--text-muted)]"
          title={t(GEMINI_TOOLTIP)}
        >
          <Info size={14} strokeWidth={2} className="shrink-0" />
          {gemini.connected
            ? t("model.gemini-connected")
            : t("model.gemini-not-connected")}
        </p>
      )}
    </Panel>
  );
}

/** Hàng chọn model/mode gọn - hiện trong ChatThread khi tạo phiên mới. */
export function AiModelInlineRow({
  model,
  effort,
  onModelChange,
  onEffortChange,
  disabled = false,
}: PickerProps) {
  const { t } = useT();
  const { providers } = useProviders();
  const claude = providers?.find((p) => p.id === "claude");
  const gemini = providers?.find((p) => p.id === "gemini");
  const { models: liveModels, load: loadClaudeModels } = useClaudeModels();
  // Chưa fetch live → tạm dùng danh sách tĩnh từ /api/providers
  const models = liveModels ?? claudeModels(claude);
  // Model đã lưu không (chưa) nằm trong danh sách → vẫn hiển thị bằng id thô
  const modelMissing = model !== "" && !models.some((m) => m.id === model);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* `.input` chuẩn, chỉ ghi đè BỀ RỘNG (w-auto) để hai select nằm gọn trên
          một hàng - chiều cao và cỡ chữ giữ nguyên như mọi ô nhập khác. */}
      <select
        className="input w-auto"
        aria-label={t("model.aria-model")}
        value={model}
        disabled={disabled}
        onFocus={loadClaudeModels}
        onChange={(e) => onModelChange(e.target.value)}
      >
        {modelMissing && <option value={model}>{model}</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <select
        className="input w-auto"
        aria-label={t("model.aria-effort")}
        value={effort}
        disabled={disabled}
        onChange={(e) => onEffortChange(e.target.value as AgentEffort)}
      >
        {EFFORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.label)}
          </option>
        ))}
      </select>
      {claude && !claude.connected && (
        <span
          className="inline-flex items-center gap-1 text-meta font-medium text-[var(--danger)]"
          title={t("model.claude-warning-short")}
        >
          <AlertTriangle size={13} strokeWidth={2} className="shrink-0" />
          {t("model.claude-not-connected")}
        </span>
      )}
      {gemini && (
        <span
          className="inline-flex items-center gap-1 text-meta text-[var(--text-muted)]"
          title={t(GEMINI_TOOLTIP)}
        >
          <Info size={13} strokeWidth={2} className="shrink-0" />
          {t("model.gemini-images-only")}
        </span>
      )}
    </div>
  );
}
