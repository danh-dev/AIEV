import type { ReactNode } from "react";

export function Card({
  title,
  actions,
  children,
  className = "",
}: {
  /** ReactNode chứ không chỉ string - để gắn được nút (i) chú thích cạnh tiêu đề */
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {/* flex-wrap: cột hẹp (bố cục 3 cột ở 1280-1536px) không đủ chỗ cho tiêu đề
          + nút trên một hàng. Không cho wrap thì tiêu đề bị bóp vỡ thành nhiều dòng
          CÒN nút vẫn tràn ra ngoài card - đã gặp thật ở card "Nguồn & Asset".
          Cho wrap thì nút tự xuống hàng dưới, tiêu đề giữ nguyên một dòng. */}
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {title && (
            <h2 className="min-w-0 text-sm font-semibold">{title}</h2>
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
