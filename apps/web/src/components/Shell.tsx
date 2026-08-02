"use client";

import {
  AudioLines,
  BookOpen,
  Clapperboard,
  ExternalLink,
  FileText,
  FolderOpen,
  Images,
  LayoutDashboard,
  ListVideo,
  Palette,
  Plug,
  Scissors,
  ScrollText,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getHealth, type Health } from "@/lib/api";
import { HardwareMeter } from "@/components/HardwareMeter";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UpdateBadge } from "@/components/UpdateBadge";
import { useT } from "@/lib/i18n";

/** Mã nguồn dự án - hiện ở cuối sidebar, ngay trên badge phiên bản */
const REPO_URL = "https://github.com/giapducthang/AIEV";

/**
 * Logo GitHub dạng SVG inline. Lucide đã bỏ icon thương hiệu khỏi bộ chính nên
 * không import được `Github`; dự án lại cấm icon font/PNG, nên vẽ thẳng path.
 */
function GithubMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const NAV = [
  { href: "/", label: "nav.dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "nav.projects", icon: Clapperboard },
  { href: "/images", label: "nav.images", icon: Images },
  { href: "/auto-cut", label: "nav.auto-cut", icon: Scissors },
  { href: "/text-to-video", label: "nav.text-to-video", icon: FileText },
  { href: "/styles", label: "nav.styles", icon: Palette },
  { href: "/queue", label: "nav.queue", icon: ListVideo },
  { href: "/assets", label: "nav.assets", icon: FolderOpen },
  { href: "/sfx", label: "nav.sfx", icon: AudioLines },
  { href: "/prompts", label: "nav.prompts", icon: ScrollText },
  { href: "/skills", label: "nav.skills", icon: BookOpen },
  { href: "/config", label: "nav.config", icon: Settings2 },
  { href: "/connections", label: "nav.connections", icon: Plug },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function pageTitle(pathname: string): string {
  const item = NAV.filter((n) => isActive(pathname, n.href)).sort(
    (a, b) => b.href.length - a.href.length
  )[0];
  return item?.label ?? "nav.dashboard";
}

const HEALTH_POLL_MS = 30_000;

function BackendStatus() {
  const { t } = useT();
  const [health, setHealth] = useState<Health | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const h = await getHealth();
        if (!alive) return;
        setHealth(h);
        setReachable(true);
      } catch {
        if (!alive) return;
        setHealth(null);
        setReachable(false);
      }
    }
    check();
    const timer = setInterval(check, HEALTH_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const ok = reachable === true && health?.ok === true;
  const label =
    reachable === null
      ? t("shell.backend-checking")
      : ok
        ? t("shell.backend-ok")
        : reachable
          ? t("shell.backend-partial")
          : t("shell.backend-unreachable");

  return (
    <div className="flex items-center gap-2" title={label}>
      <span
        className={`h-2 w-2 rounded-full ${
          ok ? "bg-[var(--success)]" : "bg-[var(--danger)]"
        } ${reachable === null ? "opacity-40" : ""}`}
      />
      <span className="hidden text-xs text-[var(--text-muted)] md:inline">
        {label}
      </span>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { t } = useT();
  const pathname = usePathname();

  // Trang mobile /m/<id> (điện thoại quét QR upload) - layout riêng tối giản,
  // không header/sidebar của dashboard.
  if (pathname === "/m" || pathname.startsWith("/m/")) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4">
        <Link href="/" className="flex shrink-0 items-center">
          {/* Logo đổi theo theme qua CSS trong globals.css */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-duong-ban.png"
            alt="noti.vn"
            className="logo-light h-7 w-auto"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-am-ban.png"
            alt="noti.vn"
            className="logo-dark h-7 w-auto"
          />
        </Link>
        <span className="text-sm font-semibold">{t(pageTitle(pathname))}</span>
        <div className="ml-auto flex items-center gap-3">
          <HardwareMeter />
          <BackendStatus />
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[220px] shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--bg-subtle)] p-3">
          <nav className="flex flex-col gap-1">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`nav-item ${isActive(pathname, href) ? "active" : ""}`}
              >
                <Icon size={18} strokeWidth={1.75} className="shrink-0" />
                {t(label)}
              </Link>
            ))}
          </nav>
          {/* Cuối sidebar: link mã nguồn nằm TRÊN badge phiên bản - hai thứ này
              cùng nói về "bản dựng nào đang chạy" nên đứng cạnh nhau. */}
          <div className="mt-auto flex flex-col gap-1 pt-3">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              title={REPO_URL}
              className="inline-flex items-center gap-2 rounded-[var(--radius)] px-2 py-1 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface)] hover:text-[var(--text)]"
            >
              <GithubMark size={14} />
              <span className="min-w-0 flex-1 truncate">{t("nav.source")}</span>
              <ExternalLink
                size={12}
                strokeWidth={2}
                className="shrink-0 opacity-60"
              />
            </a>
            <UpdateBadge />
          </div>
        </aside>

        {/* FULL WIDTH - không max-width, dùng tối đa không gian màn hình */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="w-full p-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
