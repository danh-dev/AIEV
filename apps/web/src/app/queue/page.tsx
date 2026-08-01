"use client";

import { ListVideo, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelJob,
  getJob,
  getJobs,
  type Job,
} from "@/lib/api";
import { useJobEvents, useJobLogEvents } from "@/lib/useEvents";
import { Card } from "@/components/Card";
import { JobBadge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PageHeader } from "@/components/PageHeader";
import { ProgressBar } from "@/components/ProgressBar";
import { formatJobDuration, formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";

// Giá trị là KEY dictionary - dịch bằng t() lúc render.
const TYPE_LABEL: Record<Job["type"], string> = {
  "scene-draft": "queue.type.scene-draft",
  "scene-final": "queue.type.scene-final",
  "assemble-draft": "queue.type.assemble-draft",
  "assemble-final": "queue.type.assemble-final",
  "image-gen": "queue.type.image-gen",
};

function LogPanel({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const { t, tf } = useT();
  const [job, setJob] = useState<Job | null>(null);
  const [log, setLog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let alive = true;
    setLog("");
    setJob(null);
    (async () => {
      try {
        const j = await getJob(jobId);
        if (!alive) return;
        setJob(j);
        setLog(j.log ?? "");
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [jobId]);

  // Dòng log mới qua SSE
  useJobLogEvents((e) => {
    if (e.jobId !== jobId) return;
    setLog((prev) => (prev ? `${prev}\n${e.line}` : e.line));
  });

  // Trạng thái job đổi
  useJobEvents((j) => {
    if (j.id === jobId) setJob((prev) => (prev ? { ...prev, ...j } : j));
  });

  // Auto-scroll xuống cuối
  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <Card
      title={tf("queue.log-title", { id: jobId })}
      actions={
        <button
          type="button"
          onClick={onClose}
          aria-label={t("queue.close-log")}
          className="rounded-[var(--radius)] p-1 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
        >
          <X size={16} strokeWidth={2} />
        </button>
      }
    >
      {error && <ErrorBanner message={t("queue.log-error")} detail={error} />}
      {job && (
        <div className="mb-3 flex items-center gap-3 text-sm text-[var(--text-muted)]">
          <JobBadge status={job.status} />
          <span>
            {job.projectId} · {t(TYPE_LABEL[job.type])}
            {job.sceneId ? ` · ${job.sceneId}` : ""}
          </span>
          {job.status === "running" && (
            <span className="flex-1">
              <ProgressBar progress={job.progress} step={job.step} />
            </span>
          )}
        </div>
      )}
      <pre
        ref={preRef}
        className="max-h-96 min-h-40 overflow-auto rounded-[var(--radius)] bg-[var(--bg-subtle)] p-3 font-mono text-xs whitespace-pre-wrap"
      >
        {log || t("queue.no-log")}
      </pre>
    </Card>
  );
}

export default function QueuePage() {
  const { t } = useT();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setJobs(await getJobs(50));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: upsert job vào danh sách
  useJobEvents((job) => {
    setJobs((prev) => {
      // Danh sách chưa load xong → refetch để không nuốt mất event
      if (!prev) {
        load();
        return prev;
      }
      const idx = prev.findIndex((j) => j.id === job.id);
      if (idx === -1) return [job, ...prev];
      const next = [...prev];
      next[idx] = job;
      return next;
    });
  });

  async function onCancel(id: string) {
    if (cancelingId) return;
    setCancelError(null);
    setCancelingId(id);
    try {
      await cancelJob(id);
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.queue")}
        subtitle={t("queue.subtitle")}
      />

      {error && (
        <ErrorBanner message={t("queue.load-error")} detail={error} />
      )}
      {cancelError && (
        <ErrorBanner message={t("queue.cancel-error")} detail={cancelError} />
      )}

      <Card>
        {jobs && jobs.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Project</th>
                <th>{t("queue.col-type")}</th>
                <th>{t("common.status")}</th>
                <th className="w-64">{t("queue.col-progress")}</th>
                <th>{t("queue.col-time")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr
                  key={j.id}
                  className="row-click"
                  onClick={() => setSelectedId(j.id)}
                >
                  <td className="font-mono text-xs">{j.id}</td>
                  <td className="font-medium">
                    {j.projectId}
                    {j.sceneId && (
                      <span className="ml-1 text-xs text-[var(--text-muted)]">
                        · {j.sceneId}
                      </span>
                    )}
                  </td>
                  <td className="text-[var(--text-muted)]">
                    {t(TYPE_LABEL[j.type])}
                  </td>
                  <td>
                    <JobBadge status={j.status} />
                  </td>
                  <td>
                    {j.status === "running" ? (
                      <ProgressBar progress={j.progress} step={j.step} />
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">
                        {j.status === "done" ? "100%" : "-"}
                      </span>
                    )}
                  </td>
                  <td className="text-[var(--text-muted)]">
                    <span title={formatRelative(j.createdAt)}>
                      {formatJobDuration(j.startedAt, j.finishedAt)}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {(j.status === "queued" || j.status === "running") && (
                      <Button
                        variant="destructive"
                        small
                        disabled={cancelingId === j.id}
                        onClick={() => onCancel(j.id)}
                      >
                        <Square size={12} strokeWidth={2} />
                        {cancelingId === j.id ? t("queue.canceling") : t("common.cancel")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : jobs ? (
          <EmptyState
            icon={ListVideo}
            description={t("queue.empty")}
          />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        )}
      </Card>

      {selectedId && (
        <LogPanel jobId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
