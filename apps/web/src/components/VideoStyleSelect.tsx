"use client";

/**
 * Chọn PHONG CÁCH DỰNG cho video (giấy gấp, mực tàu, người que...).
 *
 * VÌ SAO KHÔNG DÙNG <select>: có 20 phong cách, mà cái tên tự nó không nói được
 * video sẽ trông ra sao - "Đông Hồ" hay "cắt dán báo" chỉ có nghĩa với người đã
 * biết. Người dùng cần đọc được MÔ TẢ và CÁCH CHUYỂN ĐỘNG trước khi chọn, việc
 * đó một select không làm được.
 *
 * VÌ SAO MẶC ĐỊNH LÀ "AI tự quyết": đây là hành vi cũ của hệ thống trước khi có
 * tính năng này. Ép một phong cách làm mặc định là âm thầm đổi kết quả của mọi
 * project cũ khi chúng được dựng lại.
 */

import { Check, Palette, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getVideoStyles, type VideoStyle } from "@/lib/api";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useT } from "@/lib/i18n";

/** Tên + mô tả ưu tiên bản dịch; phong cách mới chưa có key thì lùi về dữ liệu server. */
function nameOf(s: VideoStyle, t: (k: string) => string): string {
  const key = `vstyle.${s.id}.name`;
  const v = t(key);
  return v === key ? s.name : v;
}

function descOf(s: VideoStyle, t: (k: string) => string): string {
  const key = `vstyle.${s.id}.desc`;
  const v = t(key);
  // Không có mô tả riêng thì hiện cách chuyển động - vẫn hữu ích hơn là để trống
  return v === key ? s.motion : v;
}

export function VideoStyleSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const [styles, setStyles] = useState<VideoStyle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    getVideoStyles()
      .then((list) => {
        if (!alive) return;
        setStyles(list);
        setError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setStyles([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const list = useMemo(() => styles ?? [], [styles]);
  const q = query.trim().toLowerCase();
  // Tìm cả trong tên ĐÃ DỊCH và mô tả - gõ "paper" ở bản tiếng Anh phải ra được
  const filtered = q
    ? list.filter(
        (s) =>
          nameOf(s, t).toLowerCase().includes(q) ||
          descOf(s, t).toLowerCase().includes(q) ||
          s.id.includes(q)
      )
    : list;

  const selected = list.find((s) => s.id === value) ?? null;
  // Phong cách đã lưu nhưng không còn trong catalog - nói ra chứ đừng im lặng bỏ
  const missing = value !== null && list.length > 0 && !selected;

  return (
    <div className="flex flex-col gap-2">
      {error && <ErrorBanner message={t("vstyle.load-error")} detail={error} />}

      {/* Dòng tóm tắt: danh sách cuộn trong khung riêng nên chọn xong kéo đi chỗ
          khác là quên mất mình đã chọn gì */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2">
        <span className="shrink-0 text-xs text-[var(--text-muted)]">
          {t("vstyle.selected")}
        </span>
        {selected ? (
          <>
            <span className="min-w-0 text-sm font-semibold text-[var(--primary)]">
              {nameOf(selected, t)}
            </span>
            {selected.palette === "loose" && (
              <span className="shrink-0 rounded-full bg-[var(--danger-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--danger)]">
                {t("vstyle.loose-badge")}
              </span>
            )}
          </>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-[var(--text-muted)]">
            <Sparkles size={13} strokeWidth={2} className="shrink-0" />
            {t("vstyle.auto")}
          </span>
        )}
      </div>

      {missing && (
        <p className="text-xs text-[var(--danger)]">{t("vstyle.missing")}</p>
      )}

      {list.length > 8 && (
        <div className="relative">
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
            aria-label={t("vstyle.search")}
            placeholder={t("vstyle.search")}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {styles === null ? (
        <p className="py-4 text-center text-sm text-[var(--text-muted)]">
          {t("common.loading")}
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-label={t("vstyle.label")}
          className="max-h-[300px] overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-2"
        >
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 2xl:grid-cols-3">
            {/* "AI tự quyết" là một lựa chọn THẬT trong lưới, không phải nút xóa
                nấp đâu đó - nó là mặc định nên phải nhìn thấy được */}
            <StyleCard
              active={value === null}
              disabled={disabled}
              title={t("vstyle.auto")}
              desc={t("vstyle.auto-desc")}
              loose={false}
              auto
              onSelect={() => onChange(null)}
            />
            {filtered.map((s) => (
              <StyleCard
                key={s.id}
                active={value === s.id}
                disabled={disabled}
                title={nameOf(s, t)}
                desc={descOf(s, t)}
                loose={s.palette === "loose"}
                looseLabel={t("vstyle.loose-badge")}
                onSelect={() => onChange(s.id)}
              />
            ))}
          </div>
          {filtered.length === 0 && q && (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">
              {t("vstyle.no-match")}
            </p>
          )}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-[var(--text-muted)]">
        <Palette size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
        {t("vstyle.vs-style-design")}
      </p>
    </div>
  );
}

function StyleCard({
  active,
  disabled,
  title,
  desc,
  loose,
  looseLabel,
  auto = false,
  onSelect,
}: {
  active: boolean;
  disabled: boolean;
  title: string;
  desc: string;
  loose: boolean;
  looseLabel?: string;
  auto?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onSelect}
      title={desc}
      className={`flex min-w-0 flex-col gap-1 rounded-[var(--radius)] border p-2 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-[var(--primary)] bg-[var(--primary-soft)]"
          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--text-muted)]"
      }`}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        {auto && (
          <Sparkles
            size={12}
            strokeWidth={2}
            aria-hidden="true"
            className={`shrink-0 ${
              active ? "text-[var(--primary)]" : "text-[var(--text-muted)]"
            }`}
          />
        )}
        <span
          className={`min-w-0 text-[13px] leading-snug font-semibold ${
            active ? "text-[var(--primary)]" : "text-[var(--text)]"
          }`}
        >
          {title}
        </span>
        {loose && looseLabel && (
          <span className="shrink-0 rounded-full bg-[var(--danger-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--danger)]">
            {looseLabel}
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
      {/* Cho XUỐNG DÒNG chứ không cắt: mô tả bị cắt còn nửa câu thì đúng phần
          giúp người dùng phân biệt hai phong cách lại là phần mất đi. Giới hạn
          3 dòng để thẻ không cao lệch nhau quá nhiều. */}
      <span className="line-clamp-3 text-[11px] leading-snug text-[var(--text-muted)]">
        {desc}
      </span>
    </button>
  );
}
