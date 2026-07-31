# AIEV — AI Edit Video by [noti.vn](https://noti.vn)

[🇬🇧 English](README.md) · 🇻🇳 Tiếng Việt

> **Edit video tự động bằng AI.** Claude đóng vai đạo diễn — điều khiển **HyperFrames** (dựng scene motion-graphics bằng HTML + GSAP) và **Remotion** (lắp ráp timeline) — bạn giám sát mọi thứ qua web dashboard tại `http://localhost:6868`.

Đưa clip vào, mô tả ngắn gọn bạn muốn gì, bấm **"Bắt đầu edit bằng AI"** — hệ thống tự transcribe, viết kịch bản dựng, tạo scene chữ động, phụ đề karaoke, zoom nhấn nhịp, sound effect theo timestamp, lắp ráp và xuất MP4.

## Tính năng

| | |
|---|---|
| 🎬 **Edit video bằng AI** | Claude tự phân tích source → dựng scene HyperFrames → lắp ráp Remotion → MP4. Draft trước, final sau, verify từng frame. |
| 🎨 **Style Design** | Nhiều bộ nhận diện (màu, font, logo, tone, hiệu ứng gradient/liquid glass) — sản phẩm tuân thủ 100% style đã chọn. Font chỉ cần gõ tên, tự tải từ Google Fonts (đủ dấu tiếng Việt). |
| 🖼️ **Tạo ảnh AI** | Gemini vẽ nền (không chữ) → Remotion đặt tiêu đề/logo/số liệu theo Style Design — chữ tiếng Việt không bao giờ sai chính tả. |
| ✨ **Ảnh minh họa trong video** | Claude chọn ý chính, Gemini vẽ minh họa đồng bộ style rồi ghép đúng thời điểm (~$0.05/ảnh). |
| 🔑 **Bố cục Key** | Key chính hiện vùng trên video, key liên quan hiện vùng dưới theo nội dung đang nói — AI tự đề xuất hoặc bạn chỉ định. |
| 📝 **Phụ đề karaoke tiếng Việt** | faster-whisper (ưu tiên GPU) word-timestamp, highlight keyword, các fix mất dấu đã kiểm chứng. |
| 🎨 **Chỉnh màu có preview** | 14 preset + chỉnh tay, xem trước từng frame; footage log/HDR tự tonemap. |
| 🔊 **Sound effects** | Thư viện 100+ file kèm bộ đề xuất — AI chèn theo nhịp nội dung, khớp mốc zoom. |
| 🧠 **Skills** | Know-how sản xuất tích lũy dạng markdown, quản lý trên web UI; có cả **tạo skill mới bằng AI** từ form câu hỏi. |
| ⚡ **Tăng tốc phần cứng** | Tự phát hiện GPU (NVENC trên NVIDIA, VideoToolbox trên macOS), render song song, `--gl angle`. |
| 📊 **Dashboard** | Tiến trình realtime (SSE), render queue, token AI theo ngày/loại project (in/out), phiên AI tự chạy tiếp khi gián đoạn. |

## Kiến trúc

```
┌─────────────────────────────────────────────────────┐
│  Web UI (Next.js, port 6868)                        │
│  Dashboard · Videos/Images Project · Style Design   │
│  Render Queue · Sound Effects · Skills · Cấu hình   │
└──────────────────────┬──────────────────────────────┘
                       │ REST + SSE
┌──────────────────────┴──────────────────────────────┐
│  Backend (Express, port 6869)                       │
│  Claude Agent SDK · Render queue · SQLite           │
└──────┬──────────────────────────────┬───────────────┘
┌──────┴───────────┐        ┌─────────┴────────────┐
│ HyperFrames      │  MP4   │ Remotion             │
│ SCENE ENGINE     │───────▶│ ASSEMBLER            │
│ HTML + GSAP      │        │ scene + audio + sub  │
└──────────────────┘        └──────────────────────┘
```

Hợp đồng API đầy đủ: [`docs/API.md`](docs/API.md). Quy trình sản xuất + know-how: [`.claude/skills/`](.claude/skills/).

## Yêu cầu

- **Node.js 20+**
- **FFmpeg** trên PATH (macOS: `brew install ffmpeg`)
- **Google Chrome** (HyperFrames và Remotion render qua headless Chromium)
- **Claude**: đăng nhập [Claude Code](https://claude.com/claude-code) trên máy (dùng subscription OAuth — khuyên dùng) *hoặc* điền `ANTHROPIC_API_KEY` vào `.env`
- **Gemini** (chỉ cần cho tạo ảnh): `GEMINI_API_KEY` trong `.env` — lấy tại [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- Tùy chọn: GPU NVIDIA (NVENC) hoặc Mac Apple Silicon (VideoToolbox) để render nhanh hơn; Python + `faster-whisper` cho phụ đề

## Chạy

```bash
git clone https://github.com/giapducthang/AIEV.git
cd AIEV
```

**Windows** — double-click `start\start.bat` (hoặc chạy `start\start.ps1`).

**macOS / Linux**
```bash
chmod +x start/start.sh start/stop.sh   # lần đầu
./start/start.sh
```

Script tự lo mọi thứ: kiểm tra môi trường → `npm install` (lần đầu) → build → tạo `.env` → chạy server + web → mở `http://localhost:6868`. Dừng bằng `start\stop.bat` / `./start/stop.sh`.

Chạy dev thủ công: `npm install` rồi `npm run dev`.

## Upload từ điện thoại

Trong trang project, ở card **Nguồn & Asset** bấm **Kết nối điện thoại** — quét mã QR bằng camera điện thoại (cùng WiFi với máy chạy hệ thống) để mở trang upload `http://<ip-máy>:6868/m/<project>`. Video/ảnh chọn trên điện thoại sẽ tải thẳng vào asset của project. Lần đầu Windows hỏi firewall thì chọn **Allow** (script start đã tự thêm rule nếu có quyền admin).

**Dùng từ xa qua 4G/5G** (không cùng WiFi):
- **Tailscale** — cài trên máy chạy hệ thống + điện thoại, rồi chọn IP `100.x` trong modal Kết nối điện thoại; QR hoạt động y như trên LAN.
- **Cloudflare Tunnel** (khuyên dùng) — điền `TUNNEL_DOMAIN=<domain-của-bạn>` (vd `aiev.noti.vn`) vào `.env`, QR trong modal Kết nối điện thoại sẽ tự dùng `https://<domain>/m/<project>` — chạy được qua 4G/5G.
- Bật tunnel bằng `start\tunnel.bat` (Windows) / `./start/tunnel.sh` (macOS) — chưa điền `TUNNEL_DOMAIN` thì script tự chạy quick tunnel với URL ngẫu nhiên `trycloudflare.com`.
- ⚠️ **Cảnh báo**: dashboard chưa có đăng nhập — chỉ mở public khi đã bọc Cloudflare Access, hoặc tuyệt đối không chia sẻ link.

## Cấu trúc thư mục

```
├── apps/web/          # Next.js dashboard (port 6868)
├── apps/server/       # Express backend: Agent SDK + render queue + SQLite (port 6869)
├── engines/remotion/  # Remotion: composition Assemble (video) + Poster (ảnh)
├── .claude/skills/    # Skills — know-how sản xuất, quản lý được từ web UI
├── assets/
│   ├── sound-effects/ # Thư viện sound effect + library.json
│   ├── styles/        # Style Design (styles.json + font/logo)
│   └── prompts/       # Prompt mẫu
├── video-projects/    # Mỗi video một folder (không commit)
├── image-projects/    # Project tạo ảnh (không commit)
├── outputs/           # Video final (không commit)
├── start/             # Script khởi động Win (.bat/.ps1) + macOS/Linux (.sh)
└── docs/API.md        # Hợp đồng API — nguồn sự thật duy nhất
```

## Tech stack

Next.js 16 · React 19 · Tailwind 4 · Express 5 · better-sqlite3 · [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk) · [HyperFrames](https://www.npmjs.com/package/hyperframes) · [Remotion](https://remotion.dev) · Gemini API · faster-whisper · FFmpeg

> Lưu ý giấy phép: Remotion miễn phí cho cá nhân và công ty ≤ 3 người — vượt mức cần [Company License](https://remotion.pro).

---

Made with ❤️ by **noti.vn** — Claude điều khiển, con người duyệt.
