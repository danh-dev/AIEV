"use client";

import {
  Film,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Music,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAssets,
  mediaUrl,
  uploadAsset,
  type FileInfo,
} from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PageHeader } from "@/components/PageHeader";
import { formatBytes, formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";

type Scope = "imports" | "outputs";

function KindIcon({ kind }: { kind: FileInfo["kind"] }) {
  const cls = "shrink-0 text-[var(--text-muted)]";
  switch (kind) {
    case "video":
      return <Film size={15} strokeWidth={1.75} className={cls} />;
    case "audio":
      return <Music size={15} strokeWidth={1.75} className={cls} />;
    case "image":
      return <ImageIcon size={15} strokeWidth={1.75} className={cls} />;
    default:
      return <FileText size={15} strokeWidth={1.75} className={cls} />;
  }
}

function Preview({ file, onClose }: { file: FileInfo; onClose: () => void }) {
  const { t } = useT();
  const url = mediaUrl(file.relPath) + "?v=" + encodeURIComponent(file.mtime);
  return (
    <Card
      title={file.name}
      actions={
        <button
          type="button"
          onClick={onClose}
          aria-label={t("assetsPage.close-preview")}
          className="rounded-[var(--radius)] p-1 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
        >
          <X size={16} strokeWidth={2} />
        </button>
      }
    >
      {file.kind === "video" && (
        <video
          controls
          src={url}
          className="max-h-[480px] w-full rounded-[var(--radius)] bg-[var(--bg-subtle)]"
        />
      )}
      {file.kind === "audio" && <audio controls src={url} className="w-full" />}
      {file.kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={file.name}
          className="max-h-[480px] w-auto max-w-full rounded-[var(--radius)]"
        />
      )}
      {file.kind === "other" && (
        <p className="text-sm text-[var(--text-muted)]">
          {t("assetsPage.no-preview")}{" "}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[var(--primary)]"
          >
            {t("assetsPage.open-direct")}
          </a>
        </p>
      )}
      <p className="mt-2 text-xs text-[var(--text-muted)]">{file.relPath}</p>
    </Card>
  );
}

export default function AssetsPage() {
  const { t } = useT();
  const [scope, setScope] = useState<Scope>("imports");
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<FileInfo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (s: Scope) => {
    try {
      setFiles(await getAssets(s));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    setFiles(null);
    setPreview(null);
    load(scope);
  }, [scope, load]);

  async function doUpload(fileList: FileList | File[]) {
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        await uploadAsset(file, scope);
      }
      await load(scope);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.assets")}
        subtitle={t("assetsPage.subtitle")}
        actions={
          <Button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            <Upload size={15} strokeWidth={2} />
            {uploading ? t("common.uploading") : t("assetsPage.upload")}
          </Button>
        }
      />
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) doUpload(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="flex gap-1 border-b border-[var(--border)]">
        {(["imports", "outputs"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors duration-150 ${
              scope === s
                ? "border-[var(--primary)] text-[var(--primary)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {s === "imports" ? "Imports" : "Outputs"}
          </button>
        ))}
      </div>

      {error && (
        <ErrorBanner message={t("assetsPage.load-error")} detail={error} />
      )}
      {uploadError && (
        <ErrorBanner message={t("assetsPage.upload-error")} detail={uploadError} />
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) doUpload(e.dataTransfer.files);
        }}
        className={`rounded-[var(--radius-lg)] transition-colors duration-150 ${
          dragOver ? "outline-2 outline-dashed outline-[var(--primary)]" : ""
        }`}
      >
        <Card>
          {files && files.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>{t("common.size")}</th>
                  <th>{t("common.modified")}</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr
                    key={f.relPath}
                    className="row-click"
                    onClick={() => setPreview(f)}
                  >
                    <td>
                      <span className="flex items-center gap-2">
                        <KindIcon kind={f.kind} />
                        {f.name}
                      </span>
                    </td>
                    <td className="text-[var(--text-muted)]">
                      {formatBytes(f.size)}
                    </td>
                    <td className="text-[var(--text-muted)]">
                      {formatRelative(f.mtime)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : files ? (
            <EmptyState
              icon={FolderOpen}
              description={
                scope === "imports"
                  ? t("assetsPage.empty-imports")
                  : t("assetsPage.empty-outputs")
              }
              action={
                scope === "imports" ? (
                  <Button onClick={() => inputRef.current?.click()}>
                    <Upload size={15} strokeWidth={2} />
                    {t("assetsPage.upload")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">
              {t("common.loading")}
            </p>
          )}
        </Card>
      </div>

      {preview && <Preview file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
