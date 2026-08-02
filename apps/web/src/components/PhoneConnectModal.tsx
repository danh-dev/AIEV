"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import {
  closePhoneSessionOnUnload,
  createUploadSession,
  getLanInfo,
  getTunnelStatus,
  revokeUploadSession,
  startTunnel,
  stopTunnel,
  type LanInfo,
  type TunnelStatus,
} from "@/lib/api";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { InfoHint } from "@/components/InfoHint";
import { useT } from "@/lib/i18n";

/**
 * Modal "Kết nối điện thoại" - hiện QR code mở trang upload mobile
 * http://<ip-LAN>:6868/m/<projectId>. Điện thoại cùng WiFi quét QR là
 * upload video/ảnh thẳng vào assets của project (đường proxy /api, port 6868).
 * Nếu .env có TUNNEL_DOMAIN (Cloudflare Tunnel) thì option mặc định là
 * https://<domain>/m/<projectId> - dùng được qua 4G/5G, không cần cùng WiFi.
 *
 * ĐÓNG MODAL = ĐÓNG HẾT. Token upload bị thu hồi, và nếu đường Internet được
 * bật TỪ CHÍNH modal này thì tunnel cũng bị tắt luôn. Lý do: link tunnel là
 * public, để nó sống sau khi người dùng đã xong việc là mở toang dashboard ra
 * Internet mà không ai để ý. Tunnel người dùng tự bật ở trang Kết nối thì KHÔNG
 * đụng tới - cái đó thường dùng để vào dashboard từ xa.
 */

/** Giá trị option "đi qua Cloudflare Tunnel" trong select Mạng (IP không bao giờ trùng). */
const TUNNEL_OPTION = "__tunnel__";

/** Chờ tunnel lên: hỏi lại mỗi 2s, bỏ cuộc sau 40s (cloudflared quick mất ~5–15s). */
const TUNNEL_POLL_MS = 2000;
const TUNNEL_POLL_TIMEOUT_MS = 40_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  // Token phiên upload - link/QR chỉ sống khi modal đang mở (bảo mật)
  const [token, setToken] = useState<string | null>(null);
  // Trạng thái cloudflared/tunnel - để bật/tắt đường Internet ngay trong modal
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [tunnelBusy, setTunnelBusy] = useState<"start" | "stop" | null>(null);
  const [tunnelError, setTunnelError] = useState<string | null>(null);
  // Vòng poll chạy async - dừng ngay khi modal đóng, không setState nữa
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  /**
   * Tunnel có phải do CHÍNH modal này bật không. Chỉ khi true mới tắt lúc đóng
   * modal - tunnel bật sẵn từ trang Kết nối thì để nguyên.
   *
   * Giữ CẢ ref lẫn state: hàm dọn dẹp lúc unmount phải đọc được giá trị mới
   * nhất (state trong closure của effect đã cũ), còn phần hiển thị thì cần
   * state mới vẽ lại được.
   */
  const startedHereRef = useRef(false);
  const [startedHere, setStartedHere] = useState(false);
  const markStartedHere = (v: boolean) => {
    startedHereRef.current = v;
    setStartedHere(v);
  };
  /** Token hiện hành cho đường dọn dẹp lúc tab bị đóng đột ngột */
  const tokenRef = useRef<string | null>(null);

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

  // Trạng thái tunnel mỗi lần mở modal - quyết định hiện nút Bật/Tắt Internet.
  // Lỗi ở đây không chặn QR LAN nên chỉ nuốt, không đẩy lên ErrorBanner.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setTunnel(null);
    setTunnelBusy(null);
    setTunnelError(null);
    // Mở lại modal = làm mới hoàn toàn; chỉ nhận lại quyền tắt khi server xác
    // nhận tunnel đang chạy là bản auto (ngay bên dưới)
    markStartedHere(false);
    getTunnelStatus()
      .then((s) => {
        if (!alive) return;
        setTunnel(s);
        // Tunnel đang chạy mà server đánh dấu `auto` = do một phiên QR trước bật
        // lên (modal mở lại, hoặc tab cũ chết). Nhận lại nó để lần đóng này tắt
        // được - nếu không nó sẽ sống tới khi watchdog phía server ra tay.
        if (s.running && s.auto) markStartedHere(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

  // Phiên upload: MỞ modal → tạo token (URL/QR mang ?k=); ĐÓNG modal
  // (onClose/unmount) → thu hồi token VÀ tắt tunnel nếu tunnel do modal bật.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let created: string | null = null;
    setToken(null);
    createUploadSession(projectId)
      .then((s) => {
        created = s.token;
        tokenRef.current = s.token;
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
      tokenRef.current = null;
      if (created) void revokeUploadSession(created).catch(() => {});
      if (startedHereRef.current) {
        // Ghi thẳng vào ref, KHÔNG gọi markStartedHere: đây là lúc unmount,
        // setState ở đây là cập nhật một component đã chết
        startedHereRef.current = false;
        // onlyAuto: server tự bỏ qua nếu tunnel hiện tại không phải bản auto
        void stopTunnel(true).catch(() => {});
      }
    };
  }, [open, projectId]);

  /**
   * Tab bị đóng / tải lại / chuyển trang cứng: React không chạy hàm dọn dẹp kịp,
   * mà fetch thường cũng bị hủy ngay khi trang chết. Dùng đường keepalive riêng.
   * `pagehide` chứ không phải `beforeunload` - Safari trên iOS không bắn beforeunload.
   */
  useEffect(() => {
    if (!open) return;
    const onPageHide = () => {
      closePhoneSessionOnUnload(tokenRef.current, startedHereRef.current);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [open]);

  const viaTunnel = sel === TUNNEL_OPTION && !!lan?.tunnelDomain;
  const url =
    lan && sel && token
      ? viaTunnel
        ? `https://${lan.tunnelDomain}/m/${projectId}?k=${token}`
        : `http://${sel}:${lan.webPort}/m/${projectId}?k=${token}`
      : null;

  // Render QR client-side thành dataURL - không gọi service ngoài
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

  /**
   * Bật Cloudflare Tunnel rồi chuyển QR sang link Internet.
   * cloudflared cần vài giây mới có URL public → poll /api/tunnel tới khi
   * `running && url`, sau đó lấy lại lan-info (server ưu tiên hostname quick
   * tunnel đang sống) và chọn option Internet.
   */
  async function handleStartTunnel() {
    setTunnelBusy("start");
    setTunnelError(null);
    try {
      // auto: true - đánh dấu để server tự tắt khi hết phiên upload, phòng khi
      // client không kịp gọi /stop (tab crash, mất điện)
      await startTunnel(true);
      markStartedHere(true);
      const deadline = Date.now() + TUNNEL_POLL_TIMEOUT_MS;
      let live = false;
      while (Date.now() < deadline) {
        await sleep(TUNNEL_POLL_MS);
        if (!openRef.current) return;
        const s = await getTunnelStatus().catch(() => null);
        if (s) setTunnel(s);
        if (s?.running && s.url) {
          live = true;
          break;
        }
      }
      if (!live) {
        setTunnelError(t("phone.tunnel-timeout"));
        return;
      }
      const info = await getLanInfo();
      if (!openRef.current) return;
      setLan(info);
      if (info.tunnelDomain) setSel(TUNNEL_OPTION);
    } catch (e) {
      setTunnelError(e instanceof Error ? e.message : String(e));
    } finally {
      if (openRef.current) setTunnelBusy(null);
    }
  }

  /** Tắt tunnel → link Internet chết ngay, QR quay về IP LAN đầu tiên. */
  async function handleStopTunnel() {
    setTunnelBusy("stop");
    setTunnelError(null);
    try {
      await stopTunnel();
      markStartedHere(false);
      const [s, info] = await Promise.all([getTunnelStatus(), getLanInfo()]);
      if (!openRef.current) return;
      setTunnel(s);
      setLan(info);
      // Tunnel đã tắt → quay về LAN kể cả khi .env vẫn còn TUNNEL_DOMAIN
      setSel(info.ips[0] ?? null);
    } catch (e) {
      setTunnelError(e instanceof Error ? e.message : String(e));
    } finally {
      if (openRef.current) setTunnelBusy(null);
    }
  }

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

      {/* Bảo mật: token upload bị thu hồi ngay khi đóng modal - và tunnel do
          chính modal bật cũng tắt theo, nên phải nói trước để không ai bất ngờ */}
      <p className="text-xs font-medium text-[var(--text-muted)]">
        {startedHere ? t("phone.session-note-tunnel") : t("phone.session-note")}
      </p>

      {viaTunnel ? (
        // Đang đi đường Internet qua Cloudflare Tunnel - không cần cùng WiFi
        <div className="flex flex-col gap-2">
          <p className="rounded-[var(--radius)] bg-[var(--primary-soft)] px-3 py-2 text-xs font-medium text-[var(--primary)]">
            {t("phone.tunnel-active")}
          </p>
          {/* Link Internet là public - nhắc tắt khi xong, kèm nút tắt tại chỗ */}
          <p className="text-xs text-[var(--text-muted)]">
            {t("phone.tunnel-warn")}{" "}
            <button
              type="button"
              className="font-medium text-[var(--primary)] hover:underline disabled:opacity-50"
              onClick={() => void handleStopTunnel()}
              disabled={tunnelBusy !== null}
            >
              {t("phone.tunnel-stop")}
            </button>
          </p>
          {tunnelError && (
            <p className="text-xs font-medium text-[var(--danger)]">{tunnelError}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="rounded-[var(--radius)] bg-[var(--primary-soft)] px-3 py-2 text-xs font-medium text-[var(--primary)]">
            {t("phone.note")}
          </p>

          {/* Dùng ngoài mạng LAN (4G/5G) - bật Cloudflare Tunnel ngay tại đây */}
          {tunnel && !tunnel.installed && (
            <p className="flex items-start gap-1.5 text-xs text-[var(--text-muted)]">
              <span className="min-w-0 flex-1">
                {t("phone.tunnel-missing")}{" "}
                <Link
                  href="/connections"
                  className="font-medium text-[var(--primary)] hover:underline"
                >
                  {t("nav.connections")} →
                </Link>
              </span>
              <InfoHint
                titleKey="help.phone-tunnel.title"
                bodyKey="help.phone-tunnel.body"
              />
            </p>
          )}

          {/* (i) đặt cạnh nút chứ KHÔNG lồng trong nút - lồng button trong
              button là HTML không hợp lệ và bấm (i) sẽ kích hoạt luôn tunnel. */}
          {tunnel?.installed && !tunnel.running && (
            <div className="flex items-center justify-end gap-2">
              <InfoHint
                titleKey="help.phone-tunnel.title"
                bodyKey="help.phone-tunnel.body"
                size={14}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleStartTunnel()}
                disabled={tunnelBusy !== null}
              >
                {tunnelBusy === "start"
                  ? t("phone.tunnel-starting")
                  : t("phone.tunnel-start")}
              </button>
            </div>
          )}

          {/* Tunnel đã chạy sẵn nhưng QR đang trỏ IP LAN → mời đổi sang link Internet */}
          {tunnel?.running && lan?.tunnelDomain && (
            <p className="text-xs text-[var(--text-muted)]">
              {t("phone.tunnel-ready")}{" "}
              <button
                type="button"
                className="font-medium text-[var(--primary)] hover:underline"
                onClick={() => setSel(TUNNEL_OPTION)}
              >
                {t("phone.tunnel-use")}
              </button>
            </p>
          )}

          {tunnelError && (
            <p className="text-xs font-medium text-[var(--danger)]">{tunnelError}</p>
          )}
        </div>
      )}

      <p className="rounded-[var(--radius)] bg-[var(--danger-bg)] px-3 py-2 text-xs font-medium text-[var(--danger)]">
        {t("phone.keep-awake")}
      </p>
    </Modal>
  );
}
