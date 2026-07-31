#!/usr/bin/env bash
# AI Edit Video — cập nhật bản mới nhất từ GitHub rồi khởi động lại (macOS/Linux)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Ghi toàn bộ output vào start/update.log — script chạy nền (spawn từ WebUI)
# không có cửa sổ, log là cách duy nhất soi được lỗi.
LOG="$ROOT/start/update.log"
mkdir -p "$ROOT/start"
exec > >(tee -a "$LOG") 2>&1
echo ""
echo "===== $(date '+%Y-%m-%d %H:%M:%S') — bắt đầu cập nhật ====="

echo ""
echo "  AI Edit Video — CẬP NHẬT"
echo "  ========================="

# 1. Kéo bản mới TRƯỚC KHI dừng hệ thống — pull fail thì hệ thống cũ vẫn chạy
printf '  \033[36m-> Đang kéo bản mới nhất từ GitHub...\033[0m\n'
if ! git fetch origin; then
  printf '  \033[31m[LOI] Không fetch được từ GitHub (mất mạng?). Hệ thống cũ vẫn chạy bình thường.\033[0m\n'
  exit 1
fi
if ! git pull --ff-only; then
  # Máy chỉ-dùng hay dính thay đổi cục bộ (đổi eol, sửa nhầm file…) — stash rồi pull lại
  printf '  \033[33m-> Pull thất bại — đã stash thay đổi cục bộ (git stash: aiev-auto-stash), thử pull lại...\033[0m\n'
  git stash push -u -m "aiev-auto-stash" || true
  if ! git pull --ff-only; then
    printf '  \033[31m[LOI] Vẫn không pull được — xem chi tiết trong start/update.log. Hệ thống cũ vẫn chạy bình thường.\033[0m\n'
    printf '  \033[33m       Chạy "git status" xem file nào đổi, "git stash list" xem bản stash.\033[0m\n'
    exit 1
  fi
fi

# 2. Pull OK → giờ mới dừng hệ thống để build lại
printf '  \033[36m-> Dừng hệ thống đang chạy...\033[0m\n'
for port in 6868 6869; do
  lsof -ti tcp:$port 2>/dev/null | xargs kill -9 2>/dev/null || true
done

# 3. Cài dependencies mới (nếu có)
printf '  \033[36m-> npm install...\033[0m\n'
npm install --no-audit --no-fund || { printf '  \033[31m[LOI] npm install thất bại — xem start/update.log.\033[0m\n'; exit 1; }

# 4. Khởi động lại — start.sh tự build phần code mới rồi mở trình duyệt
printf '  \033[32m[OK] Đã cập nhật. Đang khởi động...\033[0m\n'
exec bash "$ROOT/start/start.sh"
