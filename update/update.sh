#!/usr/bin/env bash
# AI Edit Video — cập nhật bản mới nhất từ GitHub rồi khởi động lại (macOS/Linux)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo ""
echo "  AI Edit Video — CẬP NHẬT"
echo "  ========================="

# 1. Dừng hệ thống nếu đang chạy
for port in 6868 6869; do
  lsof -ti tcp:$port 2>/dev/null | xargs kill -9 2>/dev/null || true
done

# 2. Kéo bản mới nhất
printf '  \033[36m-> Đang kéo bản mới nhất từ GitHub...\033[0m\n'
git fetch origin
if ! git pull --ff-only; then
  printf '  \033[31m[LOI] Không pull được — máy này có thay đổi code cục bộ.\033[0m\n'
  printf '  \033[33m       Chạy "git stash" rồi thử lại, hoặc "git status" xem file nào đổi.\033[0m\n'
  exit 1
fi

# 3. Cài dependencies mới (nếu có)
printf '  \033[36m-> npm install...\033[0m\n'
npm install --no-audit --no-fund || { printf '  \033[31m[LOI] npm install thất bại.\033[0m\n'; exit 1; }

# 4. Khởi động lại — start.sh tự build phần code mới rồi mở trình duyệt
printf '  \033[32m[OK] Đã cập nhật. Đang khởi động...\033[0m\n'
exec bash "$ROOT/start/start.sh"
