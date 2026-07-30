"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * Đọc/ghi localStorage("theme"), áp data-theme lên <html>.
 * Mặc định "light". Script inline trong layout đã chống FOUC.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current =
      document.documentElement.getAttribute("data-theme") === "dark"
        ? "dark"
        : "light";
    setTheme(current);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // localStorage bị chặn — vẫn đổi theme cho phiên hiện tại
    }
    if (next === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Chuyển giao diện sáng" : "Chuyển giao diện tối"}
      title={theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
      className="flex h-9 w-9 items-center justify-center rounded-[var(--radius)] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
    >
      {theme === "dark" ? (
        <Sun size={18} strokeWidth={1.75} />
      ) : (
        <Moon size={18} strokeWidth={1.75} />
      )}
    </button>
  );
}
