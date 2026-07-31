"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import {
  createUploadSession,
  getLanInfo,
  revokeUploadSession,
  type LanInfo,
} from "@/lib/api";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { useT } from "@/lib/i18n";

/**
 * Modal "Kết nối điện thoại" — hiện QR code mở trang upload mobile
 * http://<ip-LAN>:6868/m/<projectId>. Điện thoại cùng WiFi quét QR là
 * upload video/ảnh thẳng vào assets của project (đường proxy /api, port 6868).
 * Nếu .env có TUNNEL_DOMAIN (Cloudflare Tunnel) thì option mặc định là
 * https://<domain>/m/<projectId> — dùng được qua 4G/5G, không cần cùng WiFi.
 */

/** Giá trị option "đi qua Cloudflare Tunnel" trong select Mạng (IP không bao giờ trùng). */
const TUNNEL_OPTION = "__tunnel__";
export function PhoneConnectModal({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  const [lan, setLan] = useState<LanInfo | null>(null);
  // Lựa chọn mạng: TUNNEL_OPTION (domain Cloudflare Tunnel) hoặc một IP LAN
  const [sel, setSel] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Token phiên upload — link/QR chỉ sống khi modal đang mở (bảo mật)
  const [token, setToken] = useState<string | null>(null);

  // Lấy IP LAN mỗi lần mở modal (đổi mạng WiFi thì IP đổi theo)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLan(null);
    setSel(null);
    setError(null);
    getLanInfo()
      .then((info) => {
        if (!alive) return;
        setLan(info);
        // Có Cloudflare Tunnel → mặc định đi đường Internet (dùng được 4G/5G)
        setSel(info.tunnelDomain ? TUNNEL_OPTION : info.ips[0] ?? null);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // Phiên upload: MỞ modal → tạo token (URL/QR mang ?k=); ĐÓNG modal
  // (onClose/unmount) → thu hồi ngay — link trên điện thoại hết hiệu lực.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let created: string | null = null;
    setToken(null);
    createUploadSession(projectId)
      .then((s) => {
        created = s.token;
        if (alive) setToken(s.token);
        // Modal đã đóng trước khi server trả lời → thu hồi luôn
        else void revokeUploadSession(s.token).catch(() => {});
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
      setToken(null);
      if (created) void revokeUploadSession(created).catch(() => {});
    };
  }, [open, projectId]);

  const viaTunnel = sel === TUNNEL_OPTION && !!lan?.tunnelDomain;
  const url =
    lan && sel && token
      ? viaTunnel
        ? `https://${lan.tunnelDomain}/m/${projectId}?k=${token}`
        : `http://${sel}:${lan.webPort}/m/${projectId}?k=${token}`
      : null;

  // Render QR client-side thành dataURL — không gọi service ngoài
  useEffect(() => {
    if (!url) {
      setQr(null);
      return;
    }
    let alive = true;
    QRCode.toDataURL(url, { width: 480, margin: 1, errorCorrectionLevel: "M" })
      .then((dataUrl) => {
        if (alive) setQr(dataUrl);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [url]);

  return (
    <Modal open={open} onClose={onClose} title={t("phone.title")}>
      {error && <ErrorBanner message={error} />}

      <p className="text-sm text-[var(--text-muted)]">{t("phone.desc")}</p>

      {!lan && !error && (
        <p className="py-6 text-center text-sm text-[var(--text-muted)]">
          {t("phone.loading")}
        </p>
      )}

      {lan && lan.ips.length === 0 && !lan.tunnelDomain && (
        <p className="rounded-[var(--radius)] bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">
          {t("phone.no-ip")}
        </p>
      )}

      {lan && lan.ips.length + (lan.tunnelDomain ? 1 : 0) > 1 && (
        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
          {t("phone.ip-label")}
          <select
            className="input"
            value={sel ?? ""}
            onChange={(e) => setSel(e.target.value)}
          >
            {lan.tunnelDomain && (
              <option value={TUNNEL_OPTION}>
                {`🌐 ${lan.tunnelDomain} (Internet)`}
              </option>
            )}
            {lan.ips.map((addr) => (
              <option key={addr} value={addr}>
                {addr}
              </option>
            ))}
          </select>
        </label>
      )}

      {url && (
        <div className="flex flex-col items-center gap-3">
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr}
              alt={t("phone.qr-alt")}
              className="h-60 w-60 rounded-[var(--radius)] border border-[var(--border)] bg-white p-2"
            />
          )}
          <code className="select-all break-all rounded-[var(--radius)] bg-[var(--bg-subtle)] px-3 py-1.5 text-sm">
            {url}
          </code>
        </div>
      )}

      {/* Bảo mật: token upload bị thu hồi ngay khi đóng modal */}
      <p className="text-xs font-medium text-[var(--text-muted)]">
        {t("phone.session-note")}
      </p>

      {viaTunnel ? (
        // Đang đi đường Internet qua Cloudflare Tunnel — không cần cùng WiFi
        <p className="rounded-[var(--radius)] bg-[var(--primary-soft)] px-3 py-2 text-xs font-medium text-[var(--primary)]">
          {t("phone.tunnel-active")}
        </p>
      ) : (
        <p className="rounded-[var(--radius)] bg-[var(--primary-soft)] px-3 py-2 text-xs font-medium text-[var(--primary)]">
          {t("phone.note")}
        </p>
      )}

      {/* Ghi chú dùng từ xa: Tailscale / Cloudflare Tunnel — trang /m tự chọn endpoint upload */}
      {!viaTunnel && (
        <p className="text-xs text-[var(--text-muted)]">{t("phone.tunnel-note")}</p>
      )}

      <p className="rounded-[var(--radius)] bg-[var(--danger-bg)] px-3 py-2 text-xs font-medium text-[var(--danger)]">
        {t("phone.keep-awake")}
      </p>
    </Modal>
  );
}
