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
  ScrollText,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getHealth, type Health } from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Videos Project", icon: Clapperboard },
  { href: "/images", label: "Images Project", icon: Images },
  { href: "/styles", label: "Style Design", icon: Palette },
  { href: "/queue", label: "Render Queue", icon: ListVideo },
  { href: "/assets", label: "Assets", icon: FolderOpen },
  { href: "/sfx", label: "Sound Effects", icon: AudioLines },
  { href: "/prompts", label: "Prompts", icon: ScrollText },
  { href: "/skills", label: "Skills", icon: BookOpen },
  { href: "/config", label: "Cấu hình", icon: Settings2 },
  { href: "/connections", label: "Kết nối", icon: Plug },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function pageTitle(pathname: string): string {
  const item = NAV.filter((n) => isActive(pathname, n.href)).sort(
    (a, b) => b.href.length - a.href.length
  )[0];
  return item?.label ?? "Dashboard";
}

const HEALTH_POLL_MS = 30_000;

function BackendStatus() {
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
      ? "Đang kiểm tra backend…"
      : ok
        ? "Backend hoạt động"
        : reachable
          ? "Backend thiếu thành phần"
          : "Không kết nối được backend";

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
  const pathname = usePathname();

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
        <span className="text-sm font-semibold">{pageTitle(pathname)}</span>
        <div className="ml-auto flex items-center gap-3">
          <BackendStatus />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[220px] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg-subtle)] p-3">
          <nav className="flex flex-col gap-1">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`nav-item ${isActive(pathname, href) ? "active" : ""}`}
              >
                <Icon size={18} strokeWidth={1.75} className="shrink-0" />
                {label}
              </Link>
            ))}
          </nav>
        </aside>

        {/* FULL WIDTH — không max-width, dùng tối đa không gian màn hình */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="w-full p-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
