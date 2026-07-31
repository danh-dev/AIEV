"use client";

import { ExternalLink, FolderOpen, Loader2 } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { mediaUrl, revealFile, type FileInfo } from "@/lib/api";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";

/** File có xem trước được trong modal không (ảnh/video/audio). */
export function canPreview(kind: FileInfo["kind"]): boolean {
  return kind === "image" || kind === "video" || kind === "audio";
}

/**
 * Nút "Mở file" — mở Explorer/Finder trên máy và chọn đúng file.
 * Lỗi báo qua onError (cắm vào cơ chế báo lỗi sẵn có của chỗ dùng).
 */
export function RevealButton({
  relPath,
  onError,
  className = "",
}: {
  relPath: string;
  onError: (message: string) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  async function onClick(e: MouseEvent<HTMLButtonElement>) {
    // Nút nằm trong hàng/thumbnail clickable — không cho lan ra mở preview
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await revealFile(relPath);
    } catch (err) {
      onError(
        `Không mở được file trong Explorer: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      variant="secondary"
      small
      className={`h-6 px-2 text-xs ${className}`}
      disabled={busy}
      onClick={onClick}
      title="Mở file trong trình quản lý file"
      aria-label={`Mở file ${relPath} trong trình quản lý file`}
    >
      {busy ? (
        <Loader2 size={12} strokeWidth={2} className="animate-spin" />
      ) : (
        <FolderOpen size={12} strokeWidth={2} />
      )}
      Mở file
    </Button>
  );
}

/**
 * Modal xem trước media dùng chung — ảnh/video hiển thị lớn, audio phát ngay.
 * Đóng bằng Esc hoặc click nền (Modal sẵn có). Footer có "Mở tab mới" (link
 * /media) và "Mở file" (reveal trong Explorer/Finder).
 */
export function MediaPreviewModal({
  file,
  onClose,
}: {
  file: FileInfo | null;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // Đổi sang file khác → xóa lỗi reveal cũ
  useEffect(() => {
    setError(null);
  }, [file?.relPath]);

  if (!file) return null;
  // Cache-bust theo mtime — file render/draft ghi đè cùng tên
  const url = mediaUrl(file.relPath) + `?v=${encodeURIComponent(file.mtime)}`;

  return (
    <Modal
      wide
      open
      title={file.name}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p className="mr-auto min-w-0 self-center text-xs text-[var(--danger)]">
              {error}
            </p>
          )}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 self-center text-xs font-medium text-[var(--primary)] transition-colors duration-150 hover:text-[var(--primary-hover)]"
          >
            <ExternalLink size={13} strokeWidth={2} />
            Mở tab mới
          </a>
          <RevealButton relPath={file.relPath} onError={setError} />
        </>
      }
    >
      {file.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={file.name}
          className="mx-auto max-h-[80vh] max-w-full rounded-[var(--radius)] bg-[var(--bg-subtle)] object-contain"
        />
      ) : file.kind === "video" ? (
        <video
          controls
          autoPlay
          src={url}
          className="mx-auto max-h-[80vh] max-w-full rounded-[var(--radius)] bg-[var(--bg-subtle)]"
        />
      ) : file.kind === "audio" ? (
        <audio controls autoPlay src={url} className="w-full" />
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          Không xem trước được loại file này.
        </p>
      )}
    </Modal>
  );
}
