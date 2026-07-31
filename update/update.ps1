# AI Edit Video — cập nhật bản mới nhất từ GitHub rồi khởi động lại
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "  AI Edit Video — CAP NHAT" -ForegroundColor White
Write-Host "  =========================" -ForegroundColor DarkGray

# 1. Dừng hệ thống nếu đang chạy (tránh file bị khóa khi build lại)
foreach ($port in 6868, 6869) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { taskkill /pid $_ /t /f 2>$null | Out-Null }
}

# 2. Kéo bản mới nhất
Write-Host "  -> Đang kéo bản mới nhất từ GitHub..." -ForegroundColor Cyan
git fetch origin
git pull --ff-only
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [LOI] Không pull được — máy này có thay đổi code cục bộ." -ForegroundColor Red
    Write-Host "        Chạy 'git stash' rồi thử lại, hoặc 'git status' xem file nào đổi." -ForegroundColor Yellow
    Read-Host "  Enter để thoát"
    exit 1
}

# 3. Cài dependencies mới (nếu có)
Write-Host "  -> npm install..." -ForegroundColor Cyan
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Write-Host "  [LOI] npm install thất bại." -ForegroundColor Red; Read-Host "  Enter để thoát"; exit 1 }

# 4. Khởi động lại — start.ps1 tự build lại phần code mới rồi mở trình duyệt
Write-Host "  [OK] Đã cập nhật. Đang khởi động..." -ForegroundColor Green
& (Join-Path $root "start\start.ps1")
