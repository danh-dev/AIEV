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
  autoIllustrations: boolean,              // BẬT = AI tự tạo ảnh minh họa (Gemini) khi edit
  illustrationModel: string|null,          // model Gemini tạo ảnh (null = mặc định)
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

## Kết nối (Connections — trang /connections)

```
GET  /api/connections                    → trạng thái kết nối từng provider (connected, source, note)
PUT  /api/connections/:provider/key      { apiKey } → 200 — lưu API key vào .env
POST /api/connections/:provider/test     → { ok, message? } — gọi thử API để kiểm tra key
```

## Ảnh minh họa AI (POST /api/illustrations)

```
POST /api/illustrations
  { projectId, prompt, name?, aspect?, model?, styleId?, description? }
  → 201 { file, relPath, promptUsed }
```
Tạo ảnh minh họa bằng Gemini và lưu thẳng vào `video-projects/<projectId>/assets/`.
Thiếu `styleId` → server tự lấy `brief.styleId` của project (rồi mới tới style default) —
ảnh luôn đồng bộ Style Design. `promptUsed` = prompt cuối đã trộn style.

Chi tiết kỹ thuật (đã verify 2026-07-29):
- Claude models cho edit/chat (options.model của Agent SDK): "claude-fable-5" (mặc định),
  "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5". SDK cũng nhận options.effort
  ("low"|"medium"|"high"|"xhigh") — expose thành "mode" trên UI: Nhanh(low)/Chuẩn(medium)/Sâu(high).
  chat_sessions thêm cột model TEXT, effort TEXT.
- Gemini tạo ảnh: POST https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-image:generateContent
  header x-goog-api-key; body { contents:[{parts:[{text: prompt}]}], generationConfig:
  { responseModalities:["TEXT","IMAGE"], imageConfig:{ aspectRatio:"9:16"|..., imageSize:"1K"|"2K" } } };
  ảnh trả về candidates[0].content.parts[].inlineData.data (base64). Không có free tier ảnh (~$0.05-0.07/ảnh 1K).

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

GET  /api/render-settings       → { queueConcurrency, ... }   (cấu hình render — tab Cấu hình)
PUT  /api/render-settings       partial → 200 (queueConcurrency clamp 1–4)
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

## Assets / Imports

```
GET  /api/assets?scope=imports|outputs            → FileInfo[]
GET  /api/assets?scope=project&projectId=<id>     → FileInfo[] (assets/ của project)
POST /api/assets  multipart: file + scope (+projectId) → FileInfo (tên file ép về ASCII kebab-case)
```

## Media (phát file trong trình duyệt)

```
GET /media/<relPath>   — static có hỗ trợ Range (video/audio seek được).
```
Chỉ phục vụ dưới các thư mục whitelist: `video-projects/`, `assets/`, `outputs/`, `imports/`. Chặn `..`.
`relPath` tính từ repo root, vd `/media/outputs/demo-v1.mp4`.

## Chat (Claude Agent)

```
ChatSession = { sessionId, title, projectId, status, model, effort,
                runStartedAt: string|null,   // ISO — lúc lượt chạy hiện tại BẮT ĐẦU (không reset khi auto-resume)
                runFinishedAt: string|null,  // ISO — lúc lượt chạy kết thúc hẳn; null khi đang chạy
                autoResume: boolean,         // tự chạy tiếp khi gián đoạn (mặc định true)
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
→ server tự chạy tiếp sau 10s với message "Tiếp tục công việc đang dở..." (tối đa 3 lần liên tiếp,
đếm reset khi user gửi message mới). Server khởi động lại khi phiên đang running → phiên bị đánh
"interrupted"; những phiên đó nếu autoResume bật sẽ được tự chạy tiếp ~15s sau khi server lên
(cần Claude auth). User chủ động interrupt thì KHÔNG BAO GIỜ auto-resume.

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

## Ghi chú cho render Remotion

- Composition duy nhất `Assemble`, data-driven từ props (schema = meta.json, xem skill `remotion-assemble`).
- `calculateMetadata` đọc width/height/fps/tổng durationInFrames từ props.
- Asset không đọc trực tiếp từ đường dẫn tuyệt đối — server stage bằng hardlink (`fs.linkSync`, fallback copy) vào `engines/remotion/public/staging/<projectId>/` rồi props dùng `staticFile("staging/<projectId>/<file>")`.
