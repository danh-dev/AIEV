# Khởi động AI Edit Video

## Chạy hệ thống

**Windows** — nhấp đúp **`start.bat`**.
**macOS** — nhấp đúp **`start.command`** trong Finder (file `.sh` KHÔNG double-click được trên macOS — nó chỉ mở bằng trình soạn thảo). Lần đầu nếu macOS chặn "from an unidentified developer": chuột phải file → **Open** → Open. Hoặc chạy bằng Terminal:

```bash
chmod +x start/*.sh start/*.command   # chỉ cần lần đầu (tải ZIP mới cần; git clone thì đã sẵn)
./start/start.sh
```

Script (cả hai hệ) tự động:

1. Kiểm tra Node.js 20+ (macOS kiểm thêm ffmpeg — `brew install ffmpeg` nếu thiếu)
2. Cài dependencies nếu là lần chạy đầu (vài phút)
3. Build backend + web UI nếu chưa build hoặc code mới hơn bản build
4. Tạo file `.env` nếu chưa có
5. Chạy server (port 6869) + web (port 6868) — Windows mở cửa sổ log riêng, macOS ghi log vào `start/server.log` (`tail -f start/server.log` để xem)
6. Mở trình duyệt tại **http://localhost:6868**

Nếu hệ thống đang chạy sẵn, script chỉ mở lại trình duyệt; đang chạy dở dang (một trong hai port chết) thì tự dọn sạch và khởi động lại.

## Dừng hệ thống

- Windows: nhấp đúp **`stop.bat`** (hoặc đóng cửa sổ "AI Edit Video - LOG")
- macOS / Linux: `./start/stop.sh`

## Bật tính năng Chat / Edit AI

Cách 1 (khuyên dùng): đăng nhập Claude Code trên máy — chạy `claude` trong terminal rồi `/login` — hệ thống tự dùng gói subscription.

Cách 2: mở file `.env` ở thư mục gốc, điền `ANTHROPIC_API_KEY=sk-ant-...` (lấy tại https://console.anthropic.com/settings/keys) rồi chạy lại script.

Tạo ảnh AI cần thêm `GEMINI_API_KEY` trong `.env` (lấy tại https://aistudio.google.com/apikey) — hoặc điền ngay trên web UI, tab **Kết nối**.

## Dành cho dev

Muốn chạy chế độ dev (hot-reload) thay vì bản build: `npm run dev` ở thư mục gốc.
