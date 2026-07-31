import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  center,
  actions,
}: {
  title: string;
  subtitle?: string;
  /** Nội dung giữa hàng header (vd timeline giai đoạn) — cùng hàng, wrap khi hẹp. */
  center?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">{subtitle}</p>
        )}
      </div>
      {center && <div className="min-w-0">{center}</div>}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
