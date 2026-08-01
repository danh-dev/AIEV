#!/usr/bin/env bash
# AI Edit Video by noti.vn - script khởi động (macOS / Linux)
# Tự kiểm tra môi trường -> cài dependencies (lần đầu) -> chạy server + web -> mở http://localhost:6868
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# .command chạy với PATH tối giản của macOS - thêm đường Homebrew (Apple Silicon
# /opt/homebrew, Intel /usr/local) để thấy brew/cloudflared/ffmpeg; server con kế thừa PATH này.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"
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
  err "Node.js $(node --version) quá cũ - cần bản 20 trở lên."
  exit 1
fi
ok "Node.js $(node --version)"

# Kiểm tra môi trường + cài phần còn thiếu (ffmpeg, Chrome, faster-whisper,
# cloudflared...). Danh sách nằm ở start/doctor.mjs - DÙNG CHUNG với start.ps1
# và trang Cấu hình trên web, để ba nơi không bao giờ lệch nhau.
export PATH="$ROOT/start/bin:$PATH"
node "$ROOT/start/doctor.mjs" --fix

# --- Claude Code: kiểm tra đăng nhập, dẫn vào /login nếu chưa ---
# Doctor cài được CLI nhưng KHÔNG đăng nhập thay được (phải mở trình duyệt,
# nhập mã) - đoạn dưới bàn giao terminal cho `claude` để người dùng gõ /login.
claude_authed() {
  [ -n "${ANTHROPIC_API_KEY:-}" ] && return 0
  [ -f "$HOME/.claude/.credentials.json" ] && return 0
  # macOS: Claude Code lưu OAuth trong Keychain
  if command -v security >/dev/null 2>&1; then
    security find-generic-password -s "Claude Code-credentials" >/dev/null 2>&1 && return 0
  fi
  return 1
}

if command -v claude >/dev/null 2>&1 && ! claude_authed; then
  echo ""
  printf '  \033[33mChưa đăng nhập Claude (subscription) - tính năng edit AI sẽ chưa dùng được.\033[0m\n'
  printf '  Đăng nhập ngay? Claude Code sẽ mở - gõ \033[1m/login\033[0m trong đó, đăng nhập xong thoát (Ctrl+C 2 lần). [Y/n] '
  read -r REPLY_LOGIN || REPLY_LOGIN="n"
  if [ "$REPLY_LOGIN" != "n" ] && [ "$REPLY_LOGIN" != "N" ]; then
    claude || true
    if claude_authed; then ok "Đã đăng nhập Claude."; else
      printf '  \033[33mVẫn chưa thấy đăng nhập - hệ thống vẫn chạy, đăng nhập sau bằng: claude → /login\033[0m\n'
    fi
  else
    printf '  \033[33mBỏ qua - đăng nhập sau bằng: claude → /login (hoặc điền ANTHROPIC_API_KEY vào .env)\033[0m\n'
  fi
fi

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
  # Đang chạy NHƯNG code mới hơn bản build (vừa git pull) → phải build + khởi động lại
  STALE=false
  [ -n "$(find "$ROOT/apps/server/src" -type f -newer "$ROOT/apps/server/dist" -print -quit 2>/dev/null)" ] && STALE=true
  [ -n "$(find "$ROOT/apps/web/src" -type f -newer "$ROOT/apps/web/.next" -print -quit 2>/dev/null)" ] && STALE=true
  if ! $STALE; then
    ok "Hệ thống đang chạy sẵn - mở trình duyệt."
    open_browser
    exit 0
  fi
  step "Có code mới chưa build - dừng hệ thống để build lại..."
  for port in 6868 6869; do
    lsof -ti tcp:$port 2>/dev/null | xargs kill -9 2>/dev/null || true
  done
  sleep 1
fi
if $WEB_UP || $API_UP; then
  step "Phát hiện hệ thống chạy dở dang - khởi động lại cho sạch..."
  for port in 6868 6869; do
    lsof -ti tcp:$port 2>/dev/null | xargs kill -9 2>/dev/null || true
  done
  sleep 1
fi

# 3. Cài dependencies lần đầu
if [ ! -d "$ROOT/node_modules" ]; then
  step "Lần chạy đầu tiên - đang cài dependencies (vài phút)..."
  npm install --no-audit --no-fund || { err "npm install thất bại - xem log phía trên."; exit 1; }
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

err "Hệ thống chưa phản hồi sau 2 phút - xem log: tail -f start/server.log"
exit 1
