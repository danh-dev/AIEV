"use client";

/**
 * Card "Gói xuất bản" trong trang chi tiết video project.
 * Backend đọc transcript + Style Design rồi để AI soạn title/mô tả/hashtag cho
 * từng nền tảng, đồng thời ghi phụ đề .srt/.vtt. Toàn bộ nội dung ở đây là để
 * COPY đi dán lên TikTok/YouTube/Facebook nên mỗi phần có nút copy riêng.
 */

import {
  Check,
  Copy,
  Download,
  Loader2,
  Megaphone,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  createPublishPack,
  createSubtitles,
  getPublishPack,
  subtitleDownloadUrl,
  type PublishItem,
  type PublishPack,
  type PublishPlatform,
} from "@/lib/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";

/** Tên thương hiệu - không dịch, giữ nguyên cách viết chính thức. */
const PLATFORM_LABEL: Record<PublishPlatform, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
};

/** Báo "Đã copy" bao lâu rồi trả nút về trạng thái thường. */
const COPIED_MS = 1500;

/** Nút copy nhỏ - cùng trải nghiệm với nút copy ở trang Kết nối. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Card có thể bị unmount khi đang đếm ngược -> dọn timer, tránh setState rác
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function onCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    });
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      title={label}
      aria-label={label}
      className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius)] px-1.5 py-0.5 text-xs font-medium text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
    >
      {copied ? (
        <>
          <Check size={12} strokeWidth={2} className="text-[var(--success)]" />
          {t("publish.copied")}
        </>
      ) : (
        <>
          <Copy size={12} strokeWidth={2} />
          {label}
        </>
      )}
    </button>
  );
}

/** Một nền tảng: chip tên + tiêu đề + mô tả + hashtag, mỗi phần copy riêng. */
function PlatformBlock({ item }: { item: PublishItem }) {
  const { t } = useT();
  const hashtagLine = item.hashtags.join(" ");
  return (
    <div className="flex flex-col gap-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="chip">
          {PLATFORM_LABEL[item.platform] ?? item.platform}
        </span>
        <CopyButton text={item.title} label={t("publish.copy-title")} />
      </div>

      <p className="text-sm font-semibold">{item.title}</p>

      <div className="flex items-start justify-between gap-2">
        {/* Mô tả YouTube có danh sách chương xuống dòng - phải giữ nguyên */}
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-xs text-[var(--text-muted)]">
          {item.description}
        </p>
        <CopyButton text={item.description} label={t("publish.copy-desc")} />
      </div>

      {item.hashtags.length > 0 && (
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {item.hashtags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] leading-none text-[var(--text-muted)]"
              >
                {tag}
              </span>
            ))}
          </div>
          <CopyButton text={hashtagLine} label={t("publish.copy-tags")} />
        </div>
      )}
    </div>
  );
}

export function ProjectPublishCard({
  projectId,
  version,
}: {
  projectId: string;
  /** updatedAt của project - cache-bust link tải phụ đề sau khi soạn lại. */
  version?: string;
}) {
  const { t, tf } = useT();
  const [pack, setPack] = useState<PublishPack | null>(null);
  const [cues, setCues] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Thiếu transcript KHÔNG phải lỗi hệ thống - hiện hướng dẫn nhẹ nhàng
  const [noTranscript, setNoTranscript] = useState(false);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(
    null
  );

  const load = useCallback(async () => {
    try {
      const res = await getPublishPack(projectId);
      setPack(res.pack);
    } catch (e) {
      setError({
        message: t("publish.load-error"),
        detail: e instanceof Error ? e.message : String(e),
      });
    }
    // t chỉ đổi khi đổi ngôn ngữ - không phải lý do nạp lại pack
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onGenerate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNoTranscript(false);
    try {
      const { pack: fresh } = await createPublishPack(projectId);
      setPack(fresh);
      // Server đã ghi .srt/.vtt trong lượt soạn; gọi thêm để lấy SỐ CUE hiển
      // thị (ghi lại đúng nội dung đó nên vô hại). Lỗi ở đây không đáng báo.
      try {
        const sub = await createSubtitles(projectId);
        setCues(sub.cues);
      } catch {
        setCues(null);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "NO_TRANSCRIPT") {
        setNoTranscript(true);
      } else {
        setError({
          message: t("publish.error"),
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  const transcriptName = pack?.transcriptRel.split(/[\\/]/).pop() ?? null;

  const generateButton = (
    <Button small onClick={onGenerate} disabled={busy}>
      {busy ? (
        <>
          <Loader2 size={14} strokeWidth={2} className="animate-spin" />
          {t("publish.generating")}
        </>
      ) : (
        <>
          <Sparkles size={14} strokeWidth={2} />
          {pack ? t("publish.regenerate") : t("publish.generate")}
        </>
      )}
    </Button>
  );

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-1.5">
          {t("publish.title")}
          <InfoHint
            titleKey="help.publish.title"
            bodyKey="help.publish.body"
            size={14}
          />
        </span>
      }
      actions={generateButton}
    >
      {error && <ErrorBanner message={error.message} detail={error.detail} />}

      {/* Chưa có transcript là trạng thái BÌNH THƯỜNG của project mới - chỉ
          hướng dẫn bước tiếp theo, không dựng banner lỗi đỏ */}
      {noTranscript && (
        <p className="mb-3 rounded-[var(--radius)] bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {t("publish.no-transcript")}
        </p>
      )}

      {!pack ? (
        !busy && (
          <EmptyState
            icon={Megaphone}
            description={t("publish.empty")}
            action={generateButton}
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
            <span>
              {tf("publish.generated-at", {
                time: formatRelative(pack.generatedAt),
              })}
            </span>
            {transcriptName && (
              <span className="max-w-full truncate" title={pack.transcriptRel}>
                {tf("publish.from-transcript", { file: transcriptName })}
              </span>
            )}
          </div>

          {pack.items.map((item) => (
            <PlatformBlock key={item.platform} item={item} />
          ))}

          {/* Phụ đề: link tải thật (cookie token của dashboard, ?k= khi ở /m) */}
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
            <span className="text-xs font-medium text-[var(--text-muted)]">
              {t("publish.subtitles")}
            </span>
            <a
              className="btn btn-secondary btn-sm"
              href={subtitleDownloadUrl(projectId, "srt", version)}
              download
            >
              <Download size={13} strokeWidth={2} />
              {t("publish.download-srt")}
            </a>
            <a
              className="btn btn-secondary btn-sm"
              href={subtitleDownloadUrl(projectId, "vtt", version)}
              download
            >
              <Download size={13} strokeWidth={2} />
              {t("publish.download-vtt")}
            </a>
            {cues !== null && (
              <span className="text-xs text-[var(--text-muted)]">
                {tf("publish.cues", { n: cues })}
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
