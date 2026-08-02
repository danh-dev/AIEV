# API Contract — Web UI ↔ Backend

> **Nguồn sự thật duy nhất** cho giao tiếp giữa `apps/web` (Next.js, port 6868) và `apps/server` (Express, port 6869). Web rewrites `/api/*` và `/media/*` sang `http://localhost:6869`. Mọi thay đổi contract phải sửa file này trước.

## Quy ước chung

- JSON, UTF-8. Lỗi trả `{ "error": { "code": string, "message": string } }` + HTTP status đúng nghĩa.
- Thời gian: ISO 8601 string. ID job: `job_<nanoid>`. ID chat session: `sess_<nanoid>`.
- Project ID = tên folder trong `video-projects/` (kebab-case). `meta.json` trên đĩa là nguồn sự thật về project; DB (SQLite) chỉ lưu jobs + chat.

## Health & Dashboard

```
GET /api/health
→ { ok: true, checks: { ffmpeg: bool, node: string, claudeAuth: bool, hyperframes: bool } }

GET /api/overview
→ { runningJob: Job|null, queuedCount: number, recentJobs: Job[≤5],
    recentProjects: ProjectSummary[≤6], health: <như /api/health> }
```

`runningJob` = job đang chạy ĐẦU TIÊN (queue song song nên có thể nhiều job đang chạy cùng lúc).
`recentProjects` mỗi phần tử kèm `tokensUsed, costUsd`.

## Kiểm tra môi trường (card "Kiểm tra hệ thống" trang /config)

```
GET /api/doctor[?refresh=1]
→ { platform: string, ok: bool, missingRequired: string[],
    checks: [ { id, label, level: "required"|"optional"|"info",
                status: "ok"|"missing", detail: string, note: string|null,
                fix: { auto: bool, size?, command?, manual?, link?, url? } | null } ] }

POST /api/doctor/fix   { id }
→ { ok: bool, installed: bool, timedOut: bool, log: string[≤40], report: <như GET> }
```

Danh sách kiểm tra nằm ở **`start/doctor.mjs`** — dùng chung với `start.ps1` / `start.sh`, nên
terminal lúc khởi động và card trên web luôn khớp nhau. Backend **spawn** file đó (`--json` /
`--fix-one <id>`) chứ không import: mọi phép dò bên trong là `spawnSync` (phải chạy được trước
cả `npm install`), chạy trong tiến trình server sẽ chặn event loop ~6s.

- `detail` là dữ liệu máy dò được (version, đường dẫn) — KHÔNG dịch. `note` là mã để web tự dịch
  (`doctor.note.<note>`), `label` dịch qua `doctor.label.<id>` nếu có.
- Kết quả cache 20s; server tự dò sẵn một lần lúc khởi động để lần mở trang đầu không phải chờ.
- `POST /fix` chỉ chấp nhận mục có `fix.auto = true` (400 `MANUAL_ONLY` nếu không), mỗi lần một
  mục (409 `FIX_BUSY`). `installed` là kết quả DÒ LẠI sau khi cài — lệnh chạy xong chưa chắc đã
  thấy (winget ghi PATH ở nơi khác), nên đừng tin mỗi `ok` của lệnh.

## Kết nối điện thoại (upload từ điện thoại cùng WiFi)

```
GET /api/lan-info
→ { ips: string[], webPort: number, tunnelDomain: string|null }   // IPv4 non-internal của máy chạy server, ưu tiên 192.168/10.; webPort = 6868
```

`tunnelDomain`: hostname Quick Tunnel đang chạy (ưu tiên) hoặc `TUNNEL_DOMAIN` trong .env — QR "Kết nối điện thoại" tự dùng.

Trang web `/m/<projectId>` (Next.js, không phải API) là trang upload tối giản cho điện thoại — mở qua QR
trong modal "Kết nối điện thoại" ở card Nguồn & Asset (`http://<ip>:6868/m/<projectId>`).
Upload từ điện thoại gọi THẲNG backend `http://<ip>:6869/api/assets` (không qua proxy Next — request dài qua proxy dễ kẹt). Server tắt `requestTimeout` cho upload dài và tự hủy request nếu 45s không nhận thêm dữ liệu (stall → SSE `upload` báo `error`).
CORS của backend chấp nhận origin web UI trên LAN: `http://<ip-private>:6868` (localhost/127.0.0.1/192.168.x.x/10.x.x.x/172.16–31.x.x); start.ps1 mở firewall rule "AIEV API 6869".

### Upload session (bảo mật link QR)

```
POST   /api/upload-session          { projectId } → 201 { token: "ut_…", expiresAt }   // mở modal QR — token TTL 60 phút, lưu RAM
DELETE /api/upload-session/:token   → 204                                              // đóng modal QR — thu hồi ngay, idempotent
```

URL/QR mang token qua query `?k=`; trang `/m` gửi lại qua field `token` (append TRƯỚC `file`). POST `/api/assets` scope `project` từ máy KHÁC máy chủ (điện thoại LAN/tunnel — không phải loopback, hoặc có `x-forwarded-for`) bắt buộc token hợp lệ đúng project — sai/thiếu → `403 UPLOAD_TOKEN_INVALID` ("Link upload đã hết hạn — mở lại mã QR trên máy tính.").

**Đóng modal QR = đóng hết.** Thu hồi token, và nếu đường Internet được bật TỪ CHÍNH modal đó thì
tắt luôn tunnel (xem [Cloudflare Tunnel](#cloudflare-tunnel-card-trên-trang-connections)). Tab bị
đóng đột ngột thì client dùng `fetch(..., { keepalive: true })` trong `pagehide` để gửi nốt hai lời
gọi này; hỏng nốt đường đó thì token hết hạn theo TTL 60 phút và tunnel bị vòng canh của server tắt.

## Projects

```
ProjectSummary = { id, name, width, height, fps, status: "draft"|"rendering"|"done",
                   output: string|null, tags: string[], createdAt: string|null, updatedAt }

GET    /api/projects            → ProjectSummary[]   (quét video-projects/*/meta.json;
                                  mỗi phần tử kèm tokensUsed, costUsd)
POST   /api/projects            { id, name, width, height, fps } → ProjectSummary (201)
                                  — scaffold folder + meta.json + compositions/ + assets/ + renders/
GET    /api/projects/:id        → meta.json đầy đủ + { files: { renders: FileInfo[], assets: FileInfo[] } }
DELETE /api/projects/:id?force=true → 204 (không có force → 400)
POST   /api/projects/:id/clone  { name? } → ProjectSummary (201) — nhân bản project:
                                  copy compositions/assets/brief/tags/scenes (bỏ renders/cache),
                                  reset status draft + output null, id mới sinh từ name

PUT    /api/projects/:id/tags   { tags: string[] } → 200 ProjectSummary — gán tag cho project

GET    /api/projects/:id/junk        → { items: [{ relPath, size }], totalBytes } — file rác (file trung gian):
                                       renders/ verify/ cache/, props.resolved.json, outputs/<id>-draft.mp4,
                                       staging Remotion vid-<id>/ img-<id>/ (thư mục có "/" cuối, size là tổng)
POST   /api/projects/:id/junk/clean  → { freedBytes, deleted } — xóa các mục trên (file nguồn + final giữ nguyên);
                                       project đang có job running/queued → 409 JOB_RUNNING

FileInfo = { name, relPath, size, mtime, kind: "video"|"audio"|"image"|"other" }
```

## Project Brief — kịch bản edit (AI đọc phần này khi edit)

`meta.json` của project có thêm field `brief`:

```
Brief = {
  sourceDescription: string,               // mô tả nội dung video gốc (bối cảnh cho AI)
  autoCut: boolean,                        // có tự động cắt ngắn đoạn thừa không
  subtitles: boolean,                      // có tạo phụ đề (karaoke) không
  highlightEnabled: boolean,               // BẬT = AI tự phân tích source, chọn keyword và highlight
  highlightKeywords: string[],             // (nâng cao, tùy chọn) chỉ định thêm keyword thủ công
  keyLayoutEnabled: boolean,               // BẬT (mặc định) = bố cục Key: KEY CHÍNH ở vùng TRÊN video,
                                           //   các KEY LIÊN QUAN ở vùng DƯỚI (trên caption) — spec ở skill `key-layout`
  mainKey: string,                         // key chính do user chỉ định — "" = AI tự phân tích chọn
  relatedKeys: string[],                   // key liên quan user chỉ định (bắt buộc dùng đủ) — [] = AI tự chọn 3–6 key
  skill: string|null,                      // tên skill dùng để edit (null = AI tự chọn)
  sfxMode: "recommended"|"library"|"none", // sfx: chỉ dùng bộ đề xuất / tự tìm cả thư viện / không dùng
  musicMode: "auto"|"none",                // nhạc nền: AI tự chọn bài theo mood trong assets/music/ (mặc định) / không dùng
  autoIllustrations: boolean,              // BẬT = AI tự tạo ảnh minh họa (Gemini) khi edit
  illustrationModel: string|null,          // model Gemini tạo ảnh (null = mặc định)
  illustrationText: boolean,               // BẬT = Gemini được vẽ chữ tiếng Việt vào ảnh minh họa (mặc định TẮT — chữ do Remotion/HyperFrames đặt)
  styleId: string|null,                    // Style Design áp cho project (null = style default)
  notes: string                            // Yêu cầu edit (prompt) — nội dung chính gửi AI, đổ được từ prompt mẫu
}

GET /api/projects/:id        → response thêm brief (trả default nếu meta chưa có) 
                               và files.assets có thêm description?: string
PUT /api/projects/:id/brief  Brief (partial được — merge) → 200 Brief
```

## Mô tả asset của project

File `video-projects/<id>/assets/assets.json` = `{ "<fileName>": { "description": string, colorGrade?, colorAdjust? } }`
(`colorGrade` = preset màu đã áp, `colorAdjust` = chỉnh tay — xem mục Color Grading).

```
PUT /api/projects/:id/assets/:file/description  { description } → 200 FileInfo
DELETE /api/projects/:id/assets/:file           → 204 — xóa file asset (kể cả trong thư mục con)
                                                  + entry trong assets.json (cấm xóa assets.json → 400)
GET /api/assets?scope=project&projectId=<id>    → FileInfo[] (thêm description?: string)
```

## Color Grading (chỉnh màu footage — chi tiết ở skill `color-grading`)

```
GET  /api/grade-presets                                → danh sách preset màu (id, label, mô tả)
POST /api/projects/:id/assets/:file/grade-preview      { preset?, adjust?, t? } → ảnh frame đã áp màu (preview trên UI)
POST /api/projects/:id/assets/:file/grade-frame        { t? } → ảnh frame gốc tại giây t (để so sánh)
PUT  /api/projects/:id/assets/:file/grade              { preset?, adjust? } → 200 — lưu colorGrade/colorAdjust vào assets.json
```

## Bắt đầu edit bằng AI từ project

```
POST /api/projects/:id/edit  { extraNotes?: string } → 202 { sessionId }
```

Server tự soạn prompt đầy đủ từ: meta.json (scenes + brief), assets.json (mô tả từng video/ảnh),
danh sách sound effect (chỉ bộ đề xuất nếu `sfxMode: "recommended"`, cả thư viện nếu `"library"`,
bỏ qua nếu `"none"`), và chỉ định skill trong brief — rồi chạy agent (cùng pipeline với /api/chat,
event đẩy qua SSE kênh `agent`). Web UI mở trang Chat với sessionId này.

## AI Providers & chọn model

```
GET /api/providers → { providers: Provider[] }
Provider = { id: "claude"|"gemini", label, connected: boolean,
             source: "oauth"|"api-key"|null, note?: string,
             roles: ("edit"|"chat"|"image")[], models: [{ id, label }] }
```
- claude: connected khi có OAuth Claude Code (~/.claude/.credentials.json) hoặc ANTHROPIC_API_KEY.
  models = các model Claude khả dụng cho agent edit/chat. Chọn model gửi qua:
  `POST /api/chat { ..., model? }` và `POST /api/projects/:id/edit { ..., model? }` —
  lưu vào chat_sessions.model, mọi lượt chạy sau của session dùng model đó.
- gemini: connected khi có GEMINI_API_KEY/GOOGLE_API_KEY trong .env (GOOGLE_API_KEY thắng nếu có cả hai).
  Antigravity/gemini-cli chỉ được ghi nhận ở note (auth nội bộ IDE, không gọi API ảnh được). roles = ["image"].
- `GET /api/providers/gemini/image-models` → [{ id, label }] — danh sách model tạo ảnh Gemini khả dụng.
- `GET /api/providers/claude/models` → { source: "anthropic"|"static", models: [{ id, label }] } — danh sách model Claude live từ Anthropic Models API (cần ANTHROPIC_API_KEY, cache 10'); OAuth-only/lỗi → danh sách tĩnh đầy đủ.

## Kết nối (Connections — trang /connections)

```
GET  /api/connections                    → trạng thái kết nối từng provider (connected, source, note)
PUT  /api/connections/:provider/key      { apiKey } → 200 — lưu API key vào .env
POST /api/connections/:provider/test     → { ok, message? } — gọi thử API để kiểm tra key
```

## Cloudflare Tunnel (card trên trang /connections)

```
GET  /api/tunnel          → { installed, running, auto, mode: "named"|"quick"|null, url, domain, lastLog: string[] }
PUT  /api/tunnel/domain   { domain } → 200 — validate hostname, ghi TUNNEL_DOMAIN vào .env (rỗng/null = xóa)
POST /api/tunnel/start    { auto? } → 202 { mode, auto } — có domain: named tunnel; không: Quick Tunnel (*.trycloudflare.com). 409 NOT_INSTALLED / đang chạy
POST /api/tunnel/stop     { onlyAuto? } → 204 — kill cả cây process cloudflared
```

Quick Tunnel đang chạy → `/api/lan-info.tunnelDomain` trả hostname URL đó (ưu tiên hơn env) để QR điện thoại tự dùng.

**Tunnel `auto` — bật từ modal QR "Kết nối điện thoại".** Link tunnel là public, để nó sống sau khi
người dùng đã xong việc là phơi dashboard ra Internet mà không ai để ý. Nên:

- `POST /start { auto: true }` đánh dấu tunnel này thuộc về phiên QR.
- Đóng modal → client gọi `POST /stop { onlyAuto: true }`. Cờ `onlyAuto` để KHÔNG tắt nhầm tunnel
  người dùng tự bật ở trang Kết nối (cái đó thường dùng để vào dashboard từ xa).
- Tab bị đóng đột ngột thì lời gọi trên không tới nơi. Server có vòng canh 30s: tunnel `auto` mà
  **không còn phiên upload nào sống** liên tục quá 2 phút thì tự tắt. Đo thật: tắt ở giây 121.
- Còn phiên upload sống thì không bao giờ tắt (đã đo: chạy tiếp qua mốc 150s).

## Ảnh minh họa AI (POST /api/illustrations)

```
POST /api/illustrations
  { projectId, prompt, name?, aspect?, model?, styleId?, description?, allowText? }
  → 201 { file, relPath, promptUsed }
```
Tạo ảnh minh họa bằng Gemini và lưu thẳng vào `video-projects/<projectId>/assets/`.
Thiếu `styleId` → server tự lấy `brief.styleId` của project (rồi mới tới style default) —
ảnh luôn đồng bộ Style Design. `promptUsed` = prompt cuối đã trộn style.
`allowText: true` = cho phép Gemini vẽ chữ vào ảnh (ghi nguyên văn cụm chữ trong prompt);
thiếu field → server lấy `brief.illustrationText` của project (mặc định false — cấm chữ).

Chi tiết kỹ thuật (đã verify 2026-07-29):
- Claude models cho edit/chat (options.model của Agent SDK): "claude-fable-5" (mặc định),
  "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5". SDK cũng nhận options.effort
  ("low"|"medium"|"high"|"xhigh") — expose thành "mode" trên UI: Nhanh(low)/Chuẩn(medium)/Sâu(high).
  chat_sessions thêm cột model TEXT, effort TEXT.
- Gemini tạo ảnh: POST https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-image:generateContent
  header x-goog-api-key; body { contents:[{parts:[{text: prompt}]}], generationConfig:
  { responseModalities:["TEXT","IMAGE"], imageConfig:{ aspectRatio:"9:16"|..., imageSize:"1K"|"2K" } } };
  ảnh trả về candidates[0].content.parts[].inlineData.data (base64). Không có free tier ảnh (~$0.05-0.07/ảnh 1K).

## Thumbnail video project (POST /api/projects/:id/thumbnail)

```
POST /api/projects/:id/thumbnail  { title, frameAt?, sourceRel?, bgPrompt?, styleId? } → 201 { file: "thumbnail.png", relPath }
```
Chạy ĐỒNG BỘ (~1 phút): ffmpeg cắt frame tại giây `frameAt` (mặc định 1) từ video (`sourceRel`,
mặc định output final trong meta, fallback video asset đầu) → Gemini vẽ nền theo Style Design
(lỗi/thiếu key → composition tự dựng nền gradient từ style) → `remotion still Thumbnail`
(nền + frame card + title + logo, 100% theo style) → `video-projects/<id>/thumbnail.png`.
Style resolve: `body.styleId` → `brief.styleId` → default. `GET /api/projects/:id` trả thêm
`thumbnail: "thumbnail.png"|null` (check file tồn tại).

## Auto cut videos (tab riêng) - auto-cut/<id>/

Cắt một video dài thành nhiều video ngắn; **mỗi đoạn tự động trở thành một Videos Project
dựng sẵn** (có asset, transcript đã rebase về gốc 0, brief) nên không phải import lại.

```
AutoCutMeta = { id, name, status: "draft"|"planning"|"planned"|"cutting"|"done"|"failed",
  source: { relPath, width, height, fps, durationSec, rotation },
  mode: "time"|"ai"|"prompt",
  params: { minutes?, overlapSec?, count?, minSec?, maxSec?, request? },
  output: { aspect: "keep"|"9:16"|"16:9"|"1:1"|"4:5", layout: "auto"|"crop"|"fit",
            background: "gemini"|"blur"|"style", styleId, fps },
  brief: Brief,          // cấu hình edit áp cho MỌI project con (đúng bộ field
                         // Kịch bản edit của Videos Project)
  transcribe, autoEdit, transcriptRel?,
  segments: [{ index, start, end, title, hook?, reason?, score?, selected,
               projectId?, appliedLayout? }],
  error?, createdAt, updatedAt }

GET    /api/auto-cut/sources   -> { files: FileInfo[] }   // video trong imports/
GET    /api/auto-cut           -> { sessions: AutoCutMeta[] }
GET    /api/auto-cut/:id       -> { session }
POST   /api/auto-cut           { name?, sourceRel, mode, params?, output?, brief?, transcribe?, autoEdit? } -> 201
PATCH  /api/auto-cut/:id       { name?, params?, output?, brief?, transcribe?, autoEdit?, segments? } -> 200
POST   /api/auto-cut/:id/plan  -> 202 { job }   // job auto-cut step "plan"
POST   /api/auto-cut/:id/cut   -> 202 { job }   // job auto-cut step "cut"
DELETE /api/auto-cut/:id?force=true -> 204      // KHÔNG xóa các project con đã tạo
```

Upload nguồn dùng lại `POST /api/assets` với `scope=imports` (có sẵn thanh tiến độ + QR điện thoại).

**Cấu hình edit của phiên (`brief`)**: validate bằng đúng `applyBriefPatch` của
`PUT /api/projects/:id/brief` (hàm dùng chung trong `meta.ts`) nên hai nơi không lệch luật.
Sửa `brief` KHÔNG reset danh sách đoạn (chỉ ảnh hưởng khâu dựng project con). Khi cắt, job
áp `brief` cho mọi project con, chỉ ghi đè 4 field phụ thuộc từng đoạn: `styleId` (lấy từ
`output.styleId` - một nguồn sự thật), `sourceDescription`, `mainKey` (dùng tiêu đề đoạn khi
user để trống) và `notes` (hướng dẫn bắt buộc về file đã cắt sẵn đứng TRƯỚC, ghi chú của user nối sau).

**Job `auto-cut`**: `projectId` là id phiên cắt, `sceneId` mang step. Hai bước tách rời để người
dùng DUYỆT danh sách đoạn trước khi tốn thời gian encode.
- `plan`: transcribe (faster-whisper large-v3, `language="vi"`, word timestamp, cuda float16 fallback cpu int8) rồi chọn đoạn.
  **Thời gian đo thật** (GTX 1660, CUDA float16): video 55 giây mất 56 giây, trong đó ~20 giây là nạp
  model lần đầu. Tức khoảng **0.65x thời lượng video** sau khi model đã nạp - video 1 tiếng mất
  khoảng 40 phút. Job có progress theo từng segment nên UI phải nói rõ điều này, đừng để người dùng
  tưởng treo.
- `cut`: cắt + đổi khung + tạo project con + (tùy chọn) chạy edit AI tối đa 3 project.

### Đổi khung hình (reframe)

| layout | cách làm | được / mất |
|---|---|---|
| `crop` | dò tâm nhân vật rồi cắt cúp bám theo | chủ thể to, đầy khung / mất phần rìa |
| `fit` | thu nhỏ giữ trọn khung, lấp nền (Gemini / mờ / màu style) | không mất thông tin / chủ thể nhỏ |
| `auto` | hỏi Gemini khung là người hay màn hình rồi tự chọn | mặc định |

**Dò chủ thể** dùng Gemini vision (`gemini-2.5-flash`, ảnh + yêu cầu trả `{found, box:[ymin,xmin,ymax,xmax]}`
chuẩn hoá 0-1000), lấy trung vị 3 mốc trong đoạn. Đã đo thật: sai số khoảng 1% so với vị trí đúng.
Không có key hoặc lỗi -> rơi về tâm khung, không bao giờ làm hỏng job.

⚠️ **Cờ xoay video**: `ffprobe` trả width/height của luồng THÔ. File `20260731-164133.mp4` trong repo
báo 3840x2160 nhưng có `stream_side_data=rotation=-90`, khung giải mã thật là 2160x3840. Mọi phép
tính tỉ lệ PHẢI hoán đổi width/height khi |rotation| là 90/270, nếu không video quay bằng điện thoại
sẽ bị hiểu nhầm là video ngang.

## Transcript của project (nguồn dùng chung)

`apps/server/src/transcript.ts` dò transcript theo thứ tự ưu tiên "bản đã chốt trước, bản thô sau":
`assets/transcript.final.json` -> `assets/transcript.cut.json` -> `assets/transcript.json` ->
các bản trong `assets/audio/` -> quét thêm mọi `assets/**/[*]transcript*.json`. Nhận cả 3 dạng:
`{ segments: [...] }` (faster-whisper), mảng segment trần, hoặc `{ words: [...] }` (tự gom câu theo
khoảng lặng > 0.6s). Chuẩn hóa về `{ relPath, segments: [{ start, end, text, words }], durationSec }`.
Phụ đề, gợi ý cắt short và gói xuất bản đều đọc qua module này - project cũ không phải sửa gì.

## Gói xuất bản: phụ đề + metadata đăng bài

```
GET  /api/projects/:id/subtitles?format=srt|vtt  -> text/plain (attachment <id>.srt|.vtt)
POST /api/projects/:id/subtitles                 -> 201 { srt, vtt, cues }
                                 ghi video-projects/<id>/publish/<id>.srt + .vtt
GET  /api/projects/:id/publish                   -> { pack: PublishPack|null }
POST /api/projects/:id/publish  { platforms?: ("tiktok"|"youtube"|"facebook")[] } -> 201 { pack }

PublishPack = { generatedAt, transcriptRel,
                items: [{ platform, title, description, hashtags: string[] }],
                subtitles: { srt, vtt }, thumbnail: string|null, output: string|null }
```
Chia cue phụ đề: mỗi segment 1 cue; segment > 7s hoặc > 84 ký tự thì chia theo word timestamp
(tối đa 42 ký tự/dòng, 2 dòng/cue, cue tối thiểu 0.8s, không chồng cue kế tiếp).
Metadata do Claude soạn một lượt (không tool) theo transcript + tone của Style Design, ràng buộc
độ dài title theo từng nền tảng. Chưa có transcript -> 404 `NO_TRANSCRIPT`.

## QC tự động (đo bằng ffmpeg, chặn final nếu FAIL)

```
POST /api/projects/:id/qc  { file?: relPath, platform?: "tiktok"|"youtube"|"reels" } -> { report }
GET  /api/projects/:id/qc  -> { report: QcReport|null, stale?: true }

QcReport = { checkedAt, file, fileMtime, platform, status: "pass"|"warn"|"fail",
             checks: [{ id, label, status, detail, value, frames?: string[] }] }
```
File mặc định: `outputs/<id>-draft.mp4` -> file .mp4 mới nhất trong `renders/` -> `meta.output`.
Kết quả ghi `video-projects/<id>/qc.json`. `stale: true` khi file đã đổi sau lần QC gần nhất.

Các phép đo: `resolution` (so meta), `loudness` (loudnorm, mục tiêu -14 LUFS), `truepeak` (clipping),
`blackframes` (bỏ qua fade đầu/cuối, `pix_th=0.03` để nền tối `#0A0E1A` không bị báo nhầm là đen),
`freeze`, `tail-silence`, `av-duration`, `duration`, và `safe-area`.

**`safe-area` không tự kết luận.** Đã đo và xác nhận: mật độ biên (edgedetect + signalstats) của chữ
và của cảnh quay là như nhau (dải trên 2.99 tại giây 3 hóa ra là lá cây, không phải chữ), nên mọi
ngưỡng pass/fail đều báo sai. Thay vào đó check này luôn `pass` và trả `frames` - ảnh TOÀN KHUNG có
khoanh đỏ dải trên 10% + dải dưới 16%, ghi vào `video-projects/<id>/renders/qc-safe-area-<n>.png`.
Người dùng xem trên UI, agent bắt buộc `Read` từng ảnh để tự phán. Việc phân biệt chữ với cảnh quay
là việc của thị giác, không phải của ffmpeg.

**Cổng chặn**: `POST /api/jobs` với `type: "assemble-final"` bị 409 `QC_REQUIRED` (chưa QC hoặc QC
đã cũ) hoặc 409 `QC_FAILED` (có check fail). Bỏ qua bằng `force: true` trong body, hoặc tắt
`qcGate` trong render settings (tab Tăng tốc). Các job khác không bị ảnh hưởng.

## Cắt short từ video dài + Tái chế tỉ lệ khung

```
POST /api/projects/:id/clips/suggest { count?=5, minSec?=20, maxSec?=60 } -> 201 { clips, suggestedAt }
GET  /api/projects/:id/clips        -> { clips, suggestedAt }
POST /api/projects/:id/clips/create { indexes: number[], width?=1080, height?=1920, autoEdit? }
                                    -> 201 { created: [{ id, name, sessionId }] }
POST /api/projects/:id/repurpose    { aspect: "9:16"|"16:9"|"1:1"|"4:5", name?, autoEdit? }
                                    -> 201 { project, sessionId }

Clip = { start, end, title, hook, reason, score }   // lưu video-projects/<id>/clips.json
```
AI đọc transcript, chọn các đoạn đứng riêng được (mở bằng hook, kết thúc trọn ý, không chồng lấn).
Project con tạo bằng `childProject.ts`: asset mang sang bằng **hardlink** (không nhân đôi dung lượng),
kèm transcript của cha; scene của clip là một `srcVideo` với `from`/`to` tuyệt đối trong file nguồn.
Tái chế tỉ lệ copy cả `compositions/` + scenes, đổi width/height, brief kèm hướng dẫn dựng lại bố cục.
`autoEdit` chạy phiên edit AI luôn (tối đa 3 project mỗi lần để không quá tải).

## Duyệt bản draft (ghi chú theo mốc thời gian)

```
GET    /api/projects/:id/review              -> { notes }        // sắp theo atSec
POST   /api/projects/:id/review              { atSec, text }     -> 201 { note }
PATCH  /api/projects/:id/review/:noteId      { text?, status? }  -> 200 { note }
DELETE /api/projects/:id/review/:noteId      -> 204
POST   /api/projects/:id/review/send         { extraNotes? }     -> 202 { sessionId, sentCount }

Note = { id, atSec, text, status: "open"|"sent"|"resolved", createdAt, sentAt? }
```
Lưu ở `video-projects/<id>/review.json`. `send` gom các note `open`, soạn message tiếng Việt
dạng `- [mm:ss] (12.4s) nội dung`, bọc trong `<ghi-chu-nguoi-dung>` kèm luật chống prompt injection,
rồi tiếp tục ĐÚNG phiên edit gần nhất của project (AI còn ngữ cảnh đã dựng) hoặc tạo phiên mới nếu
chưa có. Phiên đang chạy -> 409 `SESSION_BUSY`.

## Style Design (nhiều bộ nhận diện, tab riêng — THAY THẾ Design System cũ) — assets/styles/styles.json

```
StyleDesign = { id, name, tags: string[],
                colors: { primary, secondary, background, text, accent },
                fonts: { heading, body }, fontFiles: { heading: string|null, body: string|null },
                effects: { gradient: boolean, liquidGlass: boolean },
                logoPath: string|null, tone, guidelines, createdAt, updatedAt }

GET    /api/styles                → { defaultId: string|null, styles: StyleDesign[] }
POST   /api/styles                { name, tags?, cloneFrom? } → 201 (id từ name; cloneFrom copy toàn bộ)
PUT    /api/styles/:id            partial (name/tags/colors/fonts/effects/tone/guidelines) → StyleDesign
DELETE /api/styles/:id            → 204 (default bị xóa → chuyển default sang style còn lại; cấm xóa style cuối)
POST   /api/styles/:id/default    → { defaultId }
POST   /api/styles/:id/logo       multipart → StyleDesign (file lưu assets/styles/files/)
POST   /api/styles/:id/font?slot=heading|body  multipart → StyleDesign
POST   /api/styles/:id/font-google { slot: "heading"|"body", family } → StyleDesign
                                  — tải font Google (subset vietnamese) về assets/styles/files/
DELETE /api/styles/:id/font/:slot → StyleDesign
```

- **Migration tự động**: lần chạy đầu, `assets/brand/design-system.json` (nếu có) chuyển thành style
  đầu tiên (id "noti-vn", tag ["brand"]) và làm default. `/api/design-system` BỎ HẲN.
- **Chọn style**: `ImageProject.styleId: string|null` và `Brief.styleId: string|null` (null = dùng default).
  `POST /api/illustrations` nhận thêm `styleId?` — thiếu thì server tự resolve `brief.styleId`
  của video project (rồi mới tới default), nên ảnh minh họa KHÔNG BAO GIỜ thoát style đã chọn.
- **CƯỠNG CHẾ 100%**: mọi sản phẩm (nền Gemini, Poster Remotion, ảnh minh họa, video edit) BẮT BUỘC
  theo style đã chọn. Trong prompt gửi agent, khối "STYLE DESIGN (BẮT BUỘC)" có luật ưu tiên:
  Style Design > prompt mẫu > skill — skill/prompt quy định màu/font khác cũng KHÔNG được theo.

## Image Projects (tạo ảnh AI — Gemini nền + Remotion hoàn thiện) — image-projects/<id>/

```
ImageProject = { id, name, prompt, kind: "background"|"3d"|"character"|"texture"|"product"|"concept",
                 aspect: "9:16"|"16:9"|"1:1"|"4:5", status: "draft"|"generating"|"done"|"error",
                 overlay: { title, subtitle, stats: [{label,value}], cta, showLogo: boolean },
                 model: string|null, styleId: string|null,
                 background: string|null, final: string|null, error: string|null,
                 createdAt, updatedAt }

GET    /api/images                → ImageProject[]
POST   /api/images                { name, prompt, kind, aspect, overlay? } → 201 (id sinh từ name)
GET    /api/images/:id            → ImageProject
PUT    /api/images/:id            partial (name/prompt/kind/aspect/overlay) → ImageProject
DELETE /api/images/:id            → 204
POST   /api/images/:id/background multipart → ImageProject (tự upload nền, không cần Gemini)
POST   /api/images/:id/generate   { step?: "all"|"background"|"compose" } → 202 Job (queue type "image-gen")
GET    /api/images/:id/junk       → { items: [{ relPath, size }], totalBytes } — file rác: props.json,
                                    staging Remotion img-<id>/ (background/final/meta giữ nguyên)
POST   /api/images/:id/junk/clean → { freedBytes, deleted } — xóa các mục trên; job running/queued → 409 JOB_RUNNING
```

Pipeline generate: (1) `background` — gọi Gemini tạo ảnh nền theo prompt + kind + aspect,
prompt được TRỘN với Design System (màu brand, tone) để đồng bộ; không có GEMINI_API_KEY → job fail
với hướng dẫn (hoặc dùng bước upload nền thủ công rồi chạy `compose`). (2) `compose` — Remotion
render still composition `Poster`: nền + tiêu đề tiếng Việt + logo + số liệu + CTA theo đúng
màu/typography của Design System → `final.png`. Job.projectId = id image project; UI phân biệt
qua job.type = "image-gen". /media phục vụ thêm thư mục `image-projects/`.

Hợp đồng composition Remotion `Poster` (render bằng `npx remotion still Poster --props=<file> --output=<png>`;
kích thước qua calculateMetadata từ props):
```
PosterProps = {
  aspect: "9:16"|"16:9"|"1:1"|"4:5",          // 9:16=1080x1920, 16:9=1920x1080, 1:1=1080x1080, 4:5=1080x1350
  background: string|null,                     // staticFile path trong public/staging (null = nền gradient từ design)
  design: { colors: {primary, secondary, background, text, accent},
            fonts: {heading, body},
            fontFiles: { heading: string|null, body: string|null },  // staticFile path font đã stage
            effects: { gradient: boolean, liquidGlass: boolean },
            logoFile: string|null, brandName: string },
  overlay: { title, subtitle, stats: [{label, value}], cta, showLogo }
}
```
Server stage nền + logo bằng hardlink vào engines/remotion/public/staging/img-<id>/ trước khi still
(cùng cơ chế với assemble).

## Prompt mẫu (quản lý prompt tái sử dụng — lưu tại assets/prompts/prompts.json)

```
PromptTemplate = { id, name, content, createdAt, updatedAt }

GET    /api/prompts        → PromptTemplate[]
POST   /api/prompts        { name, content } → PromptTemplate (201; id sinh từ name kebab, trùng thêm -2)
PUT    /api/prompts/:id    { name?, content? } → PromptTemplate
DELETE /api/prompts/:id    → 204
```

UI: trong form Brief có dropdown "Dùng prompt mẫu" — chọn thì đổ `content` vào ô "Yêu cầu edit"
(notes) rồi tùy chỉnh tiếp; trang quản lý riêng ở /prompts.

## Render Jobs (queue SONG SONG — tối đa `queueConcurrency` job cùng lúc)

Queue chạy song song tối đa `queueConcurrency` job (1–4, mặc định 2 — chỉnh ở tab Cấu hình
hoặc env `QUEUE_CONCURRENCY`). Ràng buộc: **2 job của cùng một project không bao giờ chạy
đồng thời**. `runningJob` trong /api/overview = job đang chạy đầu tiên (có thể có nhiều job
đang chạy song song).

```
Job = { id, projectId, type: "scene-draft"|"scene-final"|"assemble-draft"|"assemble-final"|"image-gen",
        sceneId: string|null, status: "queued"|"running"|"done"|"failed"|"canceled",
        progress: 0..100, step: string, outputPath: string|null,
        createdAt, startedAt: string|null, finishedAt: string|null }

GET  /api/jobs?limit=50         → Job[] (mới nhất trước)
GET  /api/jobs/:id              → Job & { log: string }
POST /api/jobs                  { projectId, type, sceneId? } → Job (201)
POST /api/jobs/:id/cancel       → Job (kill process nếu đang chạy)

GET  /api/render-settings       → { settings, defaults, hardware, recommended: { workers, concurrency, maxWorkers } }
                                  (cấu hình render — tab Cấu hình; recommended theo máy thật: min(luồng CPU, 8), trần max(luồng CPU, 4))
PUT  /api/render-settings       partial → 200 (queueConcurrency clamp 1–4; workers/remotionConcurrency clamp 0–max(luồng CPU, 4))
```

Thực thi (cwd trong ngoặc):
- `scene-draft|scene-final`: với mỗi scene có `src` trong meta.json (hoặc chỉ `sceneId` nếu truyền):
  `npx hyperframes render --quality draft|standard --output renders/<sceneId>[.draft].mp4` (cwd `video-projects/<id>`)
- `assemble-draft|assemble-final`: stage asset bằng **hardlink** vào `engines/remotion/public/staging/<projectId>/`,
  sinh `props.resolved.json` (đường dẫn đổi thành `staging/<projectId>/...`), rồi
  `npx remotion render Assemble --props=<props.resolved.json> --output=<abs outputs/...>` (cwd `engines/remotion`)
  Draft thêm `--crf 28`. Final ghi `outputs/<projectId>-v<N>.mp4` (N tự tăng), xong cập nhật meta.json (`status`, `output`).
- Progress: parse stdout hai CLI (dòng tiến độ frame) → `progress` + `step`, đẩy SSE. Log đầy đủ lưu DB.
- Server từ chối (409) job `*-final` nếu chưa có job `assemble-draft` thành công cho project đó.

## SSE — GET /api/events

Một stream chung, `text/event-stream`, heartbeat comment mỗi 15s. Event types:

```
event: job      data: Job                                  (mỗi lần job đổi status/progress)
event: joblog   data: { jobId, line }                      (từng dòng log job đang chạy)
event: agent    data: { sessionId, kind: "text"|"tool"|"result"|"error"|"done",
                        text?, tool?: { name, input }, error?,
                        status? }                          (status đi kèm kind "done" — trạng thái kết thúc của phiên)
event: upload   data: { id, projectId?, received, total, done, error?, file? }  (tiến trình nhận file POST /api/assets, throttle ~400ms — event done thành công kèm `file` = tên đã lưu)
```

## Skills

```
GET    /api/skills              → [{ name, description, updatedAt, sizeBytes }]  (đọc .claude/skills/*/SKILL.md)
GET    /api/skills/:name        → { name, content }
POST   /api/skills              { name, content } → 201 (409 nếu trùng; validate frontmatter có name+description)
PUT    /api/skills/:name        { content } → 200
DELETE /api/skills/:name        → 204

POST   /api/skills/generate     — tạo draft SKILL.md bằng Claude (Agent SDK, một lượt, không tool).
  Body (mọi field trừ goal đều optional):
  { goal: string,                 // mục đích & loại video — BẮT BUỘC
    name?: string,                // tên kebab-case gợi ý; rỗng = AI tự đặt
    platform?: string,            // "TikTok" | "YouTube" | "Facebook" | "Instagram" | tự do
    aspect?: "9:16"|"16:9"|"1:1"|"4:5",
    fps?: 30|60,
    duration?: string,            // vd "30–60s"
    style?: string,               // phong cách & nhịp điệu
    captions?: "karaoke"|"sentence"|"none",
    highlights?: boolean,         // keyword highlight
    sfx?: boolean,                // sound effect đồng bộ timestamp
    baseSkill?: string,           // tên skill có sẵn làm mẫu — server nhúng nội dung vào prompt
    notes?: string }
  → 200 { name, content, tokens: { input, output } }
  — server nhúng skill-authoring + baseSkill (nếu có) vào prompt; kết quả parse từ code fence
    hoặc toàn văn, validate frontmatter (name ép kebab-case, tránh trùng bằng hậu tố -2).
    KHÔNG ghi file — UI hiển thị draft, user sửa rồi POST /api/skills để lưu.
  Lỗi: 503 NO_CLAUDE_AUTH (chưa đăng nhập Claude), 422 BAD_SKILL_OUTPUT (AI trả sai định dạng —
    body kèm { raw } để user tự sửa), 500 GENERATION_FAILED.
  Token ghi vào token_usage (sessionId "skillgen_<nanoid>", provider claude, projectId null).
  Có thể chạy 1–3 phút — web gọi thẳng server origin (bỏ qua Next proxy).
```

## Sound Effects

```
SfxEntry = { file, tags: string[], durationMs: number|null, description }

GET    /api/sfx                 → SfxEntry[]  (đọc assets/sound-effects/library.json, chỉ trả entry có file tồn tại)
POST   /api/sfx                 multipart: file (audio) + fields tags (csv), description
                                → SfxEntry (lưu file kebab-case ASCII, đo durationMs bằng ffprobe, cập nhật library.json)
PATCH  /api/sfx/:file           { description?, tags?, recommended? } → SfxEntry
                                — recommended=true thêm tag "hay-dung", false gỡ tag đó
DELETE /api/sfx/:file           → 204

Quy ước "đề xuất": entry có tag `hay-dung` là sound effect được đề xuất — UI hiển thị khu riêng,
AI ưu tiên dùng khi brief đặt sfxMode "recommended".
```

## Music (nhạc nền)

```
MusicEntry = { file, tags: string[], durationMs: number|null, description }
             — tags = MOOD của bài (nang-luong, chill, cam-hung, cang-thang, vui-ve...)

GET    /api/music               → MusicEntry[]  (đọc assets/music/library.json, chỉ trả entry có file tồn tại)
POST   /api/music               multipart: file (audio) + fields tags (csv), description
                                → MusicEntry (lưu file kebab-case ASCII, đo durationMs bằng ffprobe, cập nhật library.json)
PATCH  /api/music/:file         { description?, tags? } → MusicEntry
DELETE /api/music/:file         → 204
```

Brief đặt `musicMode: "auto"` → server soạn danh sách thư viện vào edit prompt, AI chọn MỘT bài
hợp mood và cấu hình auto-ducking theo skill `background-music` (khai `meta.json` → `audio.music`).
Thư viện trống → AI bỏ qua nhạc nền, KHÔNG tự tải nhạc từ mạng (bản quyền). CHỈ dùng nhạc không lời.

## Assets / Imports

```
GET  /api/assets?scope=imports|outputs            → FileInfo[]
GET  /api/assets?scope=project&projectId=<id>     → FileInfo[] (assets/ của project)
POST /api/assets  multipart: file + scope (+projectId) → FileInfo (tên file ép về ASCII kebab-case)
```

## Media (phát file trong trình duyệt)

```
GET  /media/<relPath>          — static có hỗ trợ Range (video/audio seek được).
POST /api/reveal { relPath }   → 204 — mở đúng file trong Explorer/Finder trên máy chạy server.
```
Chỉ phục vụ dưới các thư mục whitelist: `video-projects/`, `image-projects/`, `assets/`, `outputs/`, `imports/`. Chặn `..`.
`relPath` tính từ repo root, vd `/media/outputs/demo-v1.mp4`. Reveal: file không tồn tại → 404, ngoài whitelist → 403.

## Chat (Claude Agent)

```
ChatSession = { sessionId, title, projectId, status, model, effort,
                runStartedAt: string|null,   // ISO — lúc lượt chạy hiện tại BẮT ĐẦU (không reset khi auto-resume)
                runFinishedAt: string|null,  // ISO — lúc lượt chạy kết thúc hẳn; null khi đang chạy
                autoResume: boolean,         // tự chạy tiếp khi gián đoạn (mặc định true)
                goal: "final"|null,          // "final" = phiên edit project, gate hoàn thành theo video final
                createdAt, updatedAt }

GET  /api/chat/sessions               → ChatSession[]
GET  /api/chat/:sessionId/messages    → [{ role: "user"|"assistant", kind: "text"|"tool", content, createdAt }]
POST /api/chat                        { message, sessionId? } → { sessionId } (202)
                                       — chạy agent async, event đẩy qua SSE kênh `agent`
POST /api/chat/:sessionId/interrupt   → 204
PUT  /api/chat/:sessionId/auto-resume { enabled: boolean } → 204
```

**Thời gian chạy bền vững:** UI KHÔNG tự đếm từ lúc mount — elapsed = now − Date.parse(runStartedAt),
nên F5/tắt mở tab không reset. Khi xong, thời lượng = runFinishedAt − runStartedAt.
Semantics phía server: POST /api/chat (message mới) đặt runStartedAt=now, runFinishedAt=null,
resumeAttempts=0; lượt auto-resume GIỮ NGUYÊN runStartedAt; runFinishedAt chỉ ghi khi kết thúc hẳn.

**Auto-resume:** phiên kết thúc với status "error" (KHÔNG phải user bấm dừng) và autoResume bật
→ server tự chạy tiếp sau 10s với message "Tiếp tục công việc đang dở..." (tối đa 3 lần LIÊN TIẾP
KHÔNG CÓ TIẾN BỘ — goal 'final': 12 lần; đếm reset khi user gửi message mới HOẶC khi project có
tiến bộ giữa hai lượt). Tiến bộ đo bằng `progressMark` lưu trong chat_sessions: số job done của
project + số file/tổng size/mtime mới nhất trong renders/ + file output + meta.status — mark đổi
so với lượt trước → resumeAttempts reset về 0 trước khi bump. Server khởi động lại khi phiên đang
running → phiên bị đánh "interrupted"; những phiên đó nếu autoResume bật sẽ được tự chạy tiếp ~15s
sau khi server lên (cần Claude auth). User chủ động interrupt thì KHÔNG BAO GIỜ auto-resume.

**Goal 'final' (phiên edit project):** POST /api/projects/:id/edit tạo session với `goal: "final"`
(chat thường: goal null; phiên edit cũ tạo trước khi có cột goal được migration backfill về
'final' theo dấu hiệu title "Edit: " + projectId). Khi agent kết thúc "done" mà video final CHƯA
tồn tại thật (`normOutput(meta.output)` null, file không có trên đĩa, hoặc meta.status ≠ "done")
→ server KHÔNG coi là xong: giữ status "running" và tự chạy tiếp sau 10s qua hạ tầng auto-resume
(tôn trọng autoResume + interrupt, tối đa 12 lần liên tiếp không tiến bộ — có tiến bộ thì đếm lại
từ 0); hết lượt mà vẫn thiếu final → status "error" + message giải thích. Phiên goal 'final' chạy
với maxTurns 300 (phiên thường 100).

Agent chạy với cwd = repo root, nạp CLAUDE.md + `.claude/skills` của workspace, được phép Edit/Write file và chạy các lệnh whitelist trong `.claude/settings.json` không cần hỏi. Nếu thiếu API key: event `agent` kind `error` với message hướng dẫn đặt `ANTHROPIC_API_KEY` trong `.env`.

## Token Usage (biểu đồ Dashboard + cột token project)

```
GET /api/usage/summary
→ { byProject: { <projectId>: { tokens, costUsd } },
    total: { tokens, costUsd, tokensIn, tokensOut } }

GET /api/usage/timeline?days=30&scope=all|video|image
→ [{ date: "yyyy-mm-dd", tokens, tokensIn, tokensOut, costUsd,
     byProvider: { claude?: number, gemini?: number, openai?: number } }]
```

- `scope` phân loại theo projectId của dòng token_usage: tồn tại trong `image-projects/` → image,
  trong `video-projects/` → video; còn lại (chat tự do, projectId null) chỉ tính vào `all`.
  Phân loại resolve mỗi request (project có thể bị xóa — dòng token của nó rơi về nhóm "còn lại").
- `days` clamp 1–365. UI Dashboard có bộ lọc 7/30/90 ngày + loại project (Tất cả/Video/Ảnh)
  và hiển thị chi tiết token in / token out.

## Update (cập nhật hệ thống từ GitHub — badge cuối sidebar)

```
GET  /api/update/check[?force=1]
→ { current: "<short-hash>", behind, upToDate, latestMessage, checkedAt, error? }
POST /api/update/apply  → 202 { ok: true } | 409 JOB_RUNNING (đang có job render)
```

- Check `git fetch origin` + so HEAD vs origin/main, cache 10 phút (`force=1` bỏ cache);
  lỗi (offline, không có git) trả `upToDate: true` + `error` ngắn — không bao giờ 500.
- Apply spawn script `update/update.bat` (win32) / `update/update.sh` detached — script
  dừng server, `git pull --ff-only`, `npm install` rồi khởi động lại; UI poll `/api/health`
  chờ server chết → sống lại rồi tự reload.

## Ghi chú cho render Remotion

- Composition duy nhất `Assemble`, data-driven từ props (schema = meta.json, xem skill `remotion-assemble`).
- `calculateMetadata` đọc width/height/fps/tổng durationInFrames từ props.
- Asset không đọc trực tiếp từ đường dẫn tuyệt đối — server stage bằng hardlink (`fs.linkSync`, fallback copy) vào `engines/remotion/public/staging/<projectId>/` rồi props dùng `staticFile("staging/<projectId>/<file>")`.
- Nhạc nền: `audio.music = { file, volume=0.35, duckVolume=0.12, speech: [[startSec,endSec],...] } | null`
  (file copy vào `assets/` của project, server stage như sfx). Component `MusicTrack` loop cả bài,
  fade-in 0.5s đầu / fade-out 1s cuối, và duck TẤT ĐỊNH: trong speech range (đoạn CÓ thoại, giây trên
  timeline composition) volume = duckVolume, ngoài = volume, chuyển mượt bằng interpolate trong 0.4s
  quanh mỗi biên. Speech ranges do AI sinh từ transcript (merge gap < 0.6s) — xem skill `background-music`.
