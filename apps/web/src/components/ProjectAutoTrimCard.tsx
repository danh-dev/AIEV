"use client";

/**
 * Card "Cắt tự động" trong trang chi tiết video project.
 *
 * Nguồn dữ liệu là file báo cáo job auto-trim để lại
 * (assets/auto-trim-report.json) - KHÔNG có endpoint riêng, đọc qua /media.
 * Phần lớn project không có file này, nên thiếu nó là trạng thái BÌNH THƯỜNG:
 * card tự ẩn hẳn, không empty state, không banner lỗi.
 *
 * Nội dung cố ý nói KẾT QUẢ ĐO ĐƯỢC (bỏ đi bao nhiêu giây, còn bao nhiêu chỗ
 * chết) chứ không phải lời hứa "đã bật cắt tự động" - phần hứa hẹn đã nằm ở
 * Kịch bản edit rồi. Nghiệm thu trượt thì job VẪN xong bình thường, nên nếu card
 * không nói thẳng "chưa đạt" thì một video lê thê sẽ lọt tới bước cuối.
 */

import { useEffect, useState } from "react";
import { getAutoTrimReport, type AutoTrimReport } from "@/lib/api";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { AUTO_CUT_LEVEL_LABEL } from "@/components/BriefFields";
import { formatDurationMs, formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";

/** Một dòng số liệu: nhãn mờ bên trái, giá trị bên phải. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-[var(--text-muted)]">{label}</span>
      <span className="min-w-0 text-right font-medium">{value}</span>
    </div>
  );
}

/** Giây → chuỗi thời lượng theo ngôn ngữ hiện tại ("12.4s", "1p 30s"). */
function sec(value: number | null): string {
  return formatDurationMs(value === null ? null : value * 1000);
}

export function ProjectAutoTrimCard({
  projectId,
  version,
}: {
  projectId: string;
  /** updatedAt của project - cache-bust sau khi chạy lại job auto-trim. */
  version?: string;
}) {
  const { t, tf } = useT();
  const [report, setReport] = useState<AutoTrimReport | null>(null);

  useEffect(() => {
    let alive = true;
    // getAutoTrimReport đã nuốt mọi lỗi thành null - không có file là bình thường
    getAutoTrimReport(projectId, version).then((r) => {
      if (alive) setReport(r);
    });
    return () => {
      alive = false;
    };
  }, [projectId, version]);

  if (!report) return null;

  const pass = report.verdict === "pass";
  const levelLabel = AUTO_CUT_LEVEL_LABEL[report.level]
    ? t(AUTO_CUT_LEVEL_LABEL[report.level])
    : report.level;

  return (
    <Card
      title={t("autotrim.title")}
      actions={
        <Badge
          tone={pass ? "success" : "danger"}
          label={pass ? t("autotrim.verdict-pass") : t("autotrim.verdict-fail")}
        />
      }
    >
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-[var(--text-muted)]">
          {tf("autotrim.trimmed-at", { time: formatRelative(report.createdAt) })}
        </p>

        <Row
          label={t("autotrim.duration")}
          value={tf("autotrim.duration-value", {
            before: sec(report.duration.beforeSec),
            after: sec(report.duration.afterSec),
          })}
        />
        <Row
          label={t("autotrim.removed")}
          value={tf("autotrim.removed-value", {
            total: sec(report.duration.removedSec),
            ranges: report.removed.ranges,
          })}
        />
        {/* Bóc tách nguồn gốc số giây đã bỏ: máy đo được bao nhiêu, người/AI
            duyệt thêm bao nhiêu - hai số này cộng lại đúng bằng tổng ở trên */}
        <Row
          label={t("autotrim.removed-split")}
          value={tf("autotrim.removed-split-value", {
            silence: sec(report.removed.silenceSec),
            approved: sec(report.removed.approvedSec),
          })}
        />
        <Row
          label={t("autotrim.level")}
          value={tf("autotrim.level-value", {
            level: levelLabel,
            db: report.threshold.db,
          })}
        />
        <Row
          label={t("autotrim.residual")}
          value={tf("autotrim.residual-value", {
            total: sec(report.verification.totalSilenceSec),
            longest: sec(report.verification.longest),
          })}
        />

        {!pass && (
          <p className="mt-1 rounded-[var(--radius)] border-l-[3px] border-[var(--danger)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger)]">
            {/* reason do server soạn sẵn bằng tiếng Việt - hiện nguyên văn */}
            {report.verification.reason ?? t("autotrim.fail-no-reason")}
          </p>
        )}
      </div>
    </Card>
  );
}
