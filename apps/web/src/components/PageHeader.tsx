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
    <div className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {/* Hàng 2: subtitle (kích thước/fps) bên trái + center (timeline) kéo dài
          phần còn lại của hàng — tới lề phải vùng nội dung */}
      {(subtitle || center) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-y-2">
          {subtitle && (
            <p
              className={`shrink-0 text-sm text-[var(--text-muted)] ${
                center ? "xl:basis-[calc(100%/3)]" : ""
              }`}
            >
              {subtitle}
            </p>
          )}
          {/* Timeline chiếm phần còn lại — mép trái ≈ cột Kịch bản edit, mép phải = hết vùng nội dung */}
          {center && <div className="min-w-64 max-w-full flex-1">{center}</div>}
        </div>
      )}
    </div>
  );
}
