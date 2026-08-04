"use client";

/**
 * Trang Cấu hình - tăng tốc phần cứng + cài đặt render: worker Chrome
 * (HyperFrames), GPU cho capture/encode, concurrency Remotion + queue, draft fps.
 * Mỗi thay đổi PUT ngay (auto-save) - server đọc settings mỗi lần job chạy
 * và mỗi tick của queue nên hiệu lực NGAY, không cần restart.
 */

import { Check, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getRenderSettings,
  updateRenderSettings,
  type HardwareInfo,
  type RenderRecommended,
  type RenderSettings,
  type RenderSettingsResponse,
  type UpdateChannel,
} from "@/lib/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { PageHeader } from "@/components/PageHeader";
import { SystemCheckCard } from "@/components/SystemCheckCard";
import { useT } from "@/lib/i18n";

const PLATFORM_LABELS: Record<string, string> = {
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux",
};

/**
 * value dùng chung cho các nhóm nút: number hoặc null (draft fps "Giữ nguyên"),
 * hoặc chuỗi cho các lựa chọn dạng enum (kênh cập nhật).
 */
type SegValue = number | string | null;

interface SegOption<V extends SegValue = number | null> {
  value: V;
  label: string;
  /** Mốc khuyên dùng theo máy thật - hiển thị suffix ★. */
  recommended?: boolean;
}

/** Các mốc worker/concurrency chuẩn - chỉ giữ mốc ≤ số luồng CPU của máy. */
const WORKER_STEPS = [2, 4, 6, 8, 12, 16, 24];

/** Sinh option ĐỘNG theo máy: Auto + mốc chuẩn ≤ maxWorkers (+ chính maxWorkers). */
function buildWorkerOptions(rec: RenderRecommended, recommendedValue: number): SegOption[] {
  const values = WORKER_STEPS.filter((v) => v <= rec.maxWorkers);
  if (!values.includes(rec.maxWorkers)) {
    values.push(rec.maxWorkers);
    values.sort((a, b) => a - b);
  }
  return [
    { value: 0, label: "Auto" },
    ...values.map((v) => ({
      value: v,
      label: String(v),
      recommended: v === recommendedValue,
    })),
  ];
}

/** Fallback khi server cũ chưa trả recommended - giữ hành vi như trước. */
const RECOMMENDED_FALLBACK: RenderRecommended = {
  workers: 8,
  concurrency: 8,
  maxWorkers: 12,
};

const QUEUE_OPTIONS: SegOption[] = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
];

// label "config.keep" là KEY dictionary - SegGroup dịch bằng t() lúc render.
const DRAFT_FPS_OPTIONS: SegOption[] = [
  { value: null, label: "config.keep" },
  { value: 15, label: "15 fps" },
  { value: 24, label: "24 fps" },
];

/** Kênh cập nhật - "stable" là mặc định nên gắn luôn dấu ★ khuyên dùng. */
const UPDATE_CHANNEL_OPTIONS: SegOption<UpdateChannel>[] = [
  { value: "stable", label: "update.channel-stable", recommended: true },
  { value: "latest", label: "update.channel-latest" },
];

/** Nhóm nút chọn một giá trị - style giống bộ chọn tỉ lệ của Tạo ảnh. */
function SegGroup<V extends SegValue>({
  options,
  value,
  onSelect,
  ariaLabel,
}: {
  options: SegOption<V>[];
  value: V;
  onSelect: (v: V) => void;
  ariaLabel: string;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(o.value)}
            title={o.recommended ? t("config.recommended-title") : undefined}
            className={`min-w-[44px] rounded-[var(--radius)] border px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
              active
                ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                : "border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-subtle)]"
            }`}
          >
            {t(o.label)}
            {o.recommended && (
              <span aria-label={t("config.recommended-aria")} className="ml-1 text-[10px] align-top">
                ★
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Hàng field: label + hint + control (nhóm nút). */
function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <p className="text-sm font-medium">{label}</p>
      {hint && (
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">{hint}</p>
      )}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Hàng toggle: label + hint (muted hoặc danger) + switch. */
function ToggleRow({
  id,
  label,
  hint,
  hintTone = "muted",
  checked,
  disabled = false,
  disabledNote,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  hintTone?: "muted" | "danger";
  checked: boolean;
  disabled?: boolean;
  disabledNote?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className={`min-w-0 ${disabled ? "opacity-60" : ""}`}>
        <label
          htmlFor={id}
          className={`text-sm font-medium ${disabled ? "" : "cursor-pointer"}`}
        >
          {label}
        </label>
        <p
          className={`mt-0.5 text-xs ${
            hintTone === "danger"
              ? "text-[var(--danger)]"
              : "text-[var(--text-muted)]"
          }`}
        >
          {hint}
        </p>
        {disabled && disabledNote && (
          <p className="mt-1 text-xs font-medium text-[var(--text-muted)]">
            {disabledNote}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`switch mt-0.5 ${
          disabled ? "cursor-not-allowed opacity-50" : ""
        }`}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

/** Card phần cứng - 3 khối CPU / RAM / GPU (tên + dòng chi tiết) + badges. */
function HardwareCard({ hw }: { hw: HardwareInfo }) {
  const { t } = useT();
  // CPU: "6 cores · 12 threads · up to 4.1 GHz" - phần nào không tra được thì bỏ
  const cpuDetail = [
    hw.cpuCores ? `${hw.cpuCores} cores` : `${hw.cpuThreads} cores`,
    hw.cpuCores ? `${hw.cpuThreads} threads` : null,
    hw.cpuMaxGhz ? `up to ${hw.cpuMaxGhz} GHz` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Tên CPU thường tự chứa "@ x.xGHz" ở cuối - cắt cho gọn (đã có "up to" ở dòng chi tiết)
  const cpuName = hw.cpuModel.replace(/\s*CPU\s*@.*$/i, "").replace(/\s*@.*$/, "").trim();

  const blocks = [
    {
      label: "CPU",
      name: cpuName || t("config.not-detected"),
      detail: cpuDetail,
    },
    {
      label: "RAM",
      name: `${hw.ramGb} GB${hw.ramType ? ` ${hw.ramType}` : ""}`,
      detail: hw.ramSpeedMhz ? `${hw.ramSpeedMhz} MHz` : "",
    },
    {
      label: "GPU",
      name: hw.gpuName || t("config.not-detected"),
      detail:
        [
          hw.gpuVramGb ? `${hw.gpuVramGb} GB` : null,
          hw.nvenc ? "NVENC" : null,
          hw.videotoolbox ? "VideoToolbox" : null,
        ]
          .filter(Boolean)
          .join(" · ") || (hw.gpuName ? t("config.no-gpu-encode") : ""),
    },
  ];
  const cpuOnly = !hw.nvenc && !hw.videotoolbox;
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-1.5">
          {t("config.hardware")}
          <InfoHint
            titleKey="help.config-hardware.title"
            bodyKey="help.config-hardware.body"
            size={14}
          />
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-3">
        {blocks.map((b) => (
          <div key={b.label} className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              {b.label}
            </div>
            <div className="mt-1 truncate text-sm font-semibold" title={b.name}>
              {b.name}
            </div>
            {b.detail && (
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">{b.detail}</div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
        <span className="text-xs text-[var(--text-muted)]">
          {t("config.os")} {PLATFORM_LABELS[hw.platform] ?? hw.platform}
        </span>
        <span className="grow" />
        {hw.nvenc && (
          <span className="badge badge-success">
            <span className="badge-dot" />
            {t("config.nvenc-badge")}
          </span>
        )}
        {hw.videotoolbox && (
          <span className="badge badge-success">
            <span className="badge-dot" />
            VideoToolbox + Fast Capture (macOS)
          </span>
        )}
        {cpuOnly && (
          <span className="badge badge-muted">
            <span className="badge-dot" />
            {t("config.cpu-only")}
          </span>
        )}
      </div>
      <p className="mt-3 text-xs text-[var(--text-muted)]">
        {t("config.portable-note")}
      </p>
    </Card>
  );
}

const APPLIED_NOTICE_MS = 2500;

export default function ConfigPage() {
  const { t, tf } = useT();
  const [data, setData] = useState<RenderSettingsResponse | null>(null);
  const dataRef = useRef<RenderSettingsResponse | null>(null);
  dataRef.current = data;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const appliedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    getRenderSettings()
      .then((res) => {
        if (!alive) return;
        setData(res);
        setLoadError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
      if (appliedTimer.current) clearTimeout(appliedTimer.current);
    };
  }, []);

  const flashApplied = useCallback(() => {
    setApplied(true);
    if (appliedTimer.current) clearTimeout(appliedTimer.current);
    appliedTimer.current = setTimeout(
      () => setApplied(false),
      APPLIED_NOTICE_MS
    );
  }, []);

  /**
   * Cập nhật lạc quan + PUT ngay; lỗi thì rollback về settings trước đó.
   * Fetch nằm NGOÀI state updater - updater phải thuần (StrictMode chạy 2 lần
   * → fetch trong updater là double-fire PUT).
   */
  const apply = useCallback(
    (patch: Partial<RenderSettings>) => {
      const d = dataRef.current;
      if (!d) return;
      const prev = d.settings;
      setSaveError(null);
      setData({ ...d, settings: { ...prev, ...patch } });
      updateRenderSettings(patch)
        .then((res) => {
          setData((cur) => (cur ? { ...cur, settings: res.settings } : cur));
          flashApplied();
        })
        .catch((e) => {
          setData((cur) => (cur ? { ...cur, settings: prev } : cur));
          setSaveError(e instanceof Error ? e.message : String(e));
        });
    },
    [flashApplied]
  );

  const settings = data?.settings ?? null;
  const hw = data?.hardware ?? null;
  /** Khuyến nghị theo máy thật - fallback giữ mốc cũ nếu server chưa trả. */
  const rec = data?.recommended ?? RECOMMENDED_FALLBACK;
  const workerOptions = buildWorkerOptions(rec, rec.workers);
  const remotionOptions = buildWorkerOptions(rec, rec.concurrency);
  const workerHint = hw
    ? tf("config.worker-hint", {
        threads: hw.cpuThreads,
        ram: hw.ramGb,
        n: rec.workers,
      })
    : tf("config.recommend-n", { n: rec.workers });
  /** Máy không có encoder GPU nào → 2 toggle encode GPU bị khóa. */
  const gpuEncodeUnavailable = hw ? !hw.nvenc && !hw.videotoolbox : false;
  const gpuEncodeNote = t("config.gpu-note");

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            {t("nav.config")}
            <InfoHint
            titleKey="help.config.title"
            bodyKey="help.config.body"
            size={14}
          />
          </span>
        }
        subtitle={t("config.subtitle")}
      />

      {loadError && (
        <ErrorBanner
          message={t("config.load-error")}
          detail={loadError}
        />
      )}
      {saveError && (
        <ErrorBanner message={t("config.save-error")} detail={saveError} />
      )}

      {/* Đặt TRÊN CÙNG: thiếu ffmpeg/Chrome thì mọi cài đặt phía dưới đều vô nghĩa */}
      <SystemCheckCard />

      {hw && <HardwareCard hw={hw} />}

      {settings && data && (
        <Card
          title={
            <span className="inline-flex items-center gap-1.5">
              {t("config.render-settings")}
              <InfoHint
                titleKey="help.config-render.title"
                bodyKey="help.config-render.body"
                size={14}
              />
            </span>
          }
          actions={
            <div className="flex items-center gap-3">
              {applied && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--success)]">
                  <Check size={13} strokeWidth={2} className="shrink-0" />
                  {t("config.applied")}
                </span>
              )}
              <Button
                variant="secondary"
                small
                onClick={() => apply({ ...data.defaults })}
              >
                <RotateCcw size={13} strokeWidth={2} />
                {t("config.restore-defaults")}
              </Button>
            </div>
          }
        >
          {/* 2 cột nội bộ trên md+ - mỗi cột một nhóm setting, mobile xếp dọc */}
          <div className="grid md:grid-cols-2 md:gap-x-10">
            {/* Cột trái: HyperFrames capture + encode GPU */}
            <div className="divide-y divide-[var(--border)] pb-4 md:pb-0">
              <FieldRow
                label={t("config.workers")}
                hint={workerHint}
              >
                <SegGroup
                  ariaLabel={t("config.workers-aria")}
                  options={workerOptions}
                  value={settings.workers}
                  onSelect={(v) => apply({ workers: v ?? 0 })}
                />
              </FieldRow>

              <ToggleRow
                id="acc-browser-gpu"
                label={t("config.browser-gpu")}
                hint={t("config.browser-gpu-hint")}
                checked={settings.browserGpu}
                onChange={(v) => apply({ browserGpu: v })}
              />

              <ToggleRow
                id="acc-gpu-draft"
                label={t("config.gpu-draft")}
                hint={t("config.gpu-draft-hint")}
                checked={settings.gpuEncodeDraft}
                disabled={gpuEncodeUnavailable}
                disabledNote={gpuEncodeNote}
                onChange={(v) => apply({ gpuEncodeDraft: v })}
              />

              <ToggleRow
                id="acc-gpu-final"
                label={t("config.gpu-final")}
                hint={t("config.gpu-final-hint")}
                hintTone="danger"
                checked={settings.gpuEncodeFinal}
                disabled={gpuEncodeUnavailable}
                disabledNote={gpuEncodeNote}
                onChange={(v) => apply({ gpuEncodeFinal: v })}
              />
            </div>

            {/* Cột phải: capture nhanh + concurrency + draft fps */}
            <div className="divide-y divide-[var(--border)] border-t border-[var(--border)] pt-4 md:border-t-0 md:pt-0">
              <ToggleRow
                id="acc-fast-capture"
                label="Fast capture (macOS)"
                hint={t("config.fast-capture-hint")}
                checked={settings.fastCapture}
                onChange={(v) => apply({ fastCapture: v })}
              />

              <FieldRow
                label="Remotion concurrency"
                hint={tf("config.remotion-hint", { n: rec.concurrency })}
              >
                <SegGroup
                  ariaLabel="Remotion concurrency"
                  options={remotionOptions}
                  value={settings.remotionConcurrency}
                  onSelect={(v) => apply({ remotionConcurrency: v ?? 0 })}
                />
              </FieldRow>

              <FieldRow
                label={t("config.queue-concurrency")}
                hint={t("config.queue-hint")}
              >
                <SegGroup
                  ariaLabel={t("config.queue-aria")}
                  options={QUEUE_OPTIONS}
                  value={settings.queueConcurrency}
                  onSelect={(v) => apply({ queueConcurrency: v ?? 1 })}
                />
              </FieldRow>

              <FieldRow
                label="Draft fps"
                hint={t("config.draft-fps-hint")}
              >
                <SegGroup
                  ariaLabel={t("config.draft-fps-aria")}
                  options={DRAFT_FPS_OPTIONS}
                  value={settings.draftFps}
                  onSelect={(v) => apply({ draftFps: v })}
                />
              </FieldRow>

              {/* Cổng QC - server mặc định BẬT; server cũ chưa có field này thì
                  vẫn coi như bật để UI không hiện sai trạng thái an toàn */}
              <ToggleRow
                id="acc-qc-gate"
                label={t("qc.gate-label")}
                hint={t("qc.gate-hint")}
                checked={settings.qcGate !== false}
                onChange={(v) => apply({ qcGate: v })}
              />

              {/* Kênh cập nhật - server mặc định "stable"; server cũ chưa trả
                  field này thì vẫn hiện "stable" cho khớp hành vi thật */}
              <FieldRow
                label={t("config.update-channel")}
                hint={t("config.update-channel-hint")}
              >
                <SegGroup
                  ariaLabel={t("config.update-channel-aria")}
                  options={UPDATE_CHANNEL_OPTIONS}
                  value={settings.updateChannel ?? "stable"}
                  onSelect={(v) => apply({ updateChannel: v })}
                />
              </FieldRow>
            </div>
          </div>
        </Card>
      )}

      {!data && !loadError && (
        // Skeleton trong lúc chờ GET /api/render-settings
        <>
          <div className="card h-[140px] animate-pulse bg-[var(--bg-subtle)]" />
          <div className="card h-[360px] animate-pulse bg-[var(--bg-subtle)]" />
        </>
      )}
    </div>
  );
}
