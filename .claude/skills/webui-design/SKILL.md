---
name: webui-design
description: Design system của web dashboard AI Edit Video (noti.vn) — token màu light/dark, font Inter, icon SVG, layout kiểu Shopify Admin. Bắt buộc đọc trước khi viết hoặc sửa bất kỳ UI nào trong apps/web.
---

# Web UI Design System — AI Edit Video by noti.vn

Web UI là **dashboard giám sát và quản lý**, không phải video editor. Chuẩn thẩm mỹ: Shopify Admin — tối giản, mật độ thông tin cao nhưng thoáng, mọi thứ đều có lý do tồn tại.

## 1. Nguyên tắc chung

1. **Token trước, hex sau**: mọi màu đi qua CSS custom properties khai báo ở `:root` và `[data-theme="dark"]`. Component không bao giờ chứa mã hex.
2. **Sáng là mặc định**, tối là lựa chọn. Toggle lưu vào `localStorage`, áp bằng thuộc tính `data-theme` trên `<html>`.
3. **Icon 100% SVG inline** — bộ Lucide, stroke 1.5–2px, `currentColor` để tự ăn theo màu chữ. Không icon font, không PNG, không emoji làm icon chức năng.
4. **Font Inter**, self-host tại `apps/web/public/fonts/` (woff2, weight 400/500/600/700). Không load font từ CDN lúc runtime.
5. Metadata cố định: title `AI Edit Video by: noti.vn`, description `Edit video tự động bằng AI`, favicon từ `public/brand/favicon.png`.

## 2. Design tokens

```css
:root {
  /* Brand */
  --primary: #ed3c47;
  --primary-hover: #d62e3a;
  --primary-soft: #fdedef;
  --secondary: #ff7849;

  /* Surface */
  --bg: #ffffff;          /* nền trang */
  --bg-subtle: #f6f6f7;   /* sidebar, khối lồng nhau, zebra row */
  --surface: #ffffff;     /* card */
  --border: #e7e7ea;

  /* Text */
  --text: #101113;
  --text-muted: #5f6470;

  /* Semantic */
  --success: #16a34a;
  --success-bg: #e7f6ec;
  --danger: #e8590c;
  --danger-bg: #fbeee5;

  /* Shape & motion */
  --radius: 8px;
  --radius-lg: 12px;
  --shadow-card: 0 1px 2px rgba(16, 17, 19, 0.06);
  --transition: 150ms ease;
}

[data-theme="dark"] {
  --primary: #ed3c47;          /* brand giữ nguyên */
  --primary-hover: #f25560;    /* dark thì hover SÁNG hơn, không đậm hơn */
  --primary-soft: #3a1d20;
  --secondary: #ff7849;

  --bg: #131417;
  --bg-subtle: #1a1b1f;
  --surface: #1e1f24;
  --border: #2c2d33;

  --text: #f2f3f5;
  --text-muted: #9a9ea9;

  --success: #2ebd6b;
  --success-bg: #17301f;
  --danger: #f0742e;
  --danger-bg: #33231a;

  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.4);
}
```

Quy tắc dark mode: chỉ đổi **giá trị** token, không bao giờ thêm token riêng cho dark. Component viết một lần, chạy hai theme.

## 3. Brand assets

| File tại `apps/web/public/brand/` | Nguồn tải | Dùng khi |
|---|---|---|
| `logo-duong-ban.png` | https://noti.vn/image/new/logo-duong-ban.png | Header khi theme light |
| `logo-am-ban.png` | https://noti.vn/image/new/logo-am-ban.png | Header khi theme dark |
| `favicon.png` | https://noti.vn/image/new/favicon.png | `<link rel="icon">` |

Logo đổi theo theme cùng lúc với token (cùng listener với `data-theme`).

## 4. Layout khung (kiểu Shopify Admin)

```
┌────────────────────────────────────────────────┐
│ Topbar 56px: logo · tên trang · theme toggle · │
│ trạng thái backend (chấm xanh/đỏ)              │
├─────────┬──────────────────────────────────────┤
│ Sidebar │  Content: FULL WIDTH, padding 20px,  │
│ 220px   │  các card cách 12-16px               │
│ bg-     │  KHÔNG max-width — dùng tối đa không │
│ subtle  │  gian; trang nhiều cột thì chia grid │
└─────────┴──────────────────────────────────────┘
```

**Quy tắc không gian (quan trọng):** không để khoảng trống chết. Trang làm việc chính (project detail)
là workspace nhiều cột chiếm toàn bộ chiều rộng; danh sách/bảng giãn theo màn hình. Chỉ form đơn lẻ
(tạo project, sửa skill) mới được giới hạn chiều rộng cho dễ đọc (~640px).

Sidebar (icon SVG + label, mục active có nền `--primary-soft` + chữ `--primary`) — 11 mục:
- **Dashboard** — tổng quan: job đang chạy, project gần đây, lỗi mới
- **Videos Project** — danh sách video project + trạng thái + preview output
- **Images Project** — project tạo ảnh (Gemini)
- **Style Design** — quản lý style (màu, font, effects) áp cho video/ảnh
- **Render Queue** — hàng đợi job, progress bar, log, nút hủy
- **Assets** — imports, footage, ảnh, transcript
- **Sound Effects** — thư viện, nghe thử inline
- **Prompts** — thư viện prompt mẫu
- **Skills** — CRUD skill markdown
- **Cấu hình** (`/config`) — render settings, concurrency
- **Kết nối** (`/connections`) — API key các provider (Claude, Gemini…)

## 5. Component chuẩn

- **Button primary**: nền `--primary`, chữ trắng, radius `--radius`, hover `--primary-hover`, height 36px, padding ngang 16px. Secondary: nền `--surface`, viền `--border`, chữ `--text`. Destructive: chữ `--danger`, nền `--danger-bg` khi hover.
- **Card**: nền `--surface`, viền 1px `--border`, radius `--radius-lg`, shadow `--shadow-card`, padding 20px. Tiêu đề card 14px/600, không dùng heading to.
- **Badge trạng thái** (job/project): nền `--success-bg` chữ `--success` (hoàn thành), `--primary-soft`/`--primary` (đang chạy), `--danger-bg`/`--danger` (lỗi), `--bg-subtle`/`--text-muted` (chờ). Radius full, 12px font, kèm chấm tròn 6px.
- **Bảng**: header chữ `--text-muted` 12px uppercase, row hover `--bg-subtle`, viền ngang `--border`, không viền dọc.
- **Progress bar** (render job): track `--bg-subtle`, fill `--primary`, height 6px, radius full; kèm % và tên bước bên phải bằng `--text-muted`.
- **Typography**: body 14px/1.5; tiêu đề trang 20px/600; số liệu lớn 28px/700. Không dùng quá 2 cấp heading trong một trang.

## 6. Realtime & trạng thái

- Trạng thái job/agent stream qua SSE — UI cập nhật trực tiếp, không polling quá 1 lần/5s cho dữ liệu tĩnh.
- Mọi danh sách đều có empty state tử tế: icon SVG mờ + một câu mô tả + nút hành động chính.
- Lỗi hiển thị bằng banner `--danger-bg` viền trái 3px `--danger`, kèm nội dung log gốc (collapsible), không nuốt lỗi.

## 7. Những điều KHÔNG làm

- Không gradient màu mè, không glassmorphism, không animation trang trí — chuyển động duy nhất là transition 150ms và progress bar.
- Không dùng màu ngoài bảng token (kể cả gray của Tailwind — map về token).
- Không viết CSS hex trong JSX/TSX.
- Không thêm tính năng editor video vào web UI — mọi xử lý video nằm ở backend/engine.
