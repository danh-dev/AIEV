"use client";

import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * Banner lỗi theo spec: nền --danger-bg, viền trái 3px --danger,
 * chi tiết log gốc collapsible - không nuốt lỗi.
 */
export function ErrorBanner({
  message,
  detail,
}: {
  message: string;
  detail?: string;
}) {
  const { t } = useT();
  const [openDetail, setOpenDetail] = useState(false);
  return (
    <div className="banner-danger">
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={16}
          strokeWidth={2}
          className="mt-0.5 shrink-0 text-[var(--danger)]"
        />
        <div className="min-w-0 flex-1">
          <p>{message}</p>
          {detail && (
            <>
              <button
                type="button"
                onClick={() => setOpenDetail((v) => !v)}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[var(--danger)]"
              >
                {openDetail ? (
                  <ChevronDown size={12} strokeWidth={2} />
                ) : (
                  <ChevronRight size={12} strokeWidth={2} />
                )}
                {t("common.details")}
              </button>
              {openDetail && (
                <pre className="mt-2 max-h-48 overflow-auto rounded-[var(--radius)] bg-[var(--surface)] p-2 font-mono text-xs whitespace-pre-wrap">
                  {detail}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
