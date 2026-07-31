"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { getLanInfo, type LanInfo } from "@/lib/api";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { useT } from "@/lib/i18n";

/**
 * Modal "Kết nối điện thoại" — hiện QR code mở trang upload mobile
 * http://<ip-LAN>:6868/m/<projectId>. Điện thoại cùng WiFi quét QR là
 * upload video/ảnh thẳng vào assets của project (đường proxy /api, port 6868).
 */
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
  const [ip, setIp] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lấy IP LAN mỗi lần mở modal (đổi mạng WiFi thì IP đổi theo)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLan(null);
    setIp(null);
    setError(null);
    getLanInfo()
      .then((info) => {
        if (!alive) return;
        setLan(info);
        setIp(info.ips[0] ?? null);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const url = lan && ip ? `http://${ip}:${lan.webPort}/m/${projectId}` : null;

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

      {lan && lan.ips.length === 0 && (
        <p className="rounded-[var(--radius)] bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">
          {t("phone.no-ip")}
        </p>
      )}

      {lan && lan.ips.length > 1 && (
        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
          {t("phone.ip-label")}
          <select
            className="input"
            value={ip ?? ""}
            onChange={(e) => setIp(e.target.value)}
          >
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

      <p className="rounded-[var(--radius)] bg-[var(--primary-soft)] px-3 py-2 text-xs font-medium text-[var(--primary)]">
        {t("phone.note")}
      </p>

      {/* Ghi chú dùng từ xa: Tailscale / Cloudflare Tunnel — trang /m tự chọn endpoint upload */}
      <p className="text-xs text-[var(--text-muted)]">{t("phone.tunnel-note")}</p>

      <p className="rounded-[var(--radius)] bg-[var(--danger-bg)] px-3 py-2 text-xs font-medium text-[var(--danger)]">
        {t("phone.keep-awake")}
      </p>
    </Modal>
  );
}
