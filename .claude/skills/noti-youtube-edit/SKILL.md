---
name: noti-youtube-edit
description: Dựng video YouTube ngang 16:9 (1920×1080) tiếng Việt bằng HyperFrames (HTML/CSS/GSAP → MP4), branding Noti.vn/GĐT giữ nguyên từ noti-tiktok-vn. Hỗ trợ 2 mode — A) talking-head + motion graphics (mặt người full-frame, camera-move sang PiP, caption karaoke) và B) explainer full-text (scene chữ + slide/biểu đồ, không mặt người). Có sẵn kỹ thuật "camera di chuyển" (animate wrapper, không animate video), fix chữ tiếng Việt không thiếu dấu, và tự chọn sound effect theo nội dung + timestamp từ thư viện `assets/sound-effects/` (tag `hay-dung`) rồi ghép vào video (bắt buộc mỗi video). Dùng khi user đưa clip/transcript tiếng Việt và muốn video YouTube ngang giữ branding dark fintech xanh.
---

# YouTube Edit 16:9 — chuẩn Noti.vn / GĐT

## ⚖️ STYLE DESIGN — LUẬT ƯU TIÊN (đọc trước tiên)

Nếu edit prompt có mục **"STYLE DESIGN (BẮT BUỘC TUÂN THỦ 100%)"**: bảng màu, font, tone
trong mục đó **THAY THẾ HOÀN TOÀN** mọi quy định màu/font/branding trong skill này
(kể cả "dark fintech xanh", hex GĐT, gradient mặc định...). Chỉ giữ lại: kỹ thuật animation,
layout, nhịp cắt, quy trình render, các fix lỗi. Ảnh minh họa tạo qua /api/illustrations
phải truyền đúng styleId trong prompt. KHÔNG có mục Style Design → dùng branding mặc định của skill.

Skill này dựng video YouTube **ngang 16:9** bằng HyperFrames (HTML/CSS/JS + GSAP → MP4).
Kiến trúc face-cam + overlay beats + camera-move/PiP; **branding** kế thừa từ `noti-tiktok-vn` (dark fintech xanh Noti.vn). Khác `noti-tiktok-vn` ở chỗ **khung 16:9 ngang** thay vì 9:16 dọc.

**Project mẫu tham khảo (đã chạy):**
- Cấu trúc project + branding Noti.vn (màu/font/glass, overlays): `video-projects/sapo/`
- SFX ghép theo timestamp: `video-projects/mcp-tiktok-2/index.html`

> ⚡ Đọc hết file trước khi dựng. Mục ⚠️ là lỗi đã gặp & đã fix — KHÔNG lặp lại.

---

## ROLE
Video editor dùng HyperFrames. Compose HTML/CSS/JS, animate GSAP, render MP4 **ngang 1920×1080**. Branding Noti.vn.

## HAI MODE (chọn theo input của user)
- **Mode A — Talking-head + motion graphics** (mặc định nếu user đưa 1 clip người nói): video mặt người chạy nền full-frame, overlay chữ động + caption karaoke đè lên, dùng **camera-move** thu mặt sang PiP khi graphics chiếm sân khấu. (Style `noti-tiktok-vn`, khung ngang.)
- **Mode B — Explainer full-text** (nếu user đưa transcript + slide/ảnh/số liệu, KHÔNG có mặt người): N scene chữ + scene slide/biểu đồ, mọi chữ là HTML element thật. (≈ logic `noti-tiktok-full-text` nhưng layout ngang.)

Hỏi user nếu không rõ. Hai mode dùng CHUNG: branding, fix font, transcription, **SFX (bắt buộc)**, render contract, môi trường.

---

## OUTPUT SPEC (16:9)
- **1920×1080**, **30fps** (60fps nếu rất nhiều kinetic typography / camera-move nhanh).
- ⚠️ Safe zone YouTube (KHÁC TikTok — không có cột nút bên phải):
  - **Title-safe**: chữ quan trọng trong khung giữa **1728×972** (chừa ~5% mỗi cạnh).
  - **Đáy ~90px**: thanh tua (progress bar) + timestamp hiện khi hover → KHÔNG đặt chữ/caption quan trọng dưới `y > 990`. Caption đặt `bottom: ~110–150px` (lower-third), KHÔNG sát đáy.
  - **Góc phải trên**: icon "cards" YouTube → chừa ~120×120px nếu có.
  - **End screen (20s cuối)**: nếu định dùng end screen YouTube (subscribe/video gợi ý), chừa các ô ~ góc phải + giữa-phải trong 20s cuối. Nếu KHÔNG dùng end screen native thì bỏ qua.
- Khai thác chiều ngang: **lower-third**, **side panel**, **split-screen**, **PiP dock góc** — landscape rộng nên ưu tiên bố cục ngang thay vì stack dọc.
- Mỗi scene = 1 sub-composition HTML (`<template>` + `data-composition-src`), timing qua `data-start`/`data-duration`/`data-track-index`.

---

## ⚙️ KIẾN TRÚC (master + beats)
Master `index.html` (1920×1080) + N sub-composition ("beat"), tất cả **đè lên 1 lớp nền** (Mode A: video mặt người ở track 0; Mode B: nền dark gradient). Các beat overlay dùng **track-index riêng** (vd 4) và nối tiếp theo thời gian.

Khung sườn master:
```html
<div id="root" data-composition-id="yt-edit" data-start="0"
     data-duration="<TỔNG>" data-width="1920" data-height="1080">
  <!-- Mode A: nền mặt người -->
  <div id="face-wrapper">
    <video id="face-video" data-start="0" data-duration="<TỔNG>" data-track-index="0"
           src="assets/face.mp4" muted playsinline></video>
  </div>
  <audio id="face-audio" data-start="0" data-duration="<TỔNG>" data-track-index="2"
         data-volume="1" src="assets/face.mp4"></audio>

  <!-- beats: mỗi scene 1 file, cùng track 4, nối tiếp -->
  <div id="beat-1" class="scene-layer" data-composition-id="b1"
       data-composition-src="compositions/01-hook.html"
       data-start="0" data-duration="4.0" data-track-index="4"
       data-width="1920" data-height="1080"></div>
  <!-- ... -->
</div>
```

---

## 🎥 CAMERA DI CHUYỂN — kỹ thuật cốt lõi (Mode A)
"Camera move" KHÔNG phải camera thật — là **GSAP animate cái `<div>` bọc video** (`#face-wrapper`).

```js
const FULL = { x: 0, y: 0, width: 1920, height: 1080 };       // full-frame
const PIP  = { x: 1380, y: 750, width: 480, height: 270 };    // 16:9 dock góc phải-dưới
// hoặc side-panel: const SIDE = { x: 1180, y: 0, width: 740, height: 1080 };

gsap.set("#face-wrapper", FULL);
mainTl.to("#face-wrapper",
  { ...PIP, duration: 0.6, ease: "power3.inOut",
    onStart: () => document.getElementById("face-wrapper").classList.add("pip") },
  12.54);   // bắt đầu SỚM ~0.3s so với mốc lời nói → cú thu đang-bay đúng lúc
```

⚠️ **3 luật bắt buộc:**
1. **Animate `<div>` wrapper, KHÔNG animate `<video>`.** Animate width/height/top/left trực tiếp lên `<video>` → **đóng băng frame** (Render Contract). Wrapper là div thường nên đụng thoải mái; scale transform trên video thì OK.
2. CSS: wrapper `overflow:hidden; transform-origin:0 0`; video bên trong `height:100%; width:auto; left:50%; transform:translateX(-50%)`. Với source 16:9 vào khung 16:9 → scale sạch không méo. (Nếu source dọc/vuông, `overflow:hidden` tự crop về 16:9.)
3. Class `.pip` chỉ bật khi thu nhỏ để thêm **bo góc + đổ bóng + glow xanh Noti** (KHÔNG ảnh hưởng full-frame):
```css
#face-wrapper { position:absolute; top:0; left:0; width:1920px; height:1080px;
  overflow:hidden; transform-origin:0 0; z-index:0; background:#000; }
#face-video  { position:absolute; top:0; left:50%; height:100%; width:auto;
  transform:translateX(-50%); display:block; filter:contrast(1.05) saturate(1.08); }
#face-wrapper.pip { z-index:10; border-radius:24px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.55),
              0 0 0 1px rgba(255,255,255,0.06) inset,
              0 0 50px rgba(0,140,255,0.30); }   /* glow XANH Noti, không cam */
```
- **z-index toggle**: beat 1..n để overlay đè lên mặt (z-index face = 0); khi vào PiP mới nâng `z-index:10` để cửa sổ mặt nổi lên trên scene.
- **Push-in nhẹ** (tạo năng lượng) = scale wrapper 1.0→1.03 cực chậm; vẫn an toàn vì là transform trên div.

---

## 🔀 CHUYỂN CẢNH (GSAP, từ noti-tiktok-vn)
KHÔNG cut cứng. Mỗi beat có **GSAP timeline riêng** (`paused`, đăng ký `window.__timelines["<id>"]`). Chữ vào/ra bằng tween:
- **Entrance**: `y:40→0, opacity:0→1, scale:0.92→1, filter:blur(12px)→0`, stagger 0.06–0.12, ease `power3.out`.
- **Exit + hard-kill** (chống stagger rò lại): `to(..., {opacity:0, y:-30, blur(14px)})` rồi `tl.set(..., {opacity:0, visibility:"hidden"})`.
- **Crossfade nền**: `tl.from(.bg, {opacity:0, duration:0.5})`.
- **Whip / scale-zoom** ở nhịp mạnh; **blur+fade** ở nhịp êm. Có thể dùng block shader registry (`whip-pan`, `cinematic-zoom`) nếu cần.
- **Đồng bộ lời nói**: mọi `data-start` neo vào timestamp Whisper của từ khóa → chữ "land" đúng chữ đang nói.
- ⚠️ KHÔNG `setTimeout`/`Date.now()`/`Math.random()` — chỉ GSAP timeline. Random tất định bằng hàm băm `sin/cos` theo index.

---

## 🎨 STYLE (Noti.vn / GĐT) — GIỮ NGUYÊN branding từ noti-tiktok-vn
- Nền dark `#0A0E1A → #0F1629` (gradient) + grain nhẹ + 1–2 blob xanh (`#0061ff`,`#00c2ff`) blur 120px trôi parallax chậm + vignette.
- Accent gradient text tiêu đề: `linear-gradient(100deg, #0061ff, #00c2ff)` qua `background-clip:text`.
- Glassmorphism (viền bằng box-shadow, KHÔNG border 1px cứng):
  `background: rgba(255,255,255,0.06); backdrop-filter: blur(20px); border-radius: 20px;`
  `box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), inset 0 0 0 1px rgba(255,255,255,0.05), 0 18px 50px rgba(0,0,0,0.45);`
- Chữ: tiêu đề weight 800, phụ đề 600, body 400. Letter-spacing `-0.03em` cho heading lớn.
- Glow chữ nhấn: `filter: drop-shadow(0 0 26px rgba(0,140,255,0.4))` (drop-shadow cho gradient text — KHÔNG text-shadow vì chữ trong suốt).
- Caption karaoke (Mode A): cụm 4–7 từ, từ đang nói highlight `#19c8ff` + scale 1.13. Đặt lower-third (`bottom: ~120px`), KHÔNG sát đáy.
- ⚠️ Glow/accent dùng **XANH Noti** (`#0061ff`/`#00c2ff`/`#19c8ff`), KHÔNG dùng cam của Claude — đây là điểm sửa khi mượn code overlay từ project khác.
- KHÔNG watermark "@noti.vn"/logo trừ khi user yêu cầu.

---

## ⚠️ FONT TIẾNG VIỆT — BẮT BUỘC (giống noti-tiktok-vn)
1. Font full glyph VN: **"Be Vietnam Pro"** (ưu tiên) hoặc "Inter" subset vietnamese. KHÔNG để fallback system font headless Chromium (thiếu dấu → tofu).
2. Nhúng Google Fonts subset vietnamese, `display=block` (renderer HyperFrames tự fetch + cache + inject @font-face tất định):
   ```html
   <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700;800&display=block&subset=vietnamese" rel="stylesheet">
   ```
3. `<meta charset="UTF-8">` + `<html lang="vi">` + `font-display: block`.
4. fallback chain kết bằng font có dấu: `font-family: "Be Vietnam Pro", "Inter", sans-serif;`
5. Test string render đủ dấu 100%: `Ưu đãi độc quyền — giảm giá sốc! Đừng để vụt mất. ƯỢ Ễ Ỹ ặ ậ ề`

### ⚠️⚠️ FIX QUAN TRỌNG — MẤT DẤU TRÊN CHỮ GRADIENT
Chữ `background-clip:text; color:transparent` **CẮT CỤT dấu chồng cao** (Ẫ Ể Ấ Ữ Ổ Ợ…) vì dấu nhô khỏi hộp tô gradient. `padding-top: 0.14em` KHÔNG đủ — phải **0.5em**. Áp cho MỌI dòng tiêu đề gradient:
```css
.heading-grad {
  background: linear-gradient(100deg,#0061ff,#00c2ff);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  line-height: 1.0; padding-top: 0.5em; padding-bottom: 0.14em;
}
```
Chữ trắng/màu thường (không background-clip) KHÔNG bị — chỉ fix chữ gradient. Khi verify: zoom 3× chữ có dấu chồng để kiểm.

### ⚠️ Caption / nhiều dòng cùng vị trí — KHÔNG được CHỒNG
Khi nói liên tục không nghỉ: dòng cũ chưa fade-out thì dòng mới đã fade-in → đè nhau. Fix `PRE_ROLL = 0`, dòng cũ tắt hẳn đúng lúc dòng mới hiện:
```js
const inAts = SEGMENTS.map(s => Math.max(s.words[0].start, 0));
// fadeInAt  = inAts[i];
// fadeOutAt = (i<n-1) ? Math.max(segEnd+0.02, inAts[i+1] - FADE_OUT) : segEnd + POST_HOLD;
```
Verify thêm frame ngay RANH GIỚI giữa 2 dòng caption.

### ⚠️ Sub-composition render BIỆT LẬP
Mỗi sub-comp (`data-composition-src`) render ngữ cảnh riêng, KHÔNG kế thừa master:
- Mỗi sub-comp tự có `<script src=".../gsap@3.14.2/dist/gsap.min.js">` riêng.
- Mỗi sub-comp có text tự nhúng `<link>` font Google riêng (trong `<template>`).
- KHÔNG dùng CSS var `:root` của master trong sub-comp — dùng giá trị literal (hex/gradient viết thẳng).

---

## 🧩 LAYOUT NGANG (component gợi ý cho 16:9)
Landscape rộng → ưu tiên bố cục ngang (khác stack dọc của TikTok):
- **Hook** (0–~15s): tiêu đề lớn giữa-trên + logo/pill, là chốt giữ người xem.
- **Lower-third**: tên/chức danh/nguồn ở dải dưới-trái glass, mũi tên/vạch xanh.
- **Side panel**: mặt người dock 1 bên (Mode A), nửa kia chứa chữ/biểu đồ.
- **Split-screen**: trái UI/agent activity, phải biểu đồ.
- **Stat callout**: số to 900 (số xấu có thể tô đỏ cam `#FF4D2E`), count-up + scale-pop.
- **Bảng so sánh / list item / pull-quote / pill badge**: dùng glass card.
- **Outro**: CTA "Đăng ký kênh" + câu hỏi để comment, hold 4–6s (chừa vùng end screen nếu dùng).

## ✍️ MODE B — Explainer full-text (nếu không có mặt người)
- N scene chữ + scene slide/ảnh/biểu đồ. **TẤT CẢ chữ là HTML element thật** (`<h1>/<p>/<span>`) — KHÔNG bake chữ vào ảnh. Ảnh chỉ làm background (slide/screenshot/biểu đồ).
- Ken Burns zoom/pan chậm trên ảnh: **bọc `<img>` trong `<div>`, animate WRAPPER** (đừng animate trực tiếp img về width/top/left).
- Count-up số liệu (tween 1 object + onUpdate), bôi highlight nền (quét bằng `clip-path: inset(0 100% 0 0)→inset(0 0 0 0)`).
- Page counter "01 / N" góc trái-trên, xám, letter-spacing rộng.

---

## 🔊 SOUND EFFECT (BẮT BUỘC — từ noti-tiktok-full-text)
Mọi video đều ghép SFX nhấn nhịp (số liệu, reveal, chuyển scene/camera-move, punchline, CTA). Thư viện dùng chung: `assets/sound-effects/` (từ project: `../../assets/sound-effects/`). Bộ đề xuất = các entry có tag `hay-dung` trong `assets/sound-effects/library.json`.

### Quy trình tự chọn SFX (theo nội dung + timestamp)
1. Đọc transcript + caption timestamp + storyboard → tìm "điểm nhấn" cần âm thanh: số liệu/count-up, reveal keyword, **mốc camera-move FULL→PIP**, mở scene slide/biểu đồ, bôi câu chốt, chuyển scene mạnh, outro CTA "Đăng ký kênh", punchline.
2. Map mỗi điểm nhấn → 1 SFX hợp ngữ nghĩa (bảng dưới). `data-start` = đúng MỐC sự kiện (số bắt đầu count-up / chữ bắt đầu reveal / frame cắt scene / mốc thu PiP), KHÔNG phải đầu scene chung chung.
3. ⚠️ Tiết chế: ~1 SFX mỗi 3–6s, KHÔNG mỗi dòng chữ một tiếng. Video ngang YouTube thường dài hơn → rải đều, đa dạng file, tránh lặp 1 tiếng quá dày.
4. **Trình user duyệt bảng SFX** (mốc giây | sự kiện | file | volume) cùng storyboard trước khi ghép.
- Map ngữ nghĩa → file: số liệu tốt → `ding.mp3`/`ting.wav`; tiền → `ka-ching.mp3`; pop element → `pop.mp3`; ảnh/slide → `camera-snap.wav`; số xấu → `error.mp3`; wow → `anime-wow-1.mp3`; gõ phím → `mechanical-keyboard.mp3`; click → `click-button.mp3`.
- **Copy** file đã chọn vào `assets/sfx/` (giữ project portable). Mỗi SFX = 1 `<audio>` riêng, **KHÔNG** `class="clip"`, track-index riêng **từ 4 trở lên** (narration track 0/2):
  ```html
  <audio id="sfx-1" data-start="12.46" data-duration="2.0" data-track-index="6" data-volume="0.5" src="assets/sfx/ka-ching.mp3"></audio>
  ```
- Tiết chế ~1 SFX mỗi 3–6s. Volume **0.4–0.6** (dưới narration 1.0). `data-start` = đúng MỐC sự kiện. `data-duration` đủ dài cho SFX kêu hết (1–3s).

---

## ⚠️ MÔI TRƯỜNG (Windows) + TRANSCRIPTION
- **FFmpeg**: `winget install Gyan.FFmpeg`. PATH chỉ áp shell MỚI → khi gọi `npx hyperframes` prepend bin vào `$env:Path` inline:
  `$bin="C:\Users\<user>\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\ffmpeg-*-full_build\bin"; $env:Path="$bin;$env:Path"`
- `npm install` ở repo root; `npx hyperframes browser ensure` (tải Chromium riêng).
- ⚠️ `npx hyperframes transcribe` cần `whisper-cpp` ngoài + model `.en` chỉ tiếng Anh → **KHÔNG dùng cho tiếng Việt**.

**Transcription tiếng Việt** — dùng **faster-whisper** (`pip install faster-whisper`):
```python
import sys; sys.stdout.reconfigure(encoding="utf-8")   # console Windows không in được dấu
from faster_whisper import WhisperModel
# GPU trước (GTX 1660: nhanh gấp đôi + giải phóng CPU) — lỗi thì rơi về CPU
try:
    m = WhisperModel("large-v3", device="cuda", compute_type="float16")
except Exception:
    m = WhisperModel("large-v3", device="cpu", compute_type="int8")
segs, info = m.transcribe("audio.wav", language="vi", word_timestamps=True, vad_filter=True, beam_size=5)
# xuất JSON {segments:[{start,end,text,words:[{word,start,end}]}]}
```
Tách audio: `ffmpeg -i input.mp4 -vn -ac 1 -ar 16000 audio.wav`. Đọc lại transcript, sửa chỗ Whisper nghe nhầm tên riêng.

## CẮT HI-LIGHT / VIDEO DÀI
YouTube cho phép dài hơn TikTok, nhưng vẫn cắt filler. Nếu cần ghép nhiều đoạn: ffmpeg `filter_complex` (trim+atrim+setpts/asetpts → concat) ra `face.mp4` re-encode sạch; **remap timestamp** (new = orig − shift cộng dồn); sinh caption nhóm theo dấu câu / khoảng nghỉ giọng (gap > ~0.38s) / tối đa 7 từ. Video dài có thể chia **chapter** (mốc + tiêu đề) để mô tả YouTube.

---

## RENDER CONTRACT (must)
- Root: `id`, `data-composition-id`, `data-start="0"`, `data-width="1920"`, `data-height="1080"`.
- Element có thời gian cần `class="clip"` (TRỪ `<video>`/`<audio>`) + `data-start`/`data-duration`/`data-track-index`. Cùng track KHÔNG chồng thời gian (cẩn thận lỗi làm tròn số thực — chừa biên ~0.04s).
- `<video>` phải `muted`; audio ở `<audio>` riêng. KHÔNG animate width/height/top/left trên `<video>`/`<img>` — bọc div, animate wrapper (scale transform OK).
- Mỗi composition đăng ký đúng 1 timeline `paused` vào `window.__timelines["<data-composition-id>"]` (key khớp chính xác). Duration comp = `tl.duration()`. **Pad đủ slot**: `tl.set({}, {}, DUR)` cuối mỗi timeline (Law 11 — ngắn hơn data-duration → frame đen).

## QUY TRÌNH (đã kiểm chứng)
1. **Probe + trích frame** input (`ffprobe`, `ffmpeg -ss <t> -frames:v 1`) → xác định Mode A/B, độ dài, có mặt người không.
2. **Transcribe** (faster-whisper large-v3, vi) → word-level timestamp.
3. **Storyboard**: cắt filler, chia beat (1 ý/beat), đặt data-start/duration, đánh dấu mốc camera-move (FULL→PIP) nếu Mode A. **Trình user duyệt storyboard** trước khi code.
4. **Chọn SFX** (bắt buộc): quét điểm nhấn theo timestamp → map file từ `assets/sound-effects/` (ưu tiên tag `hay-dung` trong `library.json`) → copy vào `assets/sfx/` → **trình user duyệt bảng SFX**.
5. **Verify font** bằng test string (screenshot 1920×1080) TRƯỚC khi dựng nhiều.
6. **Dựng**: theo khung master + beats ở mục KIẾN TRÚC, áp branding Noti.vn. Mỗi scene 1 file, mỗi timeline GSAP `paused`, pad đủ slot.
7. `npx hyperframes lint` → 0 error (cảnh báo self-selector/google-fonts/font-face/video_nested benign, bỏ qua).
8. **Render draft** → trích frame từng scene + **zoom 3× kiểm dấu tiếng Việt** + kiểm camera-move/PiP đúng mốc + ranh giới caption + safe zone YouTube. `Read` từng PNG. Nghe lại SFX khớp & không át lời. Sửa → render lại.
9. User duyệt → **render final** `--quality standard`.

## LỆNH (chạy trong `video-projects/<project>/`)
```powershell
$bin="...\ffmpeg-...\bin"; $env:Path="$bin;$env:Path"
npx hyperframes lint
npx hyperframes compositions
npx hyperframes render --quality draft    --output renders/draft.mp4
npx hyperframes render --quality standard --output renders/final.mp4
# verify dấu: ffmpeg -ss <t> -i renders/draft.mp4 -frames:v 1 -vf "crop=700:340:60:260,scale=1400:680:flags=neighbor" out.png → Read out.png
# verify camera-move: trích frame ngay biên FULL→PIP (vd 12.5–13.2s) xem mặt thu mượt, không méo/đóng băng
# copy SFX: cp ../../assets/sound-effects/<file> assets/sfx/
```

## OUTPUT cho user
File `renders/final.mp4` (1920×1080, 30fps) + bảng timeline: scene | thời lượng | component | nội dung + **bảng SFX: mốc | sự kiện | file | volume**. Dọn file draft/test tạm sau khi xong.
