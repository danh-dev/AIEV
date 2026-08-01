"use client";

/**
 * Modal "Cắt video mới" - gom cả 4 bước (nguồn / cách cắt / đầu ra / tùy chọn)
 * vào MỘT form: người dùng nhìn thấy toàn bộ lựa chọn cùng lúc, không phải bấm
 * qua nhiều bước wizard cho một thao tác chỉ mất 30 giây.
 *
 * Bấm nút cuối = POST tạo phiên rồi POST /plan luôn - phiên "draft" không có
 * giá trị gì với người dùng, họ tạo là để hệ thống đọc video ngay.
 */

import { ChevronDown, ChevronRight, Loader2, Scissors, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUTO_CUT_DEFAULT_PARAMS,
  createAutoCut,
  getAutoCutSources,
  planAutoCut,
  uploadAsset,
  type AutoCutAspect,
  type AutoCutBackground,
  type AutoCutLayout,
  type AutoCutMode,
  type AutoCutParams,
  type Brief,
  type FileInfo,
} from "@/lib/api";
import { useUploadEvents } from "@/lib/useEvents";
import { Button } from "@/components/Button";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { Modal } from "@/components/Modal";
import { ProgressBar } from "@/components/ProgressBar";
import { StyleSelect } from "@/components/StyleSelect";
import {
  BriefFields,
  DEFAULT_BRIEF,
  MUSIC_MODE_LABEL,
  SFX_MODE_LABEL,
} from "@/components/BriefFields";
import {
  BACKGROUND_DESC,
  BACKGROUND_LABEL,
  LAYOUT_DESC,
  LAYOUT_LABEL,
  MODE_DESC,
  MODE_LABEL,
  aspectSize,
  clock,
} from "@/components/AutoCutCommon";
import { formatBytes } from "@/lib/format";
import { useT } from "@/lib/i18n";

const MODES: AutoCutMode[] = ["time", "ai", "prompt"];
const ASPECTS: AutoCutAspect[] = ["keep", "9:16", "16:9", "1:1", "4:5"];
const LAYOUTS: AutoCutLayout[] = ["auto", "crop", "fit"];
const BACKGROUNDS: AutoCutBackground[] = ["gemini", "blur", "style"];

/**
 * Brief gửi lên khi tạo phiên. Bỏ `styleId` vì style của phiên đã lấy từ
 * output.styleId (ô Style Design phía trên) - gửi thêm chỉ gây hiểu nhầm là có
 * hai chỗ chọn style.
 */
function briefPayload(brief: Brief): Partial<Brief> {
  const payload: Partial<Brief> = { ...brief };
  delete payload.styleId;
  return payload;
}

/** Thẻ chọn được (mode / layout / nền): tiêu đề + một dòng giải thích. */
function OptionCard({
  active,
  disabled,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-w-[180px] flex-1 flex-col gap-0.5 rounded-[var(--radius)] border p-3 text-left transition-colors duration-150 ${
        active
          ? "border-[var(--primary)] bg-[var(--primary-soft)]"
          : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg-subtle)]"
      } disabled:cursor-not-allowed disabled:opacity-45`}
    >
      <span
        className={`text-[13px] font-semibold ${
          active ? "text-[var(--primary)]" : "text-[var(--text)]"
        }`}
      >
        {title}
      </span>
      <span className="text-[11px] leading-snug text-[var(--text-muted)]">
        {desc}
      </span>
    </button>
  );
}

/** Ô nhập số nhỏ - dùng cho phút/giây/số đoạn. */
function NumField({
  label,
  value,
  min,
  disabled,
  onChange,
  width = "w-28",
}: {
  label: string;
  value: string;
  min: number;
  disabled?: boolean;
  onChange: (v: string) => void;
  width?: string;
}) {
  return (
    <label className={`flex ${width} flex-col gap-1 text-xs text-[var(--text-muted)]`}>
      {label}
      <input
        className="input"
        type="number"
        min={min}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function AutoCutCreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Gọi khi phiên đã tạo xong - trang cha điều hướng sang chi tiết. */
  onCreated: (sessionId: string) => void;
}) {
  const { t, tf } = useT();

  // ---- Nguồn ----
  const [sources, setSources] = useState<FileInfo[] | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [sourceRel, setSourceRel] = useState("");
  const [name, setName] = useState("");

  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ---- Cách cắt ----
  const [mode, setMode] = useState<AutoCutMode>("time");
  const [minutes, setMinutes] = useState(String(AUTO_CUT_DEFAULT_PARAMS.minutes));
  const [overlapSec, setOverlapSec] = useState(
    String(AUTO_CUT_DEFAULT_PARAMS.overlapSec)
  );
  const [count, setCount] = useState(String(AUTO_CUT_DEFAULT_PARAMS.count));
  const [minSec, setMinSec] = useState(String(AUTO_CUT_DEFAULT_PARAMS.minSec));
  const [maxSec, setMaxSec] = useState(String(AUTO_CUT_DEFAULT_PARAMS.maxSec));
  const [request, setRequest] = useState("");

  // ---- Đầu ra ----
  const [aspect, setAspect] = useState<AutoCutAspect>("9:16");
  const [layout, setLayout] = useState<AutoCutLayout>("auto");
  const [background, setBackground] = useState<AutoCutBackground>("gemini");
  const [styleId, setStyleId] = useState<string | null>(null);

  // ---- Tùy chọn ----
  const [transcribe, setTranscribe] = useState(true);
  const [autoEdit, setAutoEdit] = useState(false);
  // Kịch bản edit áp cho MỌI video cắt ra - modal đã dài nên mặc định thu gọn
  const [brief, setBrief] = useState<Brief>(DEFAULT_BRIEF);
  const [briefOpen, setBriefOpen] = useState(false);

  // ---- Gửi ----
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Phiên đã tạo nhưng bước /plan lỗi (vd 409 BUSY) - cho người dùng mở phiên
  // chứ không tạo thêm phiên trùng.
  const [createdId, setCreatedId] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    try {
      setSources(await getAutoCutSources());
      setSourcesError(null);
    } catch (e) {
      setSourcesError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Mỗi lần mở modal: nạp lại danh sách nguồn (user vừa copy file vào imports/)
  useEffect(() => {
    if (open) loadSources();
  }, [open, loadSources]);

  // Tiến trình server nhận file - upload vào imports/ không kèm projectId
  useUploadEvents((e) => {
    if (!uploading || e.projectId) return;
    if (e.done) {
      setUploadPct(null);
      return;
    }
    const total = e.total ?? 0;
    setUploadPct(
      total > 0 ? Math.round(((e.received ?? 0) / total) * 100) : null
    );
  });

  async function onPickFile(list: FileList | null) {
    const file = list?.[0];
    if (!file || uploading) return;
    setUploading(true);
    setUploadError(null);
    setUploadPct(0);
    try {
      const info = await uploadAsset(file, "imports");
      await loadSources();
      // Tự chọn file vừa tải - người dùng không phải đi tìm lại trong danh sách
      setSourceRel(info.relPath);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      setUploadPct(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  // mode ai/prompt phải đọc được lời thoại mới chọn được đoạn → ép bật transcribe
  const transcribeLocked = mode === "ai" || mode === "prompt";
  useEffect(() => {
    if (transcribeLocked) setTranscribe(true);
  }, [transcribeLocked]);

  const requestMissing = mode === "prompt" && request.trim().length === 0;
  const canCreate = sourceRel !== "" && !requestMissing && !uploading;

  function buildParams(): AutoCutParams {
    if (mode === "time") {
      return {
        minutes: Number(minutes) || AUTO_CUT_DEFAULT_PARAMS.minutes,
        overlapSec: Number(overlapSec) || 0,
      };
    }
    const common = {
      count: Number(count) || AUTO_CUT_DEFAULT_PARAMS.count,
      minSec: Number(minSec) || AUTO_CUT_DEFAULT_PARAMS.minSec,
      maxSec: Number(maxSec) || AUTO_CUT_DEFAULT_PARAMS.maxSec,
    };
    return mode === "prompt"
      ? { ...common, request: request.trim() }
      : common;
  }

  async function onCreate() {
    if (!canCreate || creating) return;
    setCreating(true);
    setCreateError(null);
    let sessionId = createdId;
    try {
      if (!sessionId) {
        const session = await createAutoCut({
          ...(name.trim() ? { name: name.trim() } : {}),
          sourceRel,
          mode,
          params: buildParams(),
          output: { aspect, layout, background, styleId },
          transcribe,
          autoEdit,
          brief: briefPayload(brief),
        });
        sessionId = session.id;
        setCreatedId(sessionId);
      }
      // Tạo xong là phân tích luôn - đó mới là thứ người dùng chờ
      await planAutoCut(sessionId);
      onCreated(sessionId);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const selectedSource = sources?.find((f) => f.relPath === sourceRel) ?? null;
  // aspect "keep" giữ nguyên khung nguồn nên không có bước đổi khung
  const reframing = aspect !== "keep";
  // crop cắt cúp bám nhân vật, không có vùng trống nào để lấp nền
  const needBackground = reframing && layout !== "crop";

  // Một dòng cho biết kịch bản edit đang đặt gì - đủ để không cần mở khối ra xem
  const yesNo = (v: boolean) => (v ? t("common.yes") : t("common.no"));
  const briefSummary = [
    `${t("brief.subtitles")}: ${yesNo(brief.subtitles)}`,
    `${t("brief.key-layout")}: ${yesNo(brief.keyLayoutEnabled)}`,
    `Sound effect: ${t(SFX_MODE_LABEL[brief.sfxMode])}`,
    `${t("brief.music-label")}: ${t(MUSIC_MODE_LABEL[brief.musicMode])}`,
  ].join(" · ");

  return (
    <Modal
      title={t("autocut.create-title")}
      open={open}
      onClose={() => {
        if (!creating) onClose();
      }}
      wide
      footer={
        <>
          <Button variant="secondary" disabled={creating} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {createdId && createError ? (
            <Button onClick={() => onCreated(createdId)}>
              {t("autocut.open-session")}
            </Button>
          ) : null}
          <Button disabled={!canCreate || creating} onClick={onCreate}>
            {creating ? (
              <Loader2 size={15} strokeWidth={2} className="animate-spin" />
            ) : (
              <Scissors size={15} strokeWidth={2} />
            )}
            {creating ? t("autocut.creating") : t("autocut.create")}
          </Button>
        </>
      }
    >
      {createError && (
        <ErrorBanner
          message={
            createdId ? t("autocut.plan-error-created") : t("autocut.create-error")
          }
          detail={createError}
        />
      )}

      {/* ---- 1. Nguồn ---- */}
      <div>
        <span className="label">{t("autocut.source")}</span>
        {sourcesError && (
          <ErrorBanner message={t("autocut.sources-error")} detail={sourcesError} />
        )}
        <div className="flex flex-wrap items-end gap-2">
          <select
            className="input min-w-[240px] flex-1"
            aria-label={t("autocut.source")}
            value={sourceRel}
            disabled={creating}
            onChange={(e) => setSourceRel(e.target.value)}
          >
            <option value="">
              {sources && sources.length === 0
                ? t("autocut.source-none")
                : t("autocut.source-pick")}
            </option>
            {(sources ?? []).map((f) => (
              <option key={f.relPath} value={f.relPath}>
                {f.name} - {formatBytes(f.size)}
              </option>
            ))}
          </select>
          <input
            ref={fileInput}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files)}
          />
          <Button
            variant="secondary"
            disabled={uploading || creating}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? (
              <Loader2 size={15} strokeWidth={2} className="animate-spin" />
            ) : (
              <Upload size={15} strokeWidth={2} />
            )}
            {uploading ? t("autocut.uploading") : t("autocut.upload")}
          </Button>
        </div>
        {uploading && (
          <div className="mt-2">
            {uploadPct === null ? (
              <div className="progress-indeterminate" />
            ) : (
              <ProgressBar progress={uploadPct} />
            )}
          </div>
        )}
        {uploadError && (
          <div className="mt-2">
            <ErrorBanner message={t("autocut.upload-error")} detail={uploadError} />
          </div>
        )}
        {selectedSource && (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {selectedSource.relPath} · {formatBytes(selectedSource.size)}
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="autocut-name">
          {t("autocut.name")}
        </label>
        <input
          id="autocut-name"
          className="input"
          value={name}
          disabled={creating}
          placeholder={t("autocut.name-placeholder")}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* ---- 2. Cách cắt ---- */}
      <div>
        <span className="label">
          {t("autocut.how")}
          <InfoHint
            className="ml-1.5 align-middle"
            titleKey="help.autocut-mode.title"
            bodyKey="help.autocut-mode.body"
          />
        </span>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <OptionCard
              key={m}
              active={mode === m}
              disabled={creating}
              title={t(MODE_LABEL[m])}
              desc={t(MODE_DESC[m])}
              onClick={() => setMode(m)}
            />
          ))}
        </div>

        {mode === "time" ? (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <NumField
              label={t("autocut.minutes")}
              value={minutes}
              min={1}
              disabled={creating}
              onChange={setMinutes}
            />
            <NumField
              label={t("autocut.overlap")}
              value={overlapSec}
              min={0}
              disabled={creating}
              onChange={setOverlapSec}
            />
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {mode === "prompt" && (
              <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                {t("autocut.request")}
                <textarea
                  className="input"
                  rows={2}
                  value={request}
                  disabled={creating}
                  placeholder={t("autocut.request-placeholder")}
                  onChange={(e) => setRequest(e.target.value)}
                />
                {requestMissing && (
                  <span className="text-[var(--danger)]">
                    {t("autocut.request-required")}
                  </span>
                )}
              </label>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <NumField
                label={t("autocut.count")}
                value={count}
                min={1}
                disabled={creating}
                onChange={setCount}
                width="w-24"
              />
              <NumField
                label={t("autocut.min-sec")}
                value={minSec}
                min={5}
                disabled={creating}
                onChange={setMinSec}
              />
              <NumField
                label={t("autocut.max-sec")}
                value={maxSec}
                min={6}
                disabled={creating}
                onChange={setMaxSec}
              />
            </div>
          </div>
        )}
      </div>

      {/* ---- 3. Đầu ra ---- */}
      <div>
        <span className="label">
          {t("autocut.aspect")}
          <InfoHint
            className="ml-1.5 align-middle"
            titleKey="help.autocut-aspect.title"
            bodyKey="help.autocut-aspect.body"
          />
        </span>
        <div className="flex flex-wrap gap-2">
          {ASPECTS.map((a) => {
            const size = aspectSize(a);
            const active = aspect === a;
            return (
              <button
                key={a}
                type="button"
                disabled={creating}
                aria-pressed={active}
                onClick={() => setAspect(a)}
                className={`flex min-w-[92px] flex-1 flex-col items-center gap-0.5 rounded-[var(--radius)] border px-3 py-2 transition-colors duration-150 ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--bg-subtle)]"
                } disabled:cursor-not-allowed disabled:opacity-45`}
              >
                <span className="text-[13px] font-semibold">
                  {a === "keep" ? t("autocut.aspect.keep") : a}
                </span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {size ? `${size.width}x${size.height}` : t("autocut.aspect.keep-size")}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {reframing ? (
        <>
          <div>
            <span className="label">
              {t("autocut.layout")}
              <InfoHint
                className="ml-1.5 align-middle"
                titleKey="help.autocut-layout.title"
                bodyKey="help.autocut-layout.body"
              />
            </span>
            <div className="flex flex-wrap gap-2">
              {LAYOUTS.map((l) => (
                <OptionCard
                  key={l}
                  active={layout === l}
                  disabled={creating}
                  title={t(LAYOUT_LABEL[l])}
                  desc={t(LAYOUT_DESC[l])}
                  onClick={() => setLayout(l)}
                />
              ))}
            </div>
          </div>

          {needBackground && (
            <div>
              <span className="label">
                {t("autocut.background")}
                <InfoHint
                  className="ml-1.5 align-middle"
                  titleKey="help.autocut-background.title"
                  bodyKey="help.autocut-background.body"
                />
              </span>
              <div className="flex flex-wrap gap-2">
                {BACKGROUNDS.map((b) => (
                  <OptionCard
                    key={b}
                    active={background === b}
                    disabled={creating}
                    title={t(BACKGROUND_LABEL[b])}
                    desc={t(BACKGROUND_DESC[b])}
                    onClick={() => setBackground(b)}
                  />
                ))}
              </div>
              <label className="mt-2 flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                {t("autocut.style")}
                <StyleSelect
                  value={styleId}
                  disabled={creating}
                  onChange={setStyleId}
                />
              </label>
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-[var(--text-muted)]">
          {t("autocut.keep-note")}
        </p>
      )}

      {/* ---- 4. Tùy chọn ---- */}
      <div>
        <span className="label">{t("autocut.options")}</span>
        {/* Nhãn dùng htmlFor thay vì bọc input, để nút (i) là anh em của nhãn
            chứ không nằm TRONG <label> (bấm (i) sẽ tick nhầm checkbox) */}
        <div className="flex items-start gap-2 text-xs">
          <input
            id="autocut-transcribe"
            type="checkbox"
            className="checkbox mt-0.5"
            checked={transcribe}
            disabled={transcribeLocked || creating}
            onChange={(e) => setTranscribe(e.target.checked)}
          />
          <span>
            <label htmlFor="autocut-transcribe" className="cursor-pointer">
              {t("autocut.transcribe")}
            </label>
            <InfoHint
              className="ml-1.5 align-middle"
              titleKey="help.autocut-transcribe.title"
              bodyKey="help.autocut-transcribe.body"
            />
            <span className="block text-[var(--text-muted)]">
              {transcribeLocked
                ? t("autocut.transcribe-locked")
                : t("autocut.transcribe-hint")}
            </span>
          </span>
        </div>
        <div className="mt-2 flex items-start gap-2 text-xs">
          <input
            id="autocut-auto-edit"
            type="checkbox"
            className="checkbox mt-0.5"
            checked={autoEdit}
            disabled={creating}
            onChange={(e) => setAutoEdit(e.target.checked)}
          />
          <span>
            <label htmlFor="autocut-auto-edit" className="cursor-pointer">
              {t("autocut.auto-edit")}
            </label>
            <InfoHint
              className="ml-1.5 align-middle"
              titleKey="help.autocut-autoedit.title"
              bodyKey="help.autocut-autoedit.body"
            />
            <span className="block text-[var(--text-muted)]">
              {t("autocut.auto-edit-hint")}
            </span>
          </span>
        </div>

        {/* Kịch bản edit dùng chung cho cả phiên - cấu hình một lần, mọi video
            cắt ra edit được ngay, khỏi vào từng project chỉnh lại */}
        <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)]">
          <button
            type="button"
            aria-expanded={briefOpen}
            onClick={() => setBriefOpen((v) => !v)}
            className="flex w-full items-start gap-2 rounded-[var(--radius)] p-3 text-left transition-colors duration-150 hover:bg-[var(--bg-subtle)]"
          >
            {briefOpen ? (
              <ChevronDown
                size={15}
                strokeWidth={2}
                className="mt-0.5 shrink-0 text-[var(--text-muted)]"
              />
            ) : (
              <ChevronRight
                size={15}
                strokeWidth={2}
                className="mt-0.5 shrink-0 text-[var(--text-muted)]"
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-[var(--text)]">
                {t("autocut.brief-title")}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">
                {briefOpen ? t("autocut.brief-hint") : briefSummary}
              </span>
            </span>
          </button>
          {briefOpen && (
            <div className="border-t border-[var(--border)] p-3">
              <BriefFields
                value={brief}
                onChange={(p) => setBrief((b) => ({ ...b, ...p }))}
                // Style Design đã có ô riêng phía trên; mô tả từng đoạn do server tự viết
                show={{ styleId: false, sourceDescription: false }}
                disabled={creating}
              />
            </div>
          )}
        </div>
      </div>

      {selectedSource?.relPath && mode === "time" && (
        <p className="text-xs text-[var(--text-muted)]">
          {tf("autocut.time-hint", { minutes: clock(Number(minutes) * 60 || 0) })}
        </p>
      )}
    </Modal>
  );
}
