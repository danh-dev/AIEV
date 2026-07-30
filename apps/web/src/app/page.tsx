"use client";

import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Clapperboard,
  Film,
  ListVideo,
  MessagesSquare,
  Play,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getChatSessions,
  getJobs,
  getOverview,
  getProjects,
  getUsageTimeline,
  type ChatSession,
  type Job,
  type Overview,
  type ProjectSummary,
  type UsageScope,
  type UsageTimelinePoint,
} from "@/lib/api";
import { useAgentEvents, useJobEvents } from "@/lib/useEvents";
import { Card } from "@/components/Card";
import { ProjectBadge } from "@/components/Badge";
import { ProgressBar } from "@/components/ProgressBar";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { SessionStatusBadge } from "@/components/SessionStatusBadge";
import { TokenTimelineChart } from "@/components/TokenTimelineChart";
import { formatRelative, formatTokens, formatUsd } from "@/lib/format";

const JOB_TYPE_LABEL: Record<Job["type"], string> = {
  "scene-draft": "Render scene (draft)",
  "scene-final": "Render scene (final)",
  "assemble-draft": "Lắp ráp (draft)",
  "assemble-final": "Lắp ráp (final)",
  "image-gen": "Tạo ảnh",
};

function healthProblems(overview: Overview): string[] {
  const problems: string[] = [];
  const c = overview.health?.checks;
  if (!c) return problems;
  if (!c.ffmpeg) problems.push("FFmpeg không có trên PATH — render sẽ thất bại.");
  if (!c.claudeAuth)
    problems.push(
      "Chưa có xác thực Claude — đăng nhập Claude Code trên máy này (VSCode) hoặc điền ANTHROPIC_API_KEY vào .env.",
    );
  if (!c.hyperframes) problems.push("HyperFrames chưa cài — không render được scene.");
  return problems;
}

/** yyyy-mm-dd theo giờ địa phương — so "hôm nay" cho tile Job. */
function localDayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Skeleton nhẹ — khối pulse dùng chung khi dữ liệu chưa về. */
function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[var(--radius)] bg-[var(--bg-subtle)] ${className}`}
    />
  );
}

const USAGE_DAYS_OPTIONS = [7, 30, 90] as const;

const USAGE_SCOPE_OPTIONS: { value: UsageScope; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "video", label: "Video" },
  { value: "image", label: "Ảnh" },
];

/** Nhóm nút pill chọn khoảng ngày — segmented control nhỏ trong header card. */
function DaysPillGroup({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: number) => void;
}) {
  return (
    <div
      className="flex items-center rounded-full border border-[var(--border)] bg-[var(--bg-subtle)] p-0.5"
      role="group"
      aria-label="Khoảng thời gian"
    >
      {USAGE_DAYS_OPTIONS.map((d) => {
        const active = value === d;
        return (
          <button
            key={d}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(d)}
            className={`rounded-full px-2 py-0.5 text-xs leading-4 transition-colors duration-150 ${
              active
                ? "bg-[var(--surface)] font-medium text-[var(--text)] shadow-[var(--shadow-card)]"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {d} ngày
          </button>
        );
      })}
    </div>
  );
}

/** Stat tile hàng 1 — số to + label nhỏ + icon mờ góc phải. */
function StatTile({
  icon: Icon,
  value,
  label,
  sub,
}: {
  icon: LucideIcon;
  value: string | null;
  label: string;
  sub?: string;
}) {
  return (
    <div className="card relative overflow-hidden">
      <Icon
        size={20}
        strokeWidth={1.75}
        className="absolute right-4 top-4 text-[var(--text-muted)] opacity-40"
      />
      {value === null ? (
        <Skeleton className="h-7 w-16" />
      ) : (
        <div className="text-[24px] font-bold leading-tight">{value}</div>
      )}
      <div className="mt-1 text-xs text-[var(--text-muted)]">
        {label}
        {sub && <span className="opacity-80"> · {sub}</span>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const overviewRef = useRef<Overview | null>(null);
  overviewRef.current = overview;

  // Card "Token AI theo ngày" — timeline theo bộ lọc ngày + loại project
  const [timeline, setTimeline] = useState<UsageTimelinePoint[] | null>(null);
  const [usageDays, setUsageDays] = useState<number>(30);
  const [usageScope, setUsageScope] = useState<UsageScope>("all");
  // Stat tile "Token 30 ngày" hàng trên — cố định 30 ngày, không theo filter
  const [timeline30, setTimeline30] = useState<UsageTimelinePoint[] | null>(
    null
  );
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [sessions, setSessions] = useState<ChatSession[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await getOverview());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadJobs = useCallback(() => {
    getJobs(300)
      .then(setJobs)
      .catch(() => setJobs([]));
  }, []);

  const loadSessions = useCallback(() => {
    getChatSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  // Fetch song song mọi nguồn dữ liệu lúc mở trang
  useEffect(() => {
    loadOverview();
    loadJobs();
    loadSessions();
    getUsageTimeline(30)
      .then(setTimeline30)
      .catch(() => setTimeline30([]));
    getProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [loadOverview, loadJobs, loadSessions]);

  // Đổi bộ lọc (ngày / loại project) → refetch timeline của card
  useEffect(() => {
    let stale = false;
    setTimeline(null);
    getUsageTimeline(usageDays, usageScope)
      .then((data) => {
        if (!stale) setTimeline(data);
      })
      .catch(() => {
        if (!stale) setTimeline([]);
      });
    return () => {
      stale = true;
    };
  }, [usageDays, usageScope]);

  // Realtime: cập nhật job đang chạy trực tiếp, refetch khi job đổi trạng thái
  useJobEvents((job) => {
    const prev = overviewRef.current;
    if (!prev) {
      // Event tới trước khi overview load xong — refetch thay vì nuốt event
      loadOverview();
      loadJobs();
      return;
    }
    if (job.status === "running") {
      setOverview({ ...prev, runningJob: job });
    } else {
      // queued / done / failed / canceled — làm mới overview + số liệu job/project
      loadOverview();
      loadJobs();
      getProjects()
        .then(setProjects)
        .catch(() => {});
    }
  });

  // Hoạt động của AI — theo TỪNG session (nhiều phiên chạy song song không đè nhau)
  const [agentActivities, setAgentActivities] = useState<
    Record<string, { steps: number; action: string }>
  >({});
  // Map sessionId → projectId để link "Mở project" trỏ đúng trang
  const sessionProjectRef = useRef<Record<string, string | null>>({});
  const [, setSessionMapVersion] = useState(0); // re-render khi map project về
  const fetchingSessionsRef = useRef(false);
  useAgentEvents((e) => {
    if (e.kind === "done" || e.kind === "error") {
      // Chỉ gỡ đúng phiên vừa kết thúc — các phiên khác vẫn hiển thị
      setAgentActivities((m) => {
        if (!(e.sessionId in m)) return m;
        const next = { ...m };
        delete next[e.sessionId];
        return next;
      });
      loadSessions(); // phiên vừa kết thúc — làm mới "Phiên AI gần đây"
      return;
    }
    setAgentActivities((m) => {
      const cur = m[e.sessionId] ?? { steps: 0, action: "" };
      return {
        ...m,
        [e.sessionId]: {
          steps: cur.steps + (e.kind === "tool" ? 1 : 0),
          action:
            e.kind === "tool"
              ? `Đang dùng ${e.tool?.name ?? "công cụ"}…`
              : "Đang soạn nội dung…",
        },
      };
    });
    if (
      sessionProjectRef.current[e.sessionId] === undefined &&
      !fetchingSessionsRef.current
    ) {
      fetchingSessionsRef.current = true;
      getChatSessions()
        .then((list) => {
          setSessions(list);
          for (const s of list) {
            sessionProjectRef.current[s.sessionId] = s.projectId;
          }
          setSessionMapVersion((v) => v + 1);
        })
        .catch(() => {
          // không tra được project — ẩn link, vẫn hiện trạng thái
        })
        .finally(() => {
          fetchingSessionsRef.current = false;
        });
    }
  });
  const agentEntries = Object.entries(agentActivities);

  // ===== Số liệu dẫn xuất =====
  // Tổng theo bộ lọc của card chart
  const usageTotal = (timeline ?? []).reduce(
    (acc, d) => ({
      tokens: acc.tokens + d.tokens,
      tokensIn: acc.tokensIn + (d.tokensIn ?? 0),
      tokensOut: acc.tokensOut + (d.tokensOut ?? 0),
      costUsd: acc.costUsd + d.costUsd,
    }),
    { tokens: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 }
  );

  // Tổng 30 ngày cố định — stat tile hàng trên
  const usage30Total = (timeline30 ?? []).reduce(
    (acc, d) => ({
      tokens: acc.tokens + d.tokens,
      costUsd: acc.costUsd + d.costUsd,
    }),
    { tokens: 0, costUsd: 0 }
  );

  const doneProjects = (projects ?? []).filter((p) => p.status === "done").length;
  const exportedProjects = (projects ?? []).filter((p) => p.output).length;

  const todayKey = localDayKey(new Date());
  const todayJobs = (jobs ?? []).filter(
    (j) => localDayKey(new Date(j.createdAt)) === todayKey
  );
  const todayDone = todayJobs.filter((j) => j.status === "done").length;
  const todayFailed = todayJobs.filter((j) => j.status === "failed").length;

  const recentSessions = [...(sessions ?? [])]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, 5);

  const problems = overview ? healthProblems(overview) : [];
  const running = overview?.runningJob ?? null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Dashboard" subtitle="Tổng quan hệ thống edit video" />

      {error && (
        <ErrorBanner message="Không tải được dữ liệu tổng quan." detail={error} />
      )}
      {problems.length > 0 && (
        <ErrorBanner
          message="Hệ thống thiếu thành phần cần thiết:"
          detail={problems.join("\n")}
        />
      )}

      {/* Hàng 1 — 4 stat tile */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Clapperboard}
          value={projects ? String(projects.length) : null}
          label="Tổng project"
          sub={projects ? `${doneProjects} hoàn thành` : undefined}
        />
        <StatTile
          icon={Film}
          value={projects ? String(exportedProjects) : null}
          label="Video đã xuất"
          sub="project có output"
        />
        <StatTile
          icon={BarChart3}
          value={timeline30 ? formatTokens(usage30Total.tokens) : null}
          label="Token 30 ngày"
          sub={timeline30 ? formatUsd(usage30Total.costUsd) : undefined}
        />
        <StatTile
          icon={Activity}
          value={jobs ? String(todayJobs.length) : null}
          label="Job hôm nay"
          sub={jobs ? `${todayDone} xong · ${todayFailed} lỗi` : undefined}
        />
      </div>

      {/* Hàng 2 — chart 2/3 + cột phải (AI / job đang chạy / hàng đợi) */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <Card
          title="Token AI theo ngày"
          className="lg:col-span-2"
          actions={
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
              {timeline && usageTotal.tokens > 0 && (
                <span
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-normal leading-none text-[var(--text-muted)]"
                  title={`${usageTotal.tokens.toLocaleString("vi-VN")} token`}
                >
                  <span>
                    Tổng {usageDays} ngày: {formatTokens(usageTotal.tokens)}{" "}
                    token · {formatUsd(usageTotal.costUsd)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ArrowDownToLine
                      size={12}
                      strokeWidth={2}
                      className="shrink-0"
                      aria-hidden
                    />
                    {formatTokens(usageTotal.tokensIn)} in
                    <span aria-hidden>·</span>
                    <ArrowUpFromLine
                      size={12}
                      strokeWidth={2}
                      className="shrink-0"
                      aria-hidden
                    />
                    {formatTokens(usageTotal.tokensOut)} out
                  </span>
                </span>
              )}
              <DaysPillGroup value={usageDays} onChange={setUsageDays} />
              <select
                className="input h-7 w-auto px-2 text-xs"
                aria-label="Loại project"
                value={usageScope}
                onChange={(e) => setUsageScope(e.target.value as UsageScope)}
              >
                {USAGE_SCOPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          {timeline === null ? (
            <Skeleton className="h-[220px] w-full" />
          ) : usageTotal.tokens > 0 ? (
            <TokenTimelineChart data={timeline} days={usageDays} />
          ) : (
            <EmptyState
              icon={BarChart3}
              description="Chưa có dữ liệu — token sẽ được ghi nhận khi AI làm việc."
            />
          )}
        </Card>

        <div className="flex flex-col gap-4">
          {agentEntries.length > 0 && (
            <Card
              title={
                agentEntries.length === 1
                  ? "AI đang làm việc"
                  : `AI đang làm việc · ${agentEntries.length} phiên`
              }
              actions={<SessionStatusBadge status="running" />}
            >
              <div className="flex flex-col gap-2.5">
                <div className="progress-indeterminate" />
                {agentEntries.map(([sid, act]) => {
                  const pid = sessionProjectRef.current[sid] ?? null;
                  return (
                    <div
                      key={sid}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Sparkles
                          size={14}
                          strokeWidth={2}
                          className="shrink-0 text-[var(--primary)]"
                        />
                        <span className="truncate text-[var(--text-muted)]">
                          {act.action}
                          {act.steps > 0 && ` · bước ${act.steps}`}
                        </span>
                      </span>
                      {pid && (
                        <Link
                          href={`/projects/${encodeURIComponent(pid)}`}
                          className="shrink-0 text-sm font-medium text-[var(--primary)] hover:underline"
                        >
                          Mở project →
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card title="Job đang chạy">
            {running ? (
              <div className="flex flex-col gap-2">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <Link
                    href={`/projects/${running.projectId}`}
                    className="truncate font-medium hover:text-[var(--primary)]"
                  >
                    {running.projectId}
                  </Link>
                  <span className="shrink-0 text-xs text-[var(--text-muted)]">
                    {JOB_TYPE_LABEL[running.type]}
                    {running.sceneId ? ` · ${running.sceneId}` : ""}
                  </span>
                </div>
                <ProgressBar progress={running.progress} step={running.step} />
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <Play size={14} strokeWidth={2} className="shrink-0 opacity-60" />
                Không có job nào đang chạy.
              </p>
            )}
          </Card>

          <Card title="Hàng đợi">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-[24px] font-bold leading-tight">
                  {overview ? overview.queuedCount : "—"}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  job đang chờ
                </span>
              </div>
              <Link href="/queue">
                <Button variant="secondary" small>
                  <ListVideo size={14} strokeWidth={2} />
                  Xem hàng đợi
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>

      {/* Hàng 3 — project gần đây (bảng) + phiên AI gần đây */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card
          title="Project gần đây"
          actions={
            <Link
              href="/projects"
              className="text-xs font-medium text-[var(--primary)] hover:underline"
            >
              Xem tất cả →
            </Link>
          }
        >
          {overview === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : overview.recentProjects.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>Trạng thái</th>
                  <th>Token</th>
                  <th>Sửa cuối</th>
                </tr>
              </thead>
              <tbody>
                {overview.recentProjects.slice(0, 5).map((p) => (
                  <tr key={p.id}>
                    <td className="max-w-0 w-2/5">
                      <Link
                        href={`/projects/${p.id}`}
                        className="block truncate font-medium hover:text-[var(--primary)]"
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td>
                      <ProjectBadge status={p.status} />
                    </td>
                    <td className="text-[var(--text-muted)]">
                      {(p.tokensUsed ?? 0) > 0 ? formatTokens(p.tokensUsed) : "—"}
                    </td>
                    <td className="whitespace-nowrap text-[var(--text-muted)]">
                      {formatRelative(p.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              icon={Clapperboard}
              description="Chưa có project nào. Tạo project đầu tiên để bắt đầu dựng video."
              action={
                <Link href="/projects">
                  <Button>Tạo project</Button>
                </Link>
              }
            />
          )}
        </Card>

        <Card title="Phiên AI gần đây">
          {sessions === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : recentSessions.length > 0 ? (
            <ul className="flex flex-col">
              {recentSessions.map((s, i) => (
                <li
                  key={s.sessionId}
                  className={`flex items-center gap-3 py-2 ${
                    i < recentSessions.length - 1
                      ? "border-b border-[var(--border)]"
                      : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {s.title || "Phiên chat"}
                  </span>
                  <SessionStatusBadge status={s.status} />
                  <span className="shrink-0 text-xs text-[var(--text-muted)]">
                    {formatRelative(s.updatedAt)}
                  </span>
                  {s.projectId && (
                    <Link
                      href={`/projects/${encodeURIComponent(s.projectId)}`}
                      className="shrink-0 text-xs font-medium text-[var(--primary)] hover:underline"
                    >
                      Mở project →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={MessagesSquare}
              description="Chưa có phiên AI nào — bắt đầu edit từ trang project."
            />
          )}
        </Card>
      </div>
    </div>
  );
}
