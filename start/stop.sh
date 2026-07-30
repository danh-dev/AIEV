#!/usr/bin/env bash
# AI Edit Video by noti.vn — dừng hệ thống (macOS / Linux)
set -u

echo "  Đang dừng AI Edit Video..."
STOPPED=false
for port in 6868 6869; do
  PIDS="$(lsof -ti tcp:$port 2>/dev/null || true)"
  if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
    echo "  [OK] Đã dừng process trên port $port"
    STOPPED=true
  fi
done
$STOPPED || echo "  Không có gì đang chạy trên port 6868/6869."
