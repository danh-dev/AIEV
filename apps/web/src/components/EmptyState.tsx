import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  description,
  action,
}: {
  icon: LucideIcon;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
      <Icon
        size={20}
        strokeWidth={1.5}
        className="text-[var(--text-muted)] opacity-40"
      />
      <p className="max-w-sm text-sm text-[var(--text-muted)]">{description}</p>
      {action}
    </div>
  );
}
