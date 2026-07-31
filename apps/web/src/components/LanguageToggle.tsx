"use client";

import { useT } from "@/lib/i18n";

/**
 * Nút đổi ngôn ngữ trên header — hiện lá cờ của ngôn ngữ HIỆN TẠI,
 * bấm thì chuyển sang ngôn ngữ còn lại (vi ↔ en).
 * Cờ là SVG tự vẽ trong public/flags/ — không icon font, không emoji.
 */
export function LanguageToggle() {
  const { lang, setLang } = useT();
  const next = lang === "vi" ? "en" : "vi";
  const title = lang === "vi" ? "Switch to English" : "Chuyển sang tiếng Việt";

  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      title={title}
      aria-label={title}
      className="flex h-9 w-9 items-center justify-center rounded-[var(--radius)] transition-colors duration-150 hover:bg-[var(--bg-subtle)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={lang === "vi" ? "/flags/vn.svg" : "/flags/gb.svg"}
        alt={lang === "vi" ? "Tiếng Việt" : "English"}
        width={20}
        height={14}
        className="h-[14px] w-5 rounded-[2px] border border-[var(--border)] object-cover"
      />
    </button>
  );
}
