/** Helpers định dạng hiển thị — tiếng Việt. */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** "hh:mm:ss dd/MM/yyyy" (24h, pad 0); null/invalid → "—". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "5 phút trước", "2 giờ trước"… */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "vừa xong";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} phút trước`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} ngày trước`;
  return formatDateTime(iso);
}

/** Thời lượng job từ startedAt → finishedAt (hoặc now). */
export function formatJobDuration(
  startedAt: string | null,
  finishedAt: string | null
): string {
  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  const sec = Math.max(0, Math.round((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}p ${sec % 60}s`;
}

export function formatDurationMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  return `${min}p ${Math.round(sec % 60)}s`;
}

/** Số token gọn: 950 → "950", 1234 → "1.2K", 3400000 → "3.4M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  const units = [
    { v: 1e9, s: "B" },
    { v: 1e6, s: "M" },
    { v: 1e3, s: "K" },
  ];
  for (const { v, s } of units) {
    if (n >= v) {
      const value = n / v;
      return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")}${s}`;
    }
  }
  return String(Math.round(n));
}

/** Chi phí USD: 0 → "$0", nhỏ hơn 1 cent → 4 chữ số lẻ. */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

export const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Slug kebab-case từ tên tiếng Việt: bỏ dấu (NFD), đ→d, lowercase, gạch nối. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** File "mới" — sửa đổi trong vòng 3 phút (badge "mới" trong danh sách asset/render). */
export function isRecentFile(mtime: string, windowMs = 3 * 60_000): boolean {
  const t = new Date(mtime).getTime();
  return Number.isFinite(t) && Date.now() - t < windowMs;
}
