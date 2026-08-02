# AI Edit Video by: noti.vn

> Edit video tự động bằng AI — Claude điều khiển **HyperFrames** (dựng scene motion-graphics) và **Remotion** (lắp ráp timeline), giám sát qua **web dashboard** chạy ở port **6868**.

## 1. Tổng quan kiến trúc

Hệ thống gồm 3 tầng, phân vai rõ ràng — **không trộn lẫn vai trò**:

```
┌─────────────────────────────────────────────────────┐
│  Web UI (Next.js, port 6868)                        │
│  CHỈ để hiển thị & quản lý — không xử lý video      │
│  Dashboard · Videos Project · Images Project ·      │
│  Style Design · Render Queue · Assets ·             │
│  Sound Effects · Prompts · Skills · Cấu hình ·      │
│  Kết nối                                            │
└──────────────────────┬──────────────────────────────┘
                       │ REST + SSE/WebSocket
┌──────────────────────┴──────────────────────────────┐
│  Backend (Node.js)                                  │
│  · Claude Agent SDK — chạy Claude Code headless,    │
│    tự nhận skills trong .claude/skills/             │
│  · Render queue — job tuần tự, progress, log        │
│  · SQLite — projects, jobs, assets metadata         │
└──────┬──────────────────────────────┬───────────────┘
       │                              │
┌──────┴───────────┐        ┌─────────┴────────────┐
│ HyperFrames      │        │ Remotion             │
│ SCENE ENGINE     │        │ ASSEMBLER            │
│ HTML + GSAP →    │───────▶│ Lắp scene + footage  │
│ render từng      │  MP4/  │ + audio + transition │
│ scene MP4        │ frames │ → video hoàn chỉnh   │
└──────────────────┘        └──────────────────────┘
```

**Nguyên tắc vàng:** HyperFrames làm gì giỏi thì để nó làm (kinetic typography, caption karaoke, motion graphics, shader). Remotion làm gì giỏi thì để nó làm (ghép sequence, transition giữa scene, mix audio/sound effect, xuất bản cuối). Claude là đạo diễn điều phối cả hai qua CLI + file — mọi thao tác đều là code chạy bên dưới, web UI chỉ nhìn vào.

## 2. Cấu trúc thư mục

```
Edit-Video-AI/
├── CLAUDE.md                  ← file này
├── .claude/
│   ├── settings.json          ← permissions cho pipeline
│   └── skills/                ← 17+ skill — xem trang Skills trên web UI
├── apps/
│   ├── web/                   ← Next.js dashboard (port 6868)
│   └── server/                ← Backend: Agent SDK + render queue + SQLite
├── engines/
│   └── remotion/              ← Remotion project (composition lắp ráp)
├── video-projects/            ← mỗi video một folder (chuẩn HyperFrames)
│   └── <ten-video>/
│       ├── index.html         ← composition gốc HyperFrames
│       ├── compositions/      ← sub-scene
│       ├── assets/            ← footage, audio, transcript của video này
│       ├── renders/           ← scene render + draft (gitignore)
│       ├── hyperframes.json
│       ├── props.resolved.json← props đã stage cho Remotion (gitignore)
│       └── meta.json          ← id, tên, kích thước, fps, trạng thái
├── image-projects/            ← project tạo ảnh Gemini (gitignore)
├── assets/
│   ├── brand/                 ← logo, favicon, brand-tokens.css
│   ├── styles/                ← Style Design (styles.json + font files)
│   ├── prompts/               ← thư viện prompt mẫu
│   ├── sound-effects/         ← thư viện sound effect dùng chung (library.json)
│   └── voices/                ← giọng đã nhân bản (gitignore - là giọng thật của người dùng)
├── docs/                      ← tài liệu (API.md — contract backend)
├── start/                     ← script khởi động (start.ps1)
├── imports/                   ← file người dùng đưa vào (footage gốc…)
└── outputs/                   ← video final đã render, đặt tên <project>-<ver>.mp4
```

## 3. Ports & môi trường

| Thành phần | Port | Ghi chú |
|---|---|---|
| Web UI (Next.js) | **6868** | `http://localhost:6868` — cổng duy nhất người dùng cần nhớ |
| Backend API (Express) | 6869 | Nội bộ — web rewrites `/api/*`, `/media/*` sang đây. Contract: `docs/API.md` |
| HyperFrames Studio preview | 3002 | Nội bộ, mở khi cần soi scene |
| Remotion Studio | 3000 | Nội bộ, chỉ dùng khi debug composition lắp ráp |

- **Node 20+**, **FFmpeg trên PATH**, **Chrome mới nhất** (HyperFrames và Remotion đều render qua headless Chromium).
- Xác thực Claude cho Chat/AI: tự dùng **subscription OAuth** của Claude Code đã đăng nhập trên máy (`~/.claude/.credentials.json`); hoặc `ANTHROPIC_API_KEY` trong `.env` nếu muốn dùng API key.
- Giọng đọc có **hai engine chạy song song**, người dùng chọn từng phiên:
  - **Gemini TTS** (mặc định) - cần `GEMINI_API_KEY`, 30 giọng dựng sẵn, tốn tiền theo lượt.
  - **VieNeu-TTS** (`pip install vieneu`, Apache 2.0) - chạy thẳng trên máy, miễn phí, không cần mạng, 14 giọng tiếng Việt có phân vùng miền, và là engine **duy nhất nhân bản được giọng**. Nhân bản cần thêm `pip install torch torchaudio`. Đọc chậm hơn, khoảng bằng thời gian thật.
- Máy Windows: mọi script phải chạy được trên PowerShell; đường dẫn trong code luôn dùng `path.join`, không hardcode `/` hay `\`.

## 4. Lệnh thường dùng

```bash
npm run dev          # chạy web UI + backend (port 6868)
npm run build        # build production

# HyperFrames (chạy trong video-projects/<ten-video>/)
npx hyperframes lint
npx hyperframes preview                                        # Studio :3002
npx hyperframes render --quality draft --output renders/draft.mp4
npx hyperframes render --quality standard --output renders/final.mp4

# Remotion (chạy trong engines/remotion/)
npx remotion render <composition-id> --props="<project>/props.resolved.json" --output ../../outputs/<ten>.mp4
```

## 5. Quy trình sản xuất video (tóm tắt — chi tiết ở skill `video-pipeline`)

```
nhận yêu cầu → tạo project folder → viết scene HyperFrames
→ lint → draft render từng scene → verify frame (ffmpeg trích ảnh, soi lỗi)
→ Remotion lắp scene + footage + sound effect → draft toàn bài
→ duyệt → final render → outputs/
```

Quy tắc bắt buộc:
1. **Không bao giờ final render khi chưa qua draft + verify frame.** Draft (CRF 28) nhanh, rẻ; final chậm — lỗi phát hiện ở final là lãng phí nhất.
2. **Mọi render đều đi qua render queue của backend** (kể cả khi Claude tự chạy) để web UI luôn thấy được trạng thái.
3. Video tiếng Việt: áp dụng các fix đã kiểm chứng trong skills (chữ gradient mất dấu, transcription tiếng Việt, PATH ffmpeg).
4. Xong final render thì cập nhật `meta.json` của project (trạng thái, đường dẫn output, thời lượng).

## 6. Web UI — quy tắc thiết kế (chi tiết ở skill `webui-design`)

Web UI là **dashboard giám sát**, không phải video editor. Tối giản kiểu Shopify Admin: đầy đủ tính năng, gọn gàng, không màu mè.

- Font: **Inter** (self-host trong `apps/web/public/fonts/`, không load từ CDN khi chạy).
- Icon: **100% SVG inline** (khuyến nghị bộ Lucide, stroke 1.5–2px). Tuyệt đối không icon font, không PNG icon, không emoji làm icon.
- Sáng/tối chuyển được, **mặc định sáng**. Mọi màu khai báo bằng CSS custom properties — không hardcode hex trong component.
- Metadata: title `AI Edit Video by: noti.vn`, description `Edit video tự động bằng AI`.

### Design tokens (nguồn sự thật duy nhất)

| Token | Light | Vai trò |
|---|---|---|
| `--primary` | `#ed3c47` | Màu chính, nút primary |
| `--primary-hover` | `#d62e3a` | Hover/active của primary |
| `--primary-soft` | `#fdedef` | Nền nhạt màu chính (badge, highlight) |
| `--secondary` | `#ff7849` | Màu phụ, accent |
| `--bg` | `#ffffff` | Nền trang |
| `--bg-subtle` | `#f6f6f7` | Nền phụ (sidebar, khu vực lồng nhau) |
| `--surface` | `#ffffff` | Card / bề mặt |
| `--text` | `#101113` | Chữ chính |
| `--text-muted` | `#5f6470` | Chữ mờ, phụ đề, label |
| `--border` | `#e7e7ea` | Viền, divider |
| `--success` | `#16a34a` | Thành công |
| `--success-bg` | `#e7f6ec` | Nền thành công |
| `--danger` | `#e8590c` | Cảnh báo / lỗi |
| `--danger-bg` | `#fbeee5` | Nền cảnh báo |

Bảng dark tương ứng nằm trong skill `webui-design` — chỉ đổi giá trị token, không đổi tên token.

### Brand assets

| Asset | URL nguồn | Dùng khi |
|---|---|---|
| Logo dương bản | https://noti.vn/image/new/logo-duong-ban.png | Nền sáng (theme light) |
| Logo âm bản | https://noti.vn/image/new/logo-am-ban.png | Nền tối (theme dark) |
| Favicon | https://noti.vn/image/new/favicon.png | `<link rel="icon">` |

Tải về `apps/web/public/brand/` khi scaffold web UI — không hotlink lúc runtime.

## 7. Quản lý skills

- Skill = một folder trong `.claude/skills/<ten-skill>/` chứa `SKILL.md` (frontmatter `name` + `description`, thân là hướng dẫn). Không cần build hay restart — Claude nhận ở phiên kế tiếp.
- Web UI có trang Skills: liệt kê / xem / sửa / tạo mới / nhân bản — bản chất là CRUD file markdown qua backend.
- **Tạo skill mới đúng chuẩn: đọc skill `skill-authoring` trước.**
- Mỗi lần fix được một lỗi sản xuất (font, render, audio…), ghi bài học vào skill liên quan ngay — skills là nơi tích lũy know-how, không để kinh nghiệm chết trong chat.

## 8. Quy ước code

- TypeScript cho toàn bộ `apps/`; JavaScript thuần + GSAP cho composition HyperFrames (đúng chuẩn framework — không React trong scene).
- Tên project video: kebab-case (`tiktok-paper-gpt5`, `promo-noti-t8`).
- Backend là nguồn sự thật về trạng thái job; web UI không tự suy diễn trạng thái.
- Ngôn ngữ: commit message **tiếng Anh**, ngắn gọn. Toàn bộ `.claude/skills/` viết **tiếng Anh** (chuỗi ví dụ đặc thù tiếng Việt như chữ có dấu minh họa lỗi font, filler "ừm/à/kiểu" thì giữ nguyên tiếng Việt vì dịch đi là mất ý nghĩa minh họa). Nội dung video, web UI và tài liệu cho người dùng vẫn **tiếng Việt**.
- Không commit: `renders/`, `outputs/`, `imports/`, `image-projects/`, `props.resolved.json`, `node_modules/`, `.env`.
