"use client";

import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { cloneProject, type ProjectSummary } from "@/lib/api";
import { Button } from "@/components/Button";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";

/**
 * Modal "Nhân bản project" — dùng chung cho trang danh sách và trang chi tiết.
 * Prefill tên "<tên cũ> (bản sao)", gọi POST clone, trả project mới qua onCloned
 * (caller tự quyết: reload danh sách hoặc chuyển sang project mới).
 */
export function CloneProjectModal({
  source,
  onClose,
  onCloned,
}: {
  /** Project gốc cần nhân bản — null = modal đóng. */
  source: { id: string; name: string } | null;
  onClose: () => void;
  onCloned: (p: ProjectSummary) => void;
}) {
  const [name, setName] = useState("");
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mỗi lần mở modal (source đổi từ null → project) → prefill lại tên.
  // Dep theo id/name nguyên thủy để object literal mới mỗi render không reset input.
  const sourceId = source?.id ?? null;
  const sourceName = source?.name ?? null;
  useEffect(() => {
    if (sourceId !== null) {
      setName(`${sourceName ?? sourceId} (bản sao)`);
      setError(null);
    }
  }, [sourceId, sourceName]);

  async function onClone() {
    if (!source || cloning) return;
    setCloning(true);
    setError(null);
    try {
      const p = await cloneProject(source.id, name.trim() || undefined);
      onCloned(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloning(false);
    }
  }

  return (
    <Modal
      title="Nhân bản project"
      open={source !== null}
      onClose={() => {
        if (!cloning) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" disabled={cloning} onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={cloning || name.trim().length === 0} onClick={onClone}>
            <Copy size={14} strokeWidth={2} />
            {cloning ? "Đang nhân bản…" : "Nhân bản"}
          </Button>
        </>
      }
    >
      {error && (
        <ErrorBanner message="Không nhân bản được project." detail={error} />
      )}
      <p className="text-sm text-[var(--text-muted)]">
        Bản sao gồm compositions, assets (kèm mô tả), brief, tags và scenes —
        không gồm renders và video output. Project mới ở trạng thái draft.
      </p>
      <div>
        <label className="label" htmlFor="clone-project-name">
          Tên project mới
        </label>
        <input
          id="clone-project-name"
          className="input"
          autoFocus
          value={name}
          disabled={cloning}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onClone();
            }
          }}
        />
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          ID (tên folder) tự sinh từ tên này.
        </p>
      </div>
    </Modal>
  );
}
