#!/usr/bin/env bash
# AI Edit Video by noti.vn — script khởi động (macOS / Linux)
# Tự kiểm tra môi trường -> cài dependencies (lần đầu) -> chạy server + web -> mở http://localhost:6868
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WEB_URL="http://localhost:6868"
LOG_FILE="$ROOT/start/server.log"

step() { printf '  \033[36m-> %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m[OK] %s\033[0m\n' "$1"; }
err()  { printf '  \033[31m[LOI] %s\033[0m\n' "$1"; }

echo ""
echo "  AI Edit Video by: noti.vn"
echo "  =========================="

# 1. Kiểm tra Node.js >= 20
if ! command -v node >/dev/null 2>&1; then
  err "Chưa cài Node.js. Tải tại https://nodejs.org (bản 20 trở lên) rồi chạy lại."
  exit 1
fi
NODE_MAJOR="$(node --version | sed 's/^v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js $(node --version) quá cũ — cần bản 20 trở lên."
  exit 1
fi
ok "Node.js $(node --version)"

# ffmpeg là bắt buộc cho pipeline render
if ! command -v ffmpeg >/dev/null 2>&1; then
  err "Chưa có ffmpeg trên PATH. macOS: brew install ffmpeg"
  exit 1
fi
ok "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"

open_browser() {
  if command -v open >/dev/null 2>&1; then open "$WEB_URL"; # macOS
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$WEB_URL"; fi
}

probe() { curl -s -o /dev/null -w '%{http_code}' -m 3 "$1" 2>/dev/null || echo 000; }

# 2. Trạng thái hiện tại: web (6868) VÀ backend (qua proxy /api/health)
WEB_UP=false; API_UP=false
[ "$(probe "$WEB_URL")" = "200" ] && WEB_UP=true
[ "$(probe "$WEB_URL/api/health")" = "200" ] && API_UP=true

if $WEB_UP && $API_UP; then
  ok "Hệ thống đang chạy sẵn — mở trình duyệt."
  open_browser
  exit 0
fi
if $WEB_UP || $API_UP; then
  step "Phát hiện hệ thống chạy dở dang — khởi động lại cho sạch..."
  for port in 6868 6869; do
    lsof -ti tcp:$port 2>/dev/null | xargs kill -9 2>/dev/null || true
  done
  sleep 1
fi

# 3. Cài dependencies lần đầu
if [ ! -d "$ROOT/node_modules" ]; then
  step "Lần chạy đầu tiên — đang cài dependencies (vài phút)..."
  npm install --no-audit --no-fund || { err "npm install thất bại — xem log phía trên."; exit 1; }
  ok "Đã cài dependencies."
fi

# 4. Build nếu chưa build HOẶC source mới hơn bản build
needs_build() { # $1=src dir, $2=build dir
  [ ! -d "$2" ] && return 0
  [ -n "$(find "$1" -type f -newer "$2" -print -quit 2>/dev/null)" ] && return 0
  return 1
}
if needs_build "$ROOT/apps/server/src" "$ROOT/apps/server/dist"; then
  step "Build backend..."
  npm run build -w apps/server || { err "Build server thất bại."; exit 1; }
fi
if needs_build "$ROOT/apps/web/src" "$ROOT/apps/web/.next"; then
  step "Build web UI (vài phút)..."
  npm run build -w apps/web || { err "Build web thất bại."; exit 1; }
fi

# 5. Tạo .env nếu chưa có
if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  ok "Đã tạo file .env"
  printf '     \033[33mLưu ý: muốn dùng Chat AI, đăng nhập Claude Code trên máy này (lệnh `claude` -> /login) hoặc điền ANTHROPIC_API_KEY vào .env.\033[0m\n'
fi

# 6. Chạy nền, log ra file (macOS không có cửa sổ cmd riêng như Windows)
step "Khởi động server (port 6869) + web (port 6868)..."
: > "$LOG_FILE"
nohup npm run start >> "$LOG_FILE" 2>&1 &
disown

# 7. Đợi sẵn sàng rồi mở trình duyệt
step "Đang đợi hệ thống sẵn sàng..."
for _ in $(seq 1 60); do
  sleep 2
  if [ "$(probe "$WEB_URL")" = "200" ]; then
    ok "Hệ thống đã sẵn sàng!"
    open_browser
    echo ""
    echo "  Dashboard : $WEB_URL"
    echo "  Xem log   : tail -f start/server.log"
    echo "  Muốn dừng : ./start/stop.sh"
    exit 0
  fi
done

err "Hệ thống chưa phản hồi sau 2 phút — xem log: tail -f start/server.log"
exit 1
