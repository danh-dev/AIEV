export function ProgressBar({
  progress,
  step,
}: {
  progress: number;
  step?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
        <div
          className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-150 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-xs text-[var(--text-muted)]">
        {pct}%{step ? ` · ${step}` : ""}
      </span>
    </div>
  );
}
