"use client";

/**
 * Trang Kết nối — quản lý API key của các AI provider (Claude, Gemini).
 * Key lưu qua PUT /api/connections/:provider/key, hiệu lực ngay không cần
 * restart. Sau khi đổi key gọi refreshProviders() để các select model/provider
 * nơi khác (ModelPicker) fetch lại danh sách mới.
 */

import {
  AlertTriangle,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Bot,
  Loader2,
  Pencil,
  Plug,
  PlugZap,
  Sparkles,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  getConnections,
  setConnectionKey,
  testConnection,
  type ConnectionInfo,
} from "@/lib/api";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PageHeader } from "@/components/PageHeader";
import { refreshProviders } from "@/components/ModelPicker";
import { useT } from "@/lib/i18n";

/** Nhãn tiếng Việt cho role provider — khớp ProviderRole của server. */
// Giá trị là KEY dictionary — dịch bằng t() lúc render.
const ROLE_LABELS: Record<string, string> = {
  edit: "conn.role.edit",
  chat: "conn.role.chat",
  image: "conn.role.image",
};

const PROVIDER_ICONS: Record<ConnectionInfo["id"], LucideIcon> = {
  claude: Sparkles,
  gemini: ImageIcon,
  openai: Bot,
};

const KEY_PLACEHOLDERS: Record<ConnectionInfo["id"], string> = {
  claude: "sk-ant-...",
  gemini: "AIza...",
  openai: "sk-...",
};

function StatusBadge({ conn }: { conn: ConnectionInfo }) {
  const { t } = useT();
  if (!conn.connected) {
    return (
      <span className="badge badge-muted">
        <span className="badge-dot" />
        {t("model.not-connected")}
      </span>
    );
  }
  return (
    <span className="badge badge-success">
      <span className="badge-dot" />
      {conn.source === "oauth"
        ? t("conn.connected-sub")
        : t("conn.connected-key")}
    </span>
  );
}

function ProviderCard({
  conn,
  onUpdate,
}: {
  conn: ConnectionInfo;
  onUpdate: (list: ConnectionInfo[]) => void;
}) {
  const { t, tf } = useT();
  const Icon = PROVIDER_ICONS[conn.id] ?? Plug;

  // Khối API key
  const [editing, setEditing] = useState(false); // "Đổi key" đang mở input
  const [keyValue, setKeyValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  // Kiểm tra kết nối
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const runTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testConnection(conn.id));
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  }, [conn.id]);

  async function onSaveKey() {
    const value = keyValue.trim();
    if (!value || saving) return;
    setSaving(true);
    setActionError(null);
    setSavedNotice(false);
    try {
      const res = await setConnectionKey(conn.id, value);
      onUpdate(res.connections);
      refreshProviders();
      setKeyValue("");
      setEditing(false);
      setShowKey(false);
      setSavedNotice(true);
      // Lưu xong tự kiểm tra luôn cho chắc
      runTest();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // Modal xác nhận xóa API key — bắt gõ DELETE (thay window.confirm)
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function onDeleteKey() {
    if (saving) return;
    setSaving(true);
    setActionError(null);
    setSavedNotice(false);
    setTestResult(null);
    try {
      const res = await setConnectionKey(conn.id, null);
      onUpdate(res.connections);
      refreshProviders();
      setEditing(false);
      setKeyValue("");
      setShowKey(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
      setDeleteOpen(false);
    }
  }

  const showInput = !conn.key.present || editing;

  return (
    <Card>
      {/* Header: icon + label + badge trạng thái + chips vai trò */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--bg-subtle)]">
          <Icon
            size={18}
            strokeWidth={1.75}
            className="text-[var(--primary)]"
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{conn.label}</h2>
            <StatusBadge conn={conn} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {conn.roles.map((r) => (
              <span key={r} className="chip">
                {ROLE_LABELS[r] ? t(ROLE_LABELS[r]) : r}
              </span>
            ))}
          </div>
        </div>
      </div>

      {conn.note && (
        <p className="mt-3 text-sm text-[var(--text-muted)]">{conn.note}</p>
      )}

      {/* Khối API key */}
      <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-[var(--text-muted)]">
            API key ({conn.key.envVar})
          </span>
          <a
            href={conn.keyHelpUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline"
          >
            {t("conn.get-key")}
            <ExternalLink size={11} strokeWidth={2} className="shrink-0" />
          </a>
        </div>

        {showInput ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <input
                className="input pr-9"
                type={showKey ? "text" : "password"}
                value={keyValue}
                placeholder={KEY_PLACEHOLDERS[conn.id] ?? "API key"}
                autoComplete="off"
                spellCheck={false}
                aria-label={tf("conn.key-aria", { name: conn.label })}
                disabled={saving}
                onChange={(e) => setKeyValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSaveKey();
                }}
              />
              <button
                type="button"
                aria-label={showKey ? t("conn.hide-key") : t("conn.show-key")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? (
                  <EyeOff size={15} strokeWidth={1.75} />
                ) : (
                  <Eye size={15} strokeWidth={1.75} />
                )}
              </button>
            </div>
            <Button
              small
              onClick={onSaveKey}
              disabled={!keyValue.trim() || saving}
            >
              {saving ? (
                <Loader2 size={13} strokeWidth={2} className="animate-spin" />
              ) : (
                <KeyRound size={13} strokeWidth={2} />
              )}
              {saving ? t("common.saving") : t("conn.save-key")}
            </Button>
            {editing && (
              <Button
                variant="secondary"
                small
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setKeyValue("");
                  setShowKey(false);
                  setActionError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 font-mono text-xs">
              {conn.key.masked}
            </code>
            <Button
              variant="secondary"
              small
              disabled={saving}
              onClick={() => {
                setEditing(true);
                setKeyValue("");
                setSavedNotice(false);
              }}
            >
              <Pencil size={13} strokeWidth={2} />
              {t("conn.change-key")}
            </Button>
            <Button
              variant="destructive"
              small
              disabled={saving}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 size={13} strokeWidth={2} />
              {saving ? t("common.deleting") : t("conn.delete-key")}
            </Button>
          </div>
        )}

        {actionError && (
          <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-[var(--danger)]">
            <AlertTriangle
              size={13}
              strokeWidth={2}
              className="mt-0.5 shrink-0"
            />
            {actionError}
          </p>
        )}
        {savedNotice && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[var(--success)]">
            <Check size={13} strokeWidth={2} className="shrink-0" />
            {t("conn.saved")}
          </p>
        )}
      </div>

      {/* Kiểm tra kết nối */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" small onClick={runTest} disabled={testing}>
          {testing ? (
            <Loader2 size={14} strokeWidth={2} className="animate-spin" />
          ) : (
            <PlugZap size={14} strokeWidth={2} />
          )}
          {testing ? t("conn.testing") : t("conn.test")}
        </Button>
        {testResult && (
          <span
            className={`inline-flex min-w-0 items-start gap-1.5 text-sm font-medium ${
              testResult.ok
                ? "text-[var(--success)]"
                : "text-[var(--danger)]"
            }`}
          >
            {testResult.ok ? (
              <Check size={15} strokeWidth={2} className="mt-0.5 shrink-0" />
            ) : (
              <X size={15} strokeWidth={2} className="mt-0.5 shrink-0" />
            )}
            {testResult.message}
          </span>
        )}
      </div>

      {conn.id === "claude" && (
        <p className="mt-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-muted)]">
          {t("conn.claude-note")}
        </p>
      )}

      {/* Modal xác nhận xóa API key — bắt gõ DELETE */}
      <ConfirmDeleteModal
        open={deleteOpen}
        title={t("conn.delete-key-title")}
        description={
          <>
            {t("conn.delete-desc-1")}{" "}
            <span className="font-medium">{conn.label}</span>? {t("conn.delete-desc-2")}
          </>
        }
        busy={saving}
        onClose={() => setDeleteOpen(false)}
        onConfirm={onDeleteKey}
      />
    </Card>
  );
}

export default function ConnectionsPage() {
  const { t } = useT();
  const [connections, setConnections] = useState<ConnectionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getConnections();
      setConnections(res.connections);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader title={t("nav.connections")} subtitle={t("conn.subtitle")} />

      {error && (
        <ErrorBanner message={t("conn.load-error")} detail={error} />
      )}

      {connections && connections.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {connections.map((c) => (
            <ProviderCard key={c.id} conn={c} onUpdate={setConnections} />
          ))}
        </div>
      ) : connections ? (
        <Card>
          <EmptyState
            icon={Plug}
            description={t("conn.empty")}
          />
        </Card>
      ) : !error ? (
        // Skeleton nhẹ trong lúc chờ danh sách provider
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="card h-[220px] animate-pulse bg-[var(--bg-subtle)]"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
