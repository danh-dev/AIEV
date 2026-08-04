"use client";

import { Palette, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  createVideoStyle,
  getManagedVideoStyles,
  type ManagedVideoStyle,
} from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { formatRelative } from "@/lib/format";
import { useEvents } from "@/lib/useEvents";
import { useT } from "@/lib/i18n";

/**
 * Quản lý PHONG CÁCH DỰNG (giấy gấp, mực tàu, người que...) - thêm/sửa/xóa như
 * trang Skills và Prompts.
 *
 * KHÁC trang Style Design: Style Design là nhận diện thương hiệu (màu/font/logo)
 * và luôn được cưỡng chế; phong cách dựng là ngôn ngữ thị giác của riêng một
 * video (chất liệu + chuyển động). Hai thứ chồng lên nhau chứ không thay nhau -
 * cùng bộ màu thương hiệu vẫn dựng được video giấy gấp hay video pixel art.
 */
export default function VideoStylesPage() {
  const { t, tf } = useT();
  const router = useRouter();
  const { resyncTick } = useEvents();

  const [list, setList] = useState<ManagedVideoStyle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Modal "Tạo phong cách"
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [cloneFrom, setCloneFrom] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await getManagedVideoStyles());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Nạp lần đầu + nạp lại sau mỗi lần SSE nối lại: phong cách có thể vừa bị một
  // phiên AI khác (hoặc tab khác) sửa trong lúc mất kết nối
  useEffect(() => {
    load();
  }, [load, resyncTick]);

  function openCreate() {
    setName("");
    setCloneFrom("");
    setCreateError(null);
    setCreateOpen(true);
  }

  async function onCreate() {
    if (!name.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      // Không clone thì gửi kèm nội dung rỗng-nhưng-hợp-lệ để người dùng vào
      // trang chi tiết sửa tiếp: server bắt buộc 4 field không rỗng, mà bắt gõ
      // đủ cả art/avoid/motion ngay trong modal tạo thì quá nặng cho một hộp thoại.
      const style = await createVideoStyle(
        cloneFrom
          ? { name: name.trim(), cloneFrom }
          : {
              name: name.trim(),
              art: PLACEHOLDER_ART,
              avoid: PLACEHOLDER_AVOID,
              motion: PLACEHOLDER_MOTION,
              palette: "brand",
            },
      );
      setCreateOpen(false);
      router.push(`/video-styles/${style.id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.video-styles")}
        subtitle={t("vstyle.page.subtitle")}
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} strokeWidth={2} />
            {t("vstyle.page.create")}
          </Button>
        }
      />

      {error && (
        <ErrorBanner message={t("vstyle.page.load-error")} detail={error} />
      )}

      <Card>
        {list && list.length > 0 ? (
          // Bảng nhiều cột - màn hẹp thì cuộn ngang thay vì vỡ layout
          <div className="overflow-x-auto">
            <table className="table min-w-[720px]">
              <thead>
                <tr>
                  <th>{t("vstyle.page.col-name")}</th>
                  <th className="w-32">{t("vstyle.page.col-palette")}</th>
                  <th>{t("vstyle.page.col-motion")}</th>
                  <th className="w-28">{t("vstyle.page.col-usage")}</th>
                  <th className="w-28">{t("vstyle.page.col-updated")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr
                    key={s.id}
                    className="row-click"
                    onClick={() => router.push(`/video-styles/${s.id}`)}
                  >
                    <td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{s.name}</span>
                        {s.builtin && (
                          <span className="chip">{t("vstyle.page.builtin")}</span>
                        )}
                      </span>
                      <span className="mt-0.5 block font-mono text-xs text-[var(--text-muted)]">
                        {s.id}
                      </span>
                    </td>
                    <td>
                      {s.palette === "loose" ? (
                        <span className="rounded-full bg-[var(--danger-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--danger)]">
                          {t("vstyle.loose-badge")}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">
                          {t("vstyle.detail.palette-brand")}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[420px] text-[var(--text-muted)]">
                      <span className="line-clamp-2 text-[13px] leading-snug">
                        {s.motion}
                      </span>
                    </td>
                    <td className="text-[var(--text-muted)]">
                      {s.usageCount > 0
                        ? tf("vstyle.page.usage-n", { n: s.usageCount })
                        : t("vstyle.page.usage-none")}
                    </td>
                    <td className="text-xs text-[var(--text-muted)]">
                      {formatRelative(s.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : list ? (
          <EmptyState
            icon={Palette}
            description={t("vstyle.page.empty")}
            action={
              <Button onClick={openCreate}>
                <Plus size={16} strokeWidth={2} />
                {t("vstyle.page.create")}
              </Button>
            }
          />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        )}
      </Card>

      {list && list.length > 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          {tf("vstyle.page.count", { n: list.length })}
        </p>
      )}

      {/* Modal tạo phong cách mới - chỉ hỏi tên + nguồn chép, phần nội dung dài
          (chỉ đạo mỹ thuật, chuyển động) sửa ở trang chi tiết cho đủ chỗ */}
      <Modal
        title={t("vstyle.page.create")}
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={creating}
              onClick={() => setCreateOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={onCreate} disabled={!name.trim() || creating}>
              <Plus size={15} strokeWidth={2} />
              {creating ? t("common.creating") : t("vstyle.page.create-short")}
            </Button>
          </>
        }
      >
        {createError && (
          <ErrorBanner message={t("vstyle.page.create-error")} detail={createError} />
        )}
        <div>
          <label className="label" htmlFor="vstyle-new-name">
            {t("vstyle.page.name-label")}
          </label>
          <input
            id="vstyle-new-name"
            className="input"
            autoFocus
            value={name}
            disabled={creating}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("vstyle.page.name-placeholder")}
          />
        </div>
        <div>
          <label className="label" htmlFor="vstyle-new-clone">
            {t("vstyle.page.clone-from")}
          </label>
          <select
            id="vstyle-new-clone"
            className="input"
            value={cloneFrom}
            disabled={creating}
            onChange={(e) => setCloneFrom(e.target.value)}
          >
            <option value="">{t("vstyle.page.blank")}</option>
            {(list ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("vstyle.page.clone-hint")}
          </p>
        </div>
      </Modal>
    </div>
  );
}

// Nội dung nháp cho phong cách tạo từ đầu. CỐ Ý viết tiếng Anh phần art/avoid -
// đó là prompt gửi Gemini, và cố ý viết trung tính để nhìn là biết phải sửa.
const PLACEHOLDER_ART =
  "Describe the material and drawing technique here in English: what it is made of, how it is lit, how deep the scene is.";
const PLACEHOLDER_AVOID = "no photographic realism, no 3D glossy render";
const PLACEHOLDER_MOTION =
  "Mô tả cách hình vào/ra, kiểu chuyển cảnh, nhịp và kiểu chữ của phong cách này.";
