---
name: noti-tiktok-full-text
description: Dựng video explainer dọc TikTok tiếng Việt kiểu "MỔ XẺ PAPER AI" bằng HyperFrames (HTML/CSS/GSAP → MP4), style Noti.vn. N scene chữ + scene trang PDF paper, mọi chữ là HTML element thật (reveal/count-up/bôi đỏ), caption động, stat callout, bảng so sánh, pull-quote. Tự chọn sound effect theo nội dung + timestamp từ thư viện `assets/sound-effects/` (tag `hay-dung`) và ghép vào video. Tích hợp sẵn fix chữ tiếng Việt không thiếu dấu. Dùng khi user đưa transcript + ảnh trang paper + số liệu và muốn video mổ xẻ/explainer paper AI.
---

# TikTok Full-Text — explainer "MỔ XẺ PAPER AI" (Noti.vn)

## ⚖️ STYLE DESIGN — LUẬT ƯU TIÊN (đọc trước tiên)

Nếu edit prompt có mục **"STYLE DESIGN (BẮT BUỘC TUÂN THỦ 100%)"**: bảng màu, font, tone
trong mục đó **THAY THẾ HOÀN TOÀN** mọi quy định màu/font/branding trong skill này
(kể cả "dark fintech xanh", hex GĐT, gradient mặc định...). Chỉ giữ lại: kỹ thuật animation,
layout, nhịp cắt, quy trình render, các fix lỗi. Ảnh minh họa tạo qua /api/illustrations
phải truyền đúng styleId trong prompt. KHÔNG có mục Style Design → dùng branding mặc định của skill.

Dựng video explainer dọc tiếng Việt bằng HyperFrames (HTML/CSS/JS + GSAP → MP4).
Mọi chữ là **HTML element thật** để animate + sắc nét. Có scene chữ và scene trang PDF paper.

> ⚡ Đọc hết file trước khi dựng. Mục ⚠️ là lỗi đã gặp & đã fix — KHÔNG lặp lại.
> Tham khảo cấu trúc project đã chạy: `video-projects/sapo/`.

---

## ROLE
Video editor HyperFrames. Compose HTML/CSS/JS, animate GSAP, render MP4 dọc. Thể loại: "MỔ XẺ PAPER AI" — explainer dọc, style Noti.vn.

## OUTPUT SPEC
- 9:16 — **1080×1920**, **30fps**.
- N scene (mặc định 12). Mỗi scene = 1 sub-composition HTML (`<template>` + `data-composition-src`), khai báo `data-start`/`data-duration`/`data-track-index`.
- Safe zone: text quan trọng + caption trong khung giữa 1080×1400, chừa **15% dưới (~288px)** + góc phải (~130px). Caption đặt `bottom: ~372px`.

## ⚠️ FONT TIẾNG VIỆT — KHÔNG ĐƯỢC LỖI (tofu / mất dấu)
1. Font "Be Vietnam Pro" hoặc "Inter" subset vietnamese, `display=block`. Nhúng qua Google Fonts — renderer HyperFrames **tự fetch + cache + inject @font-face tất định**:
   ```html
   <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800;900&display=block&subset=vietnamese" rel="stylesheet">
   ```
2. `<meta charset="UTF-8">`, `<html lang="vi">`, `font-display: block`.
3. fallback chain kết bằng font có dấu: `font-family: "Be Vietnam Pro","Inter",sans-serif;` — KHÔNG fallback `sans-serif` trống.
4. Test string render đúng 100%: `Vấn đề: càng siết càng tệ — ƯỢ Ễ Ỹ ặ ậ ề thiết kế ngữ cảnh`. Thấy ô vuông/thiếu dấu → sửa font trước.

### ⚠️⚠️ FIX BẮT BUỘC — CHỮ GRADIENT BỊ CẮT DẤU
Chữ `background-clip:text; color:transparent` (heading gradient xanh) **CẮT CỤT dấu chồng cao** (Ẫ Ể Ấ Ữ Ổ Ợ…) vì dấu nhô khỏi hộp tô. `padding-top: 0.14em` KHÔNG đủ — phải **0.5em**. Áp cho MỌI dòng chữ gradient:
```css
.heading-grad {
  background: linear-gradient(100deg,#0061ff,#00c2ff);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  line-height: 1.0; padding-top: 0.5em; padding-bottom: 0.14em;
}
```
Chữ trắng/màu thường (không background-clip) KHÔNG bị — chỉ fix chữ gradient. Khi verify: zoom 3× các chữ có dấu chồng để kiểm.

### ⚠️ Caption / nhiều dòng cùng vị trí — KHÔNG được CHỒNG
Caption (và mọi text đặt cùng 1 chỗ) khi video nói **liên tục không nghỉ**: dòng cũ chưa fade-out thì dòng mới đã fade-in → đè nhau, chữ rối. Fix: `PRE_ROLL = 0`, dòng cũ tắt hẳn đúng lúc dòng mới hiện:
```js
const inAts = SEGMENTS.map(s => Math.max(s.words[0].start, 0));
// fadeInAt = inAts[i];
// fadeOutAt = (i<n-1) ? Math.max(segEnd+0.02, inAts[i+1] - FADE_OUT) : segEnd + POST_HOLD;
```
Verify thêm frame ngay RANH GIỚI giữa 2 dòng caption.

## ⚠️ CHỮ PHẢI LÀ HTML ELEMENT THẬT
- TẤT CẢ chữ tiếng Việt (heading, số liệu, caption, label, quote) là `<h1>/<p>/<span>` — KHÔNG bake chữ vào ảnh, KHÔNG ảnh PNG có chữ sẵn.
- Ảnh chỉ dùng làm background: **trang PDF paper gốc** (không có chữ Việt overlay sẵn).
- Lý do: cần animate (reveal, count-up, đổi màu từng từ) + nét chữ sắc khi render.

### ⚠️ Sub-composition render BIỆT LẬP
Mỗi sub-comp (`data-composition-src`) render ngữ cảnh riêng, KHÔNG kế thừa master:
- Mỗi sub-comp tự có `<script src=".../gsap@3.14.2/dist/gsap.min.js">` riêng.
- Mỗi sub-comp có text tự nhúng `<link>` font Google riêng (trong `<template>`).
- KHÔNG dùng CSS var `:root` của master trong sub-comp — dùng giá trị literal (hex/gradient viết thẳng).

---

## DESIGN SYSTEM (Noti.vn / GĐT)
**Nền:**
- Scene chữ: dark `#0A0E1A → #0F1629` (radial/linear gradient), 1–2 blob xanh (`#0061ff`,`#00c2ff`) blur 120px trôi parallax chậm, grain noise opacity ~0.04, vignette.
- Scene paper: trang PDF trên nền sáng, bo 16px + bóng mềm; viền bằng box-shadow (KHÔNG border cứng).

**Màu:**
- Chữ chính trắng `#F5F7FA`. Chữ phụ/đã đọc xám `#6E7787`.
- Brand accent (keyword tiêu đề): gradient `#0061ff → #00c2ff` qua `background-clip:text` (nhớ fix padding 0.5em).
- NHẤN: đỏ cam `#FF4D2E` cho số liệu xấu, từ khoá nóng trong caption, mũi tên.
- BÔI: highlight nền đỏ nhạt `rgba(255,77,46,0.18)` bo 6px (thay highlighter vàng), animate quét trái→phải 0.6s bằng `clip-path`.
- Glass card: `rgba(255,255,255,0.06)`, `backdrop-filter: blur(20px)`, bo 16–20px, viền box-shadow:
  `inset 0 1px 0 rgba(255,255,255,0.18), inset 0 0 0 1px rgba(255,255,255,0.05), 0 18px 50px rgba(0,0,0,0.45)`.

**Chữ:** heading 800–900 (keyword gradient xanh/trắng); số liệu 900, 140–200px (số xấu đỏ cam); caption 700 + text-shadow đen nhẹ.

## COMPONENT (tái dùng)
1. **Page counter** góc trái trên "01 / 12", xám, letter-spacing rộng.
2. **KHÔNG watermark/branding** — video KHÔNG gắn "@noti.vn", logo hay chữ TikTok. Để trống góc phải dưới.
3. **Caption động** dưới-giữa, cụm 3–6 từ theo timestamp, 1 keyword tô đỏ cam, fade+slide-up 0.25s (tuân luật KHÔNG chồng dòng ở trên).
4. **Stat callout** "95.8% → 58.3%": số to 900, số xấu đỏ cam, mũi tên → đỏ cam, count-up khi xuất hiện.
5. **List item**: "01" cực to + tiêu đề + sub-label xám, vạch dọc gradient xanh bên trái.
6. **Bảng so sánh**: row glass bo 14px, label trái xám + value phải trắng to, row quan trọng bôi nền đỏ nhạt; stagger 0.1s.
7. **Pull-quote**: dấu " to mờ trên, câu trích in đậm căn giữa, fade-in từng dòng, chữ chốt bôi đỏ nhạt.
8. **Pill badge**: "ARXIV xxxx.xxxxx" nền glass bo tròn, chữ trắng uppercase nhỏ.
9. **Outro**: câu hỏi + nút "Drop ý kiến vào comment" (pill glass + icon SVG), vài emoji trôi.

## PAPER SCENE
- Hiện trang PDF thật (user cung cấp ảnh từng trang), Ken Burns zoom/pan chậm 6–8s. ⚠️ Bọc `<img>` trong `<div>` và animate WRAPPER (đừng animate trực tiếp img/video về width/top/left).
- Heading tiếng Việt overlay + pill ARXIV — đều là HTML element.
- Bôi đỏ nhạt 1–2 câu chốt: HTML highlight box phủ lên, animate `clip-path` quét ngang.

## HIỆU ỨNG (GSAP)
- Text reveal: y 40→0 + opacity 0→1, stagger 0.06s, ease `power3.out`.
- Số liệu: count-up (tween 1 object + onUpdate) + scale-pop 0.9→1.03→1.
- Highlight đỏ nhạt: `clip-path: inset(0 100% 0 0)` → `inset(0 0% 0 0)`.
- Chuyển scene (blur-dissolve — đã kiểm chứng, xem ⚠️ TRANSITION bên dưới); scene paper zoom-fade.
- ⚠️ KHÔNG `setTimeout`/`Date.now()`/`Math.random()` — chỉ GSAP timeline (tất định). Mọi animation khớp FPS.

## ⚠️ TRANSITION CHUYỂN CẢNH (blur-dissolve — pattern đã chạy)
Bố cục chuẩn: nền (`ambient-bg`) là 1 sub-comp **chạy liên tục xuyên suốt** ở track riêng phía sau; mỗi scene chữ là **layer trong suốt** (không nền riêng). Vì nền liên tục nên transition **chỉ animate phần chữ**, KHÔNG cần crossfade nền.
1. **Mỗi scene tự lo entrance + exit trong timeline của chính nó**. KHÔNG overlap clip, KHÔNG đổi track, KHÔNG animate opacity wrapper ở master → giữ nguyên đồng bộ caption/SFX.
2. **Exit (cuối mỗi scene, ~0.3s trước khi cắt)** = fade + trượt lên + **blur** cùng 1 tween, ease `power2.in`:
   ```js
   // áp cho wrapper nội dung + page counter của scene (TRỪ scene outro cuối — không exit)
   tl.to([sel(".sX-wrap"), sel(".counter")],
     { opacity: 0, y: -16, filter: "blur(10px)", duration: 0.32, ease: "power2.in" }, EXIT_AT);
   ```
   `EXIT_AT` đặt sao cho `EXIT_AT + 0.32 ≈ data-duration` của scene. Vẫn pad `tl.set({}, {}, DUR)` cuối (Law 11).
3. **Entrance (đầu scene sau)** = fade + stagger reveal từng dòng (đã có sẵn trong reveal chuẩn) → mắt thấy "chữ cũ tan-nhòe → chữ mới hiện vào".
4. ⚠️ Đây là **dissolve qua nền chung**, KHÔNG phải crossfade chồng 2 scene. Muốn crossfade chồng thật (chữ scene mới ló ra khi chữ cũ chưa tan) mới cần tách track xen kẽ (vd 2↔14) + overlap thời gian ~0.35s — nặng hơn, chỉ làm khi user yêu cầu.
5. Caption nằm ở **track riêng** → KHÔNG dính blur của scene → phụ đề vẫn sắc nét xuyên suốt transition (đúng ý đồ, đừng "sửa").
6. Độ mạnh: `blur(8–12px)`. Verify: trích frame **giữa động tác exit** bằng seek chính xác `ffmpeg -i in.mp4 -ss <t> -frames:v 1` (đặt `-ss` SAU `-i`; `-ss` trước `-i` seek nhanh về keyframe → bắt hụt, tưởng nhầm là blur không chạy).

---

## SOUND EFFECT (SFX) — tự chọn & ghép theo timestamp
Thêm SFX để nhấn nhịp video (số liệu, reveal, chuyển scene, punchline). Lấy từ thư viện **đã tuyển sẵn**:
`assets/sound-effects/` — từ trong project: `../../assets/sound-effects/`. Bộ đề xuất = các entry có tag `hay-dung` trong `assets/sound-effects/library.json`.
Tham khảo cách ghép thực tế đã chạy: `video-projects/mcp-tiktok-2/index.html` (block `<audio id="sfx-*">`).

### Quy trình tự chọn SFX (theo nội dung + timestamp)
1. Đọc transcript + caption timestamp + storyboard → tìm "điểm nhấn" cần âm thanh: số liệu/stat count-up, reveal keyword, mở scene paper, bôi đỏ câu chốt, chuyển scene mạnh, outro CTA, punchline/câu sốc.
2. Map mỗi điểm nhấn → 1 SFX hợp ngữ nghĩa (bảng dưới). **`data-start` = đúng MỐC sự kiện** (số bắt đầu count-up / chữ bắt đầu reveal / frame cắt scene), KHÔNG phải đầu scene chung chung.
3. ⚠️ Tiết chế: ~1 SFX mỗi 3–6s, KHÔNG mỗi dòng chữ một tiếng (loãng + mệt tai). Video ~60s nên ~6–12 SFX. Đa dạng file, tránh lặp 1 tiếng quá dày.
4. **Trình user duyệt bảng SFX** (mốc giây | sự kiện | file | volume) cùng storyboard trước khi ghép.

### Bảng map ngữ nghĩa → file (trong `assets/sound-effects/`)
| Ngữ cảnh nội dung | File |
|---|---|
| số liệu tốt / điểm / reveal tích cực / tick đúng | `ding.mp3`, `ting.wav` |
| tiền / lợi nhuận / chi phí / "tỷ", "doanh thu", "$" | `ka-ching.mp3`, `money.mp3`, `buy.mp3` |
| chữ/element pop xuất hiện, transition nhẹ | `pop.mp3` |
| chụp/ảnh/screenshot / scene paper PDF xuất hiện | `camera-snap.wav`, `camera-flash-1.wav` |
| số liệu xấu / sai / cảnh báo / "tệ", "giảm", "lỗi" | `error.mp3` |
| reveal sốc / wow / bất ngờ | `anime-wow-1.mp3` |
| gõ phím / code / nhập liệu | `mechanical-keyboard.mp3`, `iphone-typing.mp3` |
| click UI / chọn / nút bấm | `click-button.mp3`, `mouse-click.mp3` |
| punchline hài / mỉa mai / fail nhẹ | `dry-fart.mp3`, `fart-echo.mp3`, `duck-toy.mp3`, `jontron-what.mp3` |
| "ăn" / nuốt / gộp / consume | `chomp.mp3` |

(.wav và .mp3 đều dùng được — ưu tiên đúng ngữ nghĩa hơn định dạng.)

### Kỹ thuật ghép (HyperFrames)
1. **Copy** file đã chọn vào `assets/sfx/` của project (giữ project portable — KHÔNG để `src` trỏ ra ngoài thư mục project).
2. Mỗi SFX = 1 `<audio>` riêng trong root composition, cạnh `<audio>` narration. ⚠️ KHÔNG `class="clip"` trên `<audio>` (Render Contract — phá audio):
   ```html
   <audio id="sfx-stat1" data-start="12.46" data-duration="2.0" data-track-index="6" data-volume="0.5" src="assets/sfx/ka-ching.mp3"></audio>
   ```
3. ⚠️ Mỗi SFX một `data-track-index` RIÊNG (vd 4,5,6,…) — cùng track KHÔNG chồng thời gian. Narration ở track 0; SFX dùng track **từ 4 trở lên** (tránh đè track của visual scenes).
4. ⚠️ Volume: SFX `data-volume` **0.4–0.6** (dưới narration = 1.0) để không át lời. SFX comedic/punch có thể 0.55–0.65.
5. `data-duration` đủ dài cho SFX kêu hết (1–3s); ngắn quá bị cắt cụt. Không cần khớp độ dài scene.

---

## ⚠️ MÔI TRƯỜNG (Windows) + TRANSCRIPTION
- FFmpeg cài qua `winget install Gyan.FFmpeg`. PATH chỉ áp shell MỚI → khi gọi `npx hyperframes` phải prepend bin vào `$env:Path` inline.
- `npm install` ở repo root; `npx hyperframes browser ensure`.
- ⚠️ `npx hyperframes transcribe` cần `whisper-cpp` ngoài + model `.en` chỉ tiếng Anh → KHÔNG dùng cho tiếng Việt.
- Transcribe tiếng Việt: **faster-whisper** `large-v3`, `language="vi"`, `word_timestamps=True` (Python: `sys.stdout.reconfigure(encoding="utf-8")`). Ưu tiên `device="cuda", compute_type="float16"` (GTX 1660: nhanh gấp đôi, giải phóng CPU), try/except rơi về `device="cpu", compute_type="int8"`. Tách audio: `ffmpeg -i in.mp4 -vn -ac 1 -ar 16000 audio.wav`. Sửa lỗi Whisper nghe nhầm tên riêng (vd Anthopix→Anthropic, Cloudy→Claude).

## CẮT HI-LIGHT (nếu video gốc dài)
ffmpeg `filter_complex` trim+concat nhiều đoạn ra face.mp4 re-encode; remap word-timestamp (new = orig − shift cộng dồn); sinh caption nhóm theo dấu câu / khoảng nghỉ giọng (gap > ~0.38s) / tối đa 7 từ.

## RENDER CONTRACT (must)
- Root: `id`, `data-composition-id`, `data-start="0"`, `data-width`, `data-height`.
- Element có thời gian cần `class="clip"` (TRỪ `<video>`/`<audio>`), + `data-start`/`data-duration`/`data-track-index`. Cùng track KHÔNG chồng thời gian (cẩn thận lỗi làm tròn số thực — chừa biên ~0.04s).
- `<video>` phải `muted`; audio ở `<audio>` riêng. KHÔNG animate width/height/top/left trên `<video>`/`<img>` — bọc div, animate wrapper (scale transform OK).
- Mỗi composition đăng ký đúng 1 timeline `paused` vào `window.__timelines["<data-composition-id>"]` (key khớp chính xác). Duration comp = `tl.duration()`. **Pad đủ slot**: `tl.set({}, {}, DUR)` cuối mỗi timeline (Law 11 — ngắn hơn data-duration → frame đen).

## QUY TRÌNH
1. User đưa: transcript tiếng Việt + timestamp + ảnh các trang paper + số liệu cần nhấn.
2. Chia N scene, map component, đặt data-start/data-duration. **Trình user duyệt storyboard** (bảng scene | thời lượng | component | nội dung).
3. **Chọn SFX**: quét điểm nhấn theo timestamp → map file từ `assets/sound-effects/` (ưu tiên tag `hay-dung` trong `library.json`) → copy vào `assets/sfx/` → **trình user duyệt bảng SFX** (mốc | sự kiện | file | volume).
4. Verify font (test string, screenshot 1080×1920) + xác nhận TẤT CẢ chữ là HTML element.
5. `npx hyperframes lint` (0 error; cảnh báo self-selector/google-fonts/font-face là benign).
6. Render thử 1 scene chữ + 1 scene paper (draft) → trích frame + **zoom 3× kiểm dấu** + kiểm ranh giới caption + timing → **nghe lại check SFX khớp mốc & không át lời** → sửa → render full draft.
7. User duyệt → render final `--quality standard`.

## LỆNH (trong `video-projects/<project>/`)
```powershell
$bin="...\ffmpeg-...\bin"; $env:Path="$bin;$env:Path"
npx hyperframes lint
npx hyperframes compositions
npx hyperframes render --quality draft    --output renders/draft.mp4
npx hyperframes render --quality standard --output renders/final.mp4
# verify dấu: ffmpeg -ss <t> -i renders/draft.mp4 -frames:v 1 -vf "crop=700:340:60:260,scale=1400:680:flags=neighbor" out.png → Read out.png
# copy SFX vào project: cp ../../assets/sound-effects/<file> assets/sfx/
# verify SFX: ffmpeg -ss <t> -i renders/draft.mp4 -t 4 -vn out.wav → nghe SFX khớp mốc & không át narration
```

## OUTPUT cho user
File `renders/final.mp4` (1080×1920, 30fps) + bảng timeline: scene | thời lượng | component | nội dung + **bảng SFX: mốc | sự kiện | file | volume**. Dọn file draft/test tạm sau khi xong.
