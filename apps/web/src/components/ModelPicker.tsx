"use client";

/**
 * Chọn model Claude + chế độ (effort) cho phiên AI — dùng ở:
 * - Modal "Bắt đầu edit bằng AI" (khối AiModelBlock đầy đủ, có badge kết nối)
 * - ChatThread khi tạo phiên MỚI (hàng AiModelInlineRow gọn phía trên input)
 *
 * Danh sách model + trạng thái kết nối lấy từ GET /api/providers, cache
 * module-level trong một phiên UI. Gemini chỉ hiện dạng thông tin — provider
 * đó dành cho tính năng Tạo ảnh, không dùng cho chat/edit.
 */

import { AlertTriangle, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { getProviders, type AgentEffort, type Provider } from "@/lib/api";

export const DEFAULT_MODEL = "claude-fable-5";
export const DEFAULT_EFFORT: AgentEffort = "medium";

export const EFFORT_OPTIONS: {
  value: AgentEffort;
  label: string;
  hint: string;
}[] = [
  { value: "low", label: "Nhanh", hint: "nhanh, tiết kiệm" },
  { value: "medium", label: "Chuẩn", hint: "cân bằng" },
  { value: "high", label: "Sâu", hint: "kỹ lưỡng, chậm hơn" },
];

/** Fallback khi chưa fetch được /api/providers — chỉ để select không trống. */
const FALLBACK_MODELS = [{ id: DEFAULT_MODEL, label: "Claude Fable 5" }];

const GEMINI_TOOLTIP = "Gemini dùng cho tính năng Tạo ảnh";

// Cache module-level — providers thay đổi khi sửa .env/đăng nhập lại,
// một lần fetch mỗi phiên UI là đủ.
let providersCache: Provider[] | null = null;
let providersPromise: Promise<Provider[]> | null = null;

/**
 * Bust cache providers — gọi sau khi đổi/xóa API key ở trang Kết nối để các
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

/** Khối "AI thực hiện" trong modal Bắt đầu edit — model + mode + trạng thái kết nối. */
export function AiModelBlock({
  model,
  effort,
  onModelChange,
  onEffortChange,
  disabled = false,
}: PickerProps) {
  const { providers } = useProviders();
  const claude = providers?.find((p) => p.id === "claude");
  const gemini = providers?.find((p) => p.id === "gemini");
  const models = claudeModels(claude);

  return (
    <div>
      <span className="label">AI thực hiện</span>
      <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">Claude</span>
          {claude &&
            (claude.connected ? (
              <span className="badge badge-success">
                <span className="badge-dot" />
                {claude.source === "api-key"
                  ? "Đã kết nối API key"
                  : "Đã kết nối subscription"}
              </span>
            ) : (
              <span className="badge badge-danger">
                <span className="badge-dot" />
                Chưa kết nối
              </span>
            ))}
        </div>
        {claude && !claude.connected && (
          <p className="flex items-start gap-1.5 text-xs font-medium text-[var(--danger)]">
            <AlertTriangle size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
            Chưa kết nối Claude — đăng nhập Claude Code (subscription) hoặc thêm
            ANTHROPIC_API_KEY vào .env rồi khởi động lại server.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ai-model">
              Model
            </label>
            <select
              id="ai-model"
              className="input"
              value={model}
              disabled={disabled}
              onChange={(e) => onModelChange(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ai-effort">
              Chế độ
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
                  {o.label} — {o.hint}
                </option>
              ))}
            </select>
          </div>
        </div>
        {gemini && (
          <p
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]"
            title={GEMINI_TOOLTIP}
          >
            <Info size={13} strokeWidth={2} className="shrink-0" />
            Gemini {gemini.connected ? "đã kết nối" : "chưa kết nối"} — chỉ dùng
            cho tính năng Tạo ảnh, không dùng cho chat/edit.
          </p>
        )}
      </div>
    </div>
  );
}

/** Hàng chọn model/mode gọn — hiện trong ChatThread khi tạo phiên mới. */
export function AiModelInlineRow({
  model,
  effort,
  onModelChange,
  onEffortChange,
  disabled = false,
}: PickerProps) {
  const { providers } = useProviders();
  const claude = providers?.find((p) => p.id === "claude");
  const gemini = providers?.find((p) => p.id === "gemini");
  const models = claudeModels(claude);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="input h-7 w-auto px-2 text-xs"
        aria-label="Model AI cho phiên mới"
        value={model}
        disabled={disabled}
        onChange={(e) => onModelChange(e.target.value)}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <select
        className="input h-7 w-auto px-2 text-xs"
        aria-label="Chế độ AI cho phiên mới"
        value={effort}
        disabled={disabled}
        onChange={(e) => onEffortChange(e.target.value as AgentEffort)}
      >
        {EFFORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {claude && !claude.connected && (
        <span
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--danger)]"
          title="Đăng nhập Claude Code (subscription) hoặc thêm ANTHROPIC_API_KEY vào .env."
        >
          <AlertTriangle size={12} strokeWidth={2} className="shrink-0" />
          Chưa kết nối Claude
        </span>
      )}
      {gemini && (
        <span
          className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]"
          title={GEMINI_TOOLTIP}
        >
          <Info size={12} strokeWidth={2} className="shrink-0" />
          Gemini: chỉ Tạo ảnh
        </span>
      )}
    </div>
  );
}
