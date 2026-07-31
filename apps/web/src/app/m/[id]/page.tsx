"use client";

/**
 * Trang upload trên ĐIỆN THOẠI — mở qua QR "Kết nối điện thoại"
 * (http://<ip-máy-chủ>:6868/m/<projectId>, điện thoại cùng WiFi).
 *
 * Tối giản cho màn dọc, không Shell/sidebar (Shell tự bypass /m/*).
 * Upload đi qua PROXY /api của Next (cùng origin, port 6868) thay vì gọi thẳng
 * backend 6869: khỏi lo CORS + firewall port 6869, và next.config đã nâng
 * experimental.proxyTimeout lên 10 phút nên file video lớn không bị cắt ngang.
 */

import { Camera, Check, Loader2, Smartphone, Upload } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getProject } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useT } from "@/lib/i18n";

interface UploadItem {
  key: string;
  name: string;
  size: number;
  /** 0–100 (% đã gửi lên). */
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
}

/** Upload MỘT file qua proxy /api/assets — XHR để có progress từng phần. */
function uploadOne(
  projectId: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/assets");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let message = `HTTP ${xhr.status}`;
      try {
        const body = JSON.parse(xhr.responseText) as {
          error?: { message?: string };
        };
        if (body?.error?.message) message = body.error.message;
      } catch {
        // body không phải JSON — giữ message mặc định
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("network"));
    const form = new FormData();
    form.append("file", file);
    form.append("scope", "project");
    form.append("projectId", projectId);
    xhr.send(form);
  });
}

export default function MobileUploadPage() {
  const { t } = useT();
  const params = useParams<{ id: string }>();
  const projectId = params?.id ?? "";

  const [projectName, setProjectName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);

  const pickRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  // Hàng đợi upload tuần tự — tránh đẩy nhiều video lớn song song qua WiFi
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    getProject(projectId)
      .then((p) => {
        if (alive) setProjectName(p.name);
      })
      .catch(() => {
        if (alive) setNotFound(true);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const updateItem = useCallback((key: string, patch: Partial<UploadItem>) => {
    setItems((list) =>
      list.map((it) => (it.key === key ? { ...it, ...patch } : it))
    );
  }, []);

  const enqueue = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setItems((list) => [
          ...list,
          {
            key,
            name: file.name,
            size: file.size,
            progress: 0,
            status: "uploading",
          },
        ]);
        queueRef.current = queueRef.current.then(() =>
          uploadOne(projectId, file, (pct) => updateItem(key, { progress: pct }))
            .then(() => updateItem(key, { progress: 100, status: "done" }))
            .catch((e: unknown) =>
              updateItem(key, {
                status: "error",
                error: e instanceof Error ? e.message : String(e),
              })
            )
        );
      }
    },
    [projectId, updateItem]
  );

  const uploadingCount = items.filter((i) => i.status === "uploading").length;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col gap-4 p-4">
      {/* Header gọn: icon + tên project */}
      <header className="flex items-center gap-2 pt-2">
        <Smartphone
          size={20}
          strokeWidth={1.75}
          className="shrink-0 text-[var(--primary)]"
        />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.04em] text-[var(--text-muted)]">
            {t("m.title")}
          </p>
          <h1 className="truncate text-base font-semibold">
            {notFound ? projectId : (projectName ?? t("common.loading"))}
          </h1>
        </div>
      </header>

      {notFound ? (
        <p className="rounded-[var(--radius)] bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">
          {t("m.not-found")}
        </p>
      ) : (
        <>
          {/* Nút to chọn file từ thư viện ảnh/video */}
          <input
            ref={pickRef}
            type="file"
            accept="video/*,image/*,audio/*"
            multiple
            className="hidden"
            onChange={(e) => {
              enqueue(e.target.files);
              e.target.value = "";
            }}
          />
          {/* Quay/chụp trực tiếp bằng camera */}
          <input
            ref={captureRef}
            type="file"
            accept="video/*,image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              enqueue(e.target.files);
              e.target.value = "";
            }}
          />

          <button
            type="button"
            onClick={() => pickRef.current?.click()}
            className="flex h-16 w-full items-center justify-center gap-2.5 rounded-[var(--radius-lg)] bg-[var(--primary)] text-base font-semibold text-white transition-colors duration-150 active:bg-[var(--primary-hover)]"
          >
            <Upload size={20} strokeWidth={2} />
            {t("m.choose")}
          </button>

          <button
            type="button"
            onClick={() => captureRef.current?.click()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] text-sm font-medium transition-colors duration-150 active:bg-[var(--bg-subtle)]"
          >
            <Camera size={17} strokeWidth={2} />
            {t("m.capture")}
          </button>

          <p className="text-center text-xs text-[var(--text-muted)]">
            {t("m.hint")}
          </p>

          {/* Danh sách file đã/đang tải lên */}
          {items.length === 0 ? (
            <p className="mt-4 text-center text-sm text-[var(--text-muted)]">
              {t("m.empty")}
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-3">
              {items.map((it) => (
                <div key={it.key} className="flex flex-col gap-1 py-2.5">
                  <div className="flex items-center gap-2">
                    {it.status === "done" ? (
                      <Check
                        size={16}
                        strokeWidth={2.5}
                        className="shrink-0 text-[var(--success)]"
                      />
                    ) : it.status === "uploading" ? (
                      <Loader2
                        size={16}
                        strokeWidth={2}
                        className="shrink-0 animate-spin text-[var(--primary)]"
                      />
                    ) : (
                      <span className="shrink-0 text-xs font-semibold text-[var(--danger)]">
                        !
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {it.name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
                      {formatBytes(it.size)}
                    </span>
                  </div>
                  {it.status === "uploading" && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                      <div
                        className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-200"
                        style={{ width: `${it.progress}%` }}
                      />
                    </div>
                  )}
                  {it.status === "error" && (
                    <p className="text-xs text-[var(--danger)]">
                      {t("m.error")}: {it.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {uploadingCount > 0 && (
            <p className="text-center text-xs text-[var(--text-muted)]">
              {t("m.uploading")}
            </p>
          )}
        </>
      )}
    </main>
  );
}
