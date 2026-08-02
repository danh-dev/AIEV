"use client";

/**
 * Chọn giọng đọc cho tab "Text to video": model TTS + giọng + "cách đọc".
 *
 * Vì sao không dùng một <select> khổng lồ: có khoảng 30 giọng, mỗi giọng chỉ
 * khác nhau ở CHẤT giọng - nhìn tên không đoán được. Người dùng cần lọc theo
 * chữ và NGHE THỬ trước khi chọn, việc đó một select không làm được.
 *
 * Nghe thử tốn tiền (mỗi lần bấm là một lần tổng hợp thật) nên: chỉ phát khi
 * bấm nút, không tự phát lúc mở trang hay khi rê chuột, và mỗi lúc chỉ một
 * giọng được phát - bấm giọng khác thì giọng đang phát dừng ngay.
 */

import {
  AlertTriangle,
  Loader2,
  Play,
  Search,
  Square,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  getTtsModels,
  getTtsVoices,
  previewTtsVoice,
  type TextToVideoVoice,
  type TtsModel,
  type TtsVoice,
} from "@/lib/api";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { useT } from "@/lib/i18n";

/** Chữ cái đầu của tên giọng - nhóm để mắt quét theo cụm thay vì đọc cả 30 dòng. */
function groupKey(name: string): string {
  const c = name.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
}

/**
 * Phần mô tả chất giọng. Server có thể trả label kèm sẵn tên ("Kore - Chắc
 * chắn") - cắt tên đi để dòng dưới không lặp lại đúng chữ vừa hiện ở dòng trên.
 */
function timbre(v: TtsVoice): string {
  if (!v.label.startsWith(v.name)) return v.label;
  const rest = v.label.slice(v.name.length).replace(/^\s*[-–—:]\s*/, "");
  return rest || v.label;
}

export function VoicePicker({
  value,
  onChange,
  /** Câu mẫu để nghe thử - thường là đoạn đầu kịch bản; rỗng thì server tự chọn. */
  previewText = "",
  disabled = false,
}: {
  value: TextToVideoVoice;
  /** Chỉ gửi phần vừa đổi - cha tự merge để không nuốt thay đổi song song. */
  onChange: (patch: Partial<TextToVideoVoice>) => void;
  previewText?: string;
  disabled?: boolean;
}) {
  const { t, tf } = useT();

  const [models, setModels] = useState<TtsModel[] | null>(null);
  const [voices, setVoices] = useState<TtsVoice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");

  // Nghe thử: một audio element dùng chung - mỗi lúc chỉ một giọng được phát
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingVoice, setLoadingVoice] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getTtsModels(), getTtsVoices()])
      .then(([m, v]) => {
        if (!alive) return;
        setModels(m);
        setVoices(v);
        setLoadError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setModels([]);
        setVoices([]);
        setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Dừng tiếng đang phát và thu hồi blob URL - gọi trước mỗi lần phát mới. */
  function stop() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPlaying(null);
  }

  // Rời trang giữa lúc đang phát → tắt tiếng, không để audio chạy mồ côi
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, []);

  async function togglePreview(name: string) {
    if (disabled) return;
    if (playing === name) {
      stop();
      return;
    }
    stop();
    if (loadingVoice) return; // đang chờ một bản nghe thử khác - đừng đặt thêm
    setLoadingVoice(name);
    setPreviewError(null);
    try {
      const blob = await previewTtsVoice({
        voice: name,
        model: value.model,
        style: value.style,
        ...(previewText.trim() ? { text: previewText.trim().slice(0, 300) } : {}),
      });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => stop();
      audio.onerror = () => {
        stop();
        setPreviewError(tf("ttv.voice.preview-error", { name }));
      };
      audioRef.current = audio;
      urlRef.current = url;
      setPlaying(name);
      await audio.play().catch(() => stop());
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingVoice(null);
    }
  }

  const list = voices ?? [];
  const q = query.trim().toLowerCase();
  const filtered = q
    ? list.filter(
        (v) =>
          v.name.toLowerCase().includes(q) || v.label.toLowerCase().includes(q)
      )
    : list;

  // Nhóm theo chữ cái đầu, giữ thứ tự bảng chữ cái
  const groups = new Map<string, TtsVoice[]>();
  for (const v of [...filtered].sort((a, b) => a.name.localeCompare(b.name))) {
    const k = groupKey(v.name);
    const bucket = groups.get(k);
    if (bucket) bucket.push(v);
    else groups.set(k, [v]);
  }
  const groupList = [...groups.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  // Giọng đã lưu không (chưa) có trong danh sách → vẫn cho hiện, không âm thầm mất
  const selectedMissing =
    value.name !== "" && list.length > 0 && !list.some((v) => v.name === value.name);
  const modelMissing =
    value.model !== null &&
    models !== null &&
    !models.some((m) => m.id === value.model);

  return (
    <div className="flex flex-col gap-4">
      {/* Không lấy được danh sách = gần như luôn do thiếu khóa Gemini - nói thẳng
          cách sửa thay vì để người dùng nhìn một khung trống */}
      {loadError && (
        <div className="flex flex-col gap-1.5">
          <ErrorBanner message={t("ttv.voice.load-error")} detail={loadError} />
          <p className="text-xs text-[var(--text-muted)]">
            {t("ttv.voice.gemini-hint")}
          </p>
        </div>
      )}

      {/* 1. Model TTS */}
      <div>
        <label className="label" htmlFor="ttv-tts-model">
          {t("ttv.voice.model")}
          <InfoHint
            className="ml-1.5 align-middle"
            titleKey="help.ttv-voice-model.title"
            bodyKey="help.ttv-voice-model.body"
          />
        </label>
        <select
          id="ttv-tts-model"
          className="input"
          value={value.model ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ model: e.target.value || null })}
        >
          <option value="">{t("ttv.voice.model-default")}</option>
          {modelMissing && <option value={value.model!}>{value.model}</option>}
          {(models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* 2. Danh sách giọng - lọc bằng ô tìm, nghe thử từng giọng */}
      <div>
        <span className="label">
          {t("ttv.voice.voice")}
          <InfoHint
            className="ml-1.5 align-middle"
            titleKey="help.ttv-voice.title"
            bodyKey="help.ttv-voice.body"
          />
        </span>

        <div className="relative mb-2">
          <Search
            size={14}
            strokeWidth={2}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            className="input pl-8"
            value={query}
            disabled={disabled}
            aria-label={t("ttv.voice.search")}
            placeholder={t("ttv.voice.search")}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {previewError && (
          <div className="mb-2">
            <ErrorBanner message={t("ttv.voice.preview-failed")} detail={previewError} />
          </div>
        )}

        {voices === null ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        ) : groupList.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">
            {list.length === 0 ? t("ttv.voice.none") : t("ttv.voice.no-match")}
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label={t("ttv.voice.voice")}
            className="max-h-[320px] overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-2"
          >
            {selectedMissing && (
              <p className="mb-2 flex items-start gap-1.5 px-1 text-xs text-[var(--text-muted)]">
                <AlertTriangle
                  size={13}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0 text-[var(--danger)]"
                />
                {tf("ttv.voice.missing", { name: value.name })}
              </p>
            )}
            {groupList.map(([letter, items]) => (
              <div key={letter} className="mb-2 last:mb-0">
                <p className="px-1 pb-1 text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                  {letter}
                </p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 2xl:grid-cols-3">
                  {items.map((v) => {
                    const active = value.name === v.name;
                    const isLoading = loadingVoice === v.name;
                    const isPlaying = playing === v.name;
                    return (
                      <div
                        key={v.name}
                        className={`flex min-w-0 items-center gap-2 rounded-[var(--radius)] border p-2 transition-colors duration-150 ${
                          active
                            ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                            : "border-[var(--border)] bg-[var(--surface)]"
                        }`}
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={disabled}
                          onClick={() => onChange({ name: v.name })}
                          className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                        >
                          <span
                            className={`block truncate text-[13px] font-semibold ${
                              active ? "text-[var(--primary)]" : "text-[var(--text)]"
                            }`}
                          >
                            {v.name}
                          </span>
                          <span className="block truncate text-[11px] leading-snug text-[var(--text-muted)]">
                            {timbre(v)}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={disabled || (loadingVoice !== null && !isLoading)}
                          title={
                            isPlaying ? t("ttv.voice.stop") : t("ttv.voice.preview")
                          }
                          aria-label={
                            isPlaying
                              ? tf("ttv.voice.stop-aria", { name: v.name })
                              : tf("ttv.voice.preview-aria", { name: v.name })
                          }
                          onClick={() => togglePreview(v.name)}
                          className={`shrink-0 rounded-[var(--radius)] p-1.5 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
                            isPlaying
                              ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                              : "text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
                          }`}
                        >
                          {isLoading ? (
                            <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                          ) : isPlaying ? (
                            <Square size={14} strokeWidth={2} />
                          ) : (
                            <Play size={14} strokeWidth={2} />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--text-muted)]">
          <Volume2 size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
          {t("ttv.voice.preview-cost")}
        </p>
      </div>

      {/* 3. Cách đọc - prompt tự do, đổi là thời lượng đổi theo */}
      <div>
        <label className="label" htmlFor="ttv-voice-style">
          {t("ttv.voice.style")}
          <InfoHint
            className="ml-1.5 align-middle"
            titleKey="help.ttv-voice-style.title"
            bodyKey="help.ttv-voice-style.body"
          />
        </label>
        <input
          id="ttv-voice-style"
          className="input"
          value={value.style}
          disabled={disabled}
          placeholder={t("ttv.voice.style-placeholder")}
          onChange={(e) => onChange({ style: e.target.value })}
        />
        <p className="mt-1 flex items-start gap-1.5 text-xs text-[var(--danger)]">
          <AlertTriangle size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
          {t("ttv.voice.style-warning")}
        </p>
      </div>
    </div>
  );
}
