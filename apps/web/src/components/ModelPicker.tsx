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
    <div>
      <span className="label">{t("model.performer")}</span>
      <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">Claude</span>
          {claude &&
            (claude.connected ? (
              <span className="badge badge-success">
                <span className="badge-dot" />
                {claude.source === "api-key"
                  ? t("model.connected-api-key")
                  : t("model.connected-subscription")}
              </span>
            ) : (
              <span className="badge badge-danger">
                <span className="badge-dot" />
                {t("model.not-connected")}
              </span>
            ))}
        </div>
        {claude && !claude.connected && (
          <p className="flex items-start gap-1.5 text-xs font-medium text-[var(--danger)]">
            <AlertTriangle size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
            {t("model.claude-warning")}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ai-model">
              {t("model.model")}
            </label>
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
          </div>
          <div>
            <label className="label" htmlFor="ai-effort">
              {t("model.effort")}
            </label>
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
          </div>
        </div>
        {gemini && (
          <p
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]"
            title={t(GEMINI_TOOLTIP)}
          >
            <Info size={13} strokeWidth={2} className="shrink-0" />
            {gemini.connected
              ? t("model.gemini-connected")
              : t("model.gemini-not-connected")}
          </p>
        )}
      </div>
    </div>
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
      <select
        className="input h-7 w-auto px-2 text-xs"
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
        className="input h-7 w-auto px-2 text-xs"
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
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--danger)]"
          title={t("model.claude-warning-short")}
        >
          <AlertTriangle size={12} strokeWidth={2} className="shrink-0" />
          {t("model.claude-not-connected")}
        </span>
      )}
      {gemini && (
        <span
          className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]"
          title={t(GEMINI_TOOLTIP)}
        >
          <Info size={12} strokeWidth={2} className="shrink-0" />
          {t("model.gemini-images-only")}
        </span>
      )}
    </div>
  );
}
