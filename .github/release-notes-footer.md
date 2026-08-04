## Cách chạy

**Windows** - nhấp đúp `start\start.bat`
**macOS** - nhấp đúp `start/start.command` trong Finder. File `.sh` KHÔNG nhấp đúp được trên macOS, nó chỉ mở ra bằng trình soạn thảo. Lần đầu macOS chặn "unidentified developer" thì chuột phải vào file → **Open** → **Open**.
**Linux** - chạy `./start/start.sh` trong terminal

Tải bản ZIP về (thay vì `git clone`) thì lần đầu cần cấp quyền chạy cho script:

```bash
chmod +x start/*.sh start/*.command update/*.sh update/*.command
```

| Việc | Windows | macOS | Linux |
|---|---|---|---|
| Chạy hệ thống | `start\start.bat` | `start/start.command` | `./start/start.sh` |
| Dừng hệ thống | `start\stop.bat` | `start/stop.command` | `./start/stop.sh` |
| Cập nhật thủ công | `update\update.bat` | `update/update.command` | `bash update/update.sh` |
| Mở tunnel (upload từ điện thoại qua 4G/5G) | `start\tunnel.bat` | `start/tunnel.command` | `./start/tunnel.sh` |

Bình thường không cần chạy script cập nhật bằng tay: bấm nút cập nhật ngay trên dashboard là xong.

Lần chạy đầu script tự kiểm tra môi trường, cài giúp phần cài được, cài dependencies, build rồi mở `http://localhost:6868`.

**Yêu cầu:** Node.js 22+, FFmpeg trên PATH, Google Chrome. Cần đăng nhập Claude Code trên máy hoặc có `ANTHROPIC_API_KEY`; phần tạo ảnh cần thêm `GEMINI_API_KEY`.

Hướng dẫn sử dụng đầy đủ: [README tiếng Việt](https://github.com/notivn/AIEV/blob/main/README.vi.md) · [English README](https://github.com/notivn/AIEV/blob/main/README.md)

### How to run (English)

Windows: double-click `start\start.bat`. macOS: double-click `start/start.command` in Finder (`.sh` files cannot be double-clicked on macOS; if macOS blocks an unidentified developer, right-click the file → Open → Open). Linux: run `./start/start.sh`.

If you downloaded a ZIP instead of cloning, run `chmod +x start/*.sh start/*.command update/*.sh update/*.command` once first.

Stop with `start\stop.bat` / `start/stop.command` / `./start/stop.sh`. Manual update with `update\update.bat` / `update/update.command` / `bash update/update.sh`, though the dashboard's update button is the normal path.

Requires Node.js 22+, FFmpeg on PATH and Google Chrome. The start script checks your environment and installs what it can.
