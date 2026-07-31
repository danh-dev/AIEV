# AI Edit Video by noti.vn — script khởi động
# Tự kiểm tra môi trường -> cài dependencies (lần đầu) -> chạy server + web -> mở http://localhost:6868

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$WebUrl = "http://localhost:6868"

function Write-Step($msg)  { Write-Host "  -> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Err($msg)   { Write-Host "  [LOI] $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "  AI Edit Video by: noti.vn" -ForegroundColor White
Write-Host "  ==========================" -ForegroundColor DarkGray

# 1. Kiểm tra Node.js
try {
    $nodeVer = (node --version) -replace "v", ""
} catch {
    Write-Err "Chưa cài Node.js. Tải tại https://nodejs.org (bản 20 trở lên) rồi chạy lại."
    exit 1
}
if ([int]($nodeVer.Split(".")[0]) -lt 20) {
    Write-Err "Node.js $nodeVer quá cũ — cần bản 20 trở lên."
    exit 1
}
Write-Ok "Node.js v$nodeVer"

# 2. Kiểm tra trạng thái hiện tại: web (6868) VÀ backend (6869 qua proxy /api/health)
$webUp = $false; $apiUp = $false
try {
    $probe = Invoke-WebRequest -UseBasicParsing -Uri $WebUrl -TimeoutSec 2
    if ($probe.StatusCode -eq 200) { $webUp = $true }
} catch { }
try {
    $probeApi = Invoke-WebRequest -UseBasicParsing -Uri "$WebUrl/api/health" -TimeoutSec 3
    if ($probeApi.StatusCode -eq 200) { $apiUp = $true }
} catch { }

if ($webUp -and $apiUp) {
    Write-Ok "Hệ thống đang chạy sẵn — mở trình duyệt."
    Start-Process $WebUrl
    exit 0
}
if ($webUp -or $apiUp) {
    # Trạng thái nửa vời (vd web sống nhưng backend chết) → dọn sạch rồi khởi động lại
    Write-Step "Phát hiện hệ thống chạy dở dang — khởi động lại cho sạch..."
    foreach ($port in 6868, 6869) {
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object { taskkill /pid $_ /t /f 2>$null | Out-Null }
    }
    Start-Sleep -Seconds 1
}

# 3. Cài dependencies lần đầu
if (-not (Test-Path (Join-Path $root "node_modules"))) {
    Write-Step "Lần chạy đầu tiên — đang cài dependencies (vài phút)..."
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Write-Err "npm install thất bại — xem log phía trên."; exit 1 }
    Write-Ok "Đã cài dependencies."
}

# 4. Build server + web nếu chưa build HOẶC source mới hơn bản build (sau khi cập nhật code)
function Get-NewestWrite($dir) {
    if (-not (Test-Path $dir)) { return [datetime]::MinValue }
    $newest = Get-ChildItem $dir -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $newest) { return [datetime]::MinValue } else { return $newest.LastWriteTime }
}

$serverDist = Join-Path $root "apps\server\dist"
if (-not (Test-Path $serverDist) -or
    (Get-NewestWrite (Join-Path $root "apps\server\src")) -gt (Get-NewestWrite $serverDist)) {
    Write-Step "Build backend..."
    npm run build -w apps/server
    if ($LASTEXITCODE -ne 0) { Write-Err "Build server thất bại."; exit 1 }
}
$webNext = Join-Path $root "apps\web\.next"
if (-not (Test-Path $webNext) -or
    (Get-NewestWrite (Join-Path $root "apps\web\src")) -gt (Get-NewestWrite $webNext)) {
    Write-Step "Build web UI (vài phút)..."
    npm run build -w apps/web
    if ($LASTEXITCODE -ne 0) { Write-Err "Build web thất bại."; exit 1 }
}

# 4b. cloudflared: tự cài nếu thiếu (cho tính năng Cloudflare Tunnel — không bắt buộc)
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Step "Chưa có cloudflared — đang thử cài (winget)..."
    try {
        winget install --id Cloudflare.cloudflared --silent --accept-source-agreements --accept-package-agreements | Out-Null
        Write-Ok "Đã cài cloudflared."
    } catch {
        Write-Host "  [!] Không tự cài được cloudflared — cài tay: winget install --id Cloudflare.cloudflared (chỉ cần cho Tunnel)" -ForegroundColor Yellow
    }
}

# 5. Tạo .env nếu chưa có
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $root ".env.example") $envFile
    Write-Ok "Đã tạo file .env"
    Write-Host "     Lưu ý: muốn dùng tính năng Chat AI, đăng nhập Claude Code trên máy này (subscription OAuth — lệnh 'claude' -> /login) hoặc mở file .env và điền ANTHROPIC_API_KEY." -ForegroundColor Yellow
}

# 6. Chạy server + web trong cửa sổ riêng (giữ mở để xem log)
Write-Step "Khởi động server (port 6869) + web (port 6868)..."
Start-Process cmd -ArgumentList "/k", "title AI Edit Video - LOG && cd /d `"$root`" && npm run start" | Out-Null

# 7. Mở firewall port 6868 (trang web) + 6869 (backend API — trang /m trên điện
#    thoại upload file lớn gọi thẳng port này) cho tính năng "Kết nối điện thoại".
#    Không có quyền admin thì lệnh fail im lặng — Windows sẽ tự hỏi Allow khi có
#    kết nối đầu tiên.
try {
    netsh advfirewall firewall show rule name="AIEV Web 6868" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        netsh advfirewall firewall add rule name="AIEV Web 6868" dir=in action=allow protocol=TCP localport=6868 2>$null | Out-Null
    }
} catch { }
try {
    netsh advfirewall firewall show rule name="AIEV API 6869" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        netsh advfirewall firewall add rule name="AIEV API 6869" dir=in action=allow protocol=TCP localport=6869 2>$null | Out-Null
    }
} catch { }

# 8. Đợi web sẵn sàng rồi mở trình duyệt
Write-Step "Đang đợi hệ thống sẵn sàng..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $WebUrl -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
}

if ($ready) {
    Write-Ok "Hệ thống đã sẵn sàng!"
    Start-Process $WebUrl
    Write-Host ""
    Write-Host "  Dashboard : $WebUrl" -ForegroundColor White
    Write-Host "  Muốn dừng : chạy start\stop.bat (hoặc đóng cửa sổ log)" -ForegroundColor DarkGray
    Start-Sleep -Seconds 2
} else {
    Write-Err "Hệ thống chưa phản hồi sau 2 phút — xem cửa sổ 'AI Edit Video - LOG' để biết lỗi."
    exit 1
}
