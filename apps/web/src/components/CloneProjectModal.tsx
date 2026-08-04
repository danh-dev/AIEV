"use client";

import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { cloneProject } from "@/lib/api";
import { Button } from "@/components/Button";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { useT } from "@/lib/i18n";

/** Thứ duy nhất modal cần biết về project mới: đi tới đâu và gọi nó là gì. */
interface ClonedProject {
  id: string;
  name: string;
}

/**
 * Modal "Nhân bản project" - dùng chung cho video và ảnh, cả trang danh sách lẫn
 * trang chi tiết. Prefill tên "<tên cũ> (bản sao)", gọi POST clone, trả project
 * mới qua onCloned (caller tự quyết: reload danh sách hay chuyển sang bản sao).
 *
 * `clone` và `descriptionKey` để đổi được vì hai loại project sao chép ra thứ
 * khác nhau - video giữ scenes/assets bỏ renders, ảnh giữ nền bỏ ảnh hoàn thiện.
 * Mô tả nói sai thì người dùng không đoán được mình sắp mất gì.
 */
export function CloneProjectModal({
  source,
  onClose,
  onCloned,
  clone = cloneProject,
  descriptionKey = "clone.description",
}: {
  /** Project gốc cần nhân bản - null = modal đóng. */
  source: { id: string; name: string } | null;
  onClose: () => void;
  onCloned: (p: ClonedProject) => void;
  /** Mặc định nhân bản VIDEO project; trang ảnh truyền cloneImageProject. */
  clone?: (id: string, name?: string) => Promise<ClonedProject>;
  descriptionKey?: string;
}) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mỗi lần mở modal (source đổi từ null → project) → prefill lại tên.
  // Dep theo id/name nguyên thủy để object literal mới mỗi render không reset input.
  const sourceId = source?.id ?? null;
  const sourceName = source?.name ?? null;
  useEffect(() => {
    if (sourceId !== null) {
      setName(`${sourceName ?? sourceId} ${t("clone.copy-suffix")}`);
      setError(null);
    }
  }, [sourceId, sourceName, t]);

  async function onClone() {
    if (!source || cloning) return;
    setCloning(true);
    setError(null);
    try {
      const p = await clone(source.id, name.trim() || undefined);
      onCloned(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloning(false);
    }
  }

  return (
    <Modal
      title={t("clone.title")}
      open={source !== null}
      onClose={() => {
        if (!cloning) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" disabled={cloning} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={cloning || name.trim().length === 0} onClick={onClone}>
            <Copy size={14} strokeWidth={2} />
            {cloning ? t("clone.cloning") : t("clone.action")}
          </Button>
        </>
      }
    >
      {error && (
        <ErrorBanner message={t("clone.error")} detail={error} />
      )}
      <p className="text-sm text-[var(--text-muted)]">{t(descriptionKey)}</p>
      <div>
        <label className="label" htmlFor="clone-project-name">
          {t("clone.new-name")}
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
          {t("clone.id-hint")}
        </p>
      </div>
    </Modal>
  );
}
