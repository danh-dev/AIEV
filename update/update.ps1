# AI Edit Video — cập nhật bản mới nhất từ GitHub rồi khởi động lại
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Ghi toàn bộ output vào start\update.log để soi được khi cập nhật lỗi
$log = Join-Path $root "start\update.log"
try { Start-Transcript -Path $log -Append | Out-Null } catch {}

function Stop-UpdateLog {
    try { Stop-Transcript | Out-Null } catch {}
}

Write-Host ""
Write-Host "  AI Edit Video — CAP NHAT" -ForegroundColor White
Write-Host "  =========================" -ForegroundColor DarkGray

# 1. Kéo bản mới TRƯỚC KHI dừng hệ thống — pull fail thì hệ thống cũ vẫn chạy
Write-Host "  -> Đang kéo bản mới nhất từ GitHub..." -ForegroundColor Cyan
git fetch origin
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [LOI] Không fetch được từ GitHub (mất mạng?). Hệ thống cũ vẫn chạy bình thường." -ForegroundColor Red
    Stop-UpdateLog
    Read-Host "  Enter để thoát"
    exit 1
}
git pull --ff-only
if ($LASTEXITCODE -ne 0) {
    # Máy chỉ-dùng hay dính thay đổi cục bộ (đổi eol, sửa nhầm file…) — stash rồi pull lại
    Write-Host "  -> Pull thất bại — đã stash thay đổi cục bộ (git stash: aiev-auto-stash), thử pull lại..." -ForegroundColor Yellow
    git stash push -u -m "aiev-auto-stash"
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [LOI] Vẫn không pull được — xem chi tiết trong start\update.log. Hệ thống cũ vẫn chạy bình thường." -ForegroundColor Red
        Write-Host "        Chạy 'git status' xem file nào đổi, 'git stash list' xem bản stash." -ForegroundColor Yellow
        Stop-UpdateLog
        Read-Host "  Enter để thoát"
        exit 1
    }
}

# 2. Pull OK → giờ mới dừng hệ thống để build lại (tránh file bị khóa)
Write-Host "  -> Dừng hệ thống đang chạy..." -ForegroundColor Cyan
foreach ($port in 6868, 6869) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { taskkill /pid $_ /t /f 2>$null | Out-Null }
}

# 3. Cài dependencies mới (nếu có)
Write-Host "  -> npm install..." -ForegroundColor Cyan
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [LOI] npm install thất bại — xem start\update.log." -ForegroundColor Red
    Stop-UpdateLog
    Read-Host "  Enter để thoát"
    exit 1
}

# 4. Khởi động lại — start.ps1 tự build lại phần code mới rồi mở trình duyệt
Write-Host "  [OK] Đã cập nhật. Đang khởi động..." -ForegroundColor Green
Stop-UpdateLog
& (Join-Path $root "start\start.ps1")
