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
    <div className="relative mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">{subtitle}</p>
        )}
      </div>
      {/* Màn rộng: căn giữa TUYỆT ĐỐI theo hàng (đúng giữa màn hình nội dung);
          màn hẹp: xuống hàng bình thường nhờ flex-wrap */}
      {center && (
        <div className="min-w-0 lg:absolute lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2">
          {center}
        </div>
      )}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
