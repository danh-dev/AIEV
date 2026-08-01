"use client";

import {
  AudioLines,
  BookOpen,
  Clapperboard,
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
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UpdateBadge } from "@/components/UpdateBadge";
import { useT } from "@/lib/i18n";

const NAV = [
  { href: "/", label: "nav.dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "nav.projects", icon: Clapperboard },
  { href: "/images", label: "nav.images", icon: Images },
  { href: "/auto-cut", label: "nav.auto-cut", icon: Scissors },
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
          <div className="mt-auto pt-3">
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
