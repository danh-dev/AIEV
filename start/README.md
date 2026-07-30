# Khởi động AI Edit Video

## Chạy hệ thống

Nhấp đúp **`start.bat`** — script sẽ tự động:

1. Kiểm tra Node.js (cần bản 20+)
2. Cài dependencies nếu là lần chạy đầu (vài phút)
3. Build backend + web UI nếu chưa build
4. Tạo file `.env` nếu chưa có
5. Chạy server (port 6869) + web (port 6868) trong cửa sổ log riêng
6. Mở trình duyệt tại **http://localhost:6868**

Nếu hệ thống đang chạy sẵn, `start.bat` chỉ mở lại trình duyệt.

## Dừng hệ thống

Nhấp đúp **`stop.bat`** (hoặc đóng cửa sổ "AI Edit Video - LOG").

## Bật tính năng Chat AI

Mở file `.env` ở thư mục gốc, điền:

```
ANTHROPIC_API_KEY=sk-ant-...
```

(lấy key tại https://console.anthropic.com/settings/keys) rồi chạy lại `start.bat`.

## Dành cho dev

Muốn chạy chế độ dev (hot-reload) thay vì bản build: mở terminal ở thư mục gốc và chạy `npm run dev`.
