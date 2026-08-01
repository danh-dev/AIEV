---
name: noti-tiktok-vn
description: Edit video TikTok dọc tiếng Việt (9:16) bằng HyperFrames theo chuẩn Noti.vn/GĐT — talking-head + kinetic typography + caption karaoke + zoom/punch-in camera + sound effect đồng bộ timestamp, render MP4. Bao gồm sẵn các fix đã kiểm chứng (mất dấu chữ gradient, transcription tiếng Việt, PATH ffmpeg). Dùng khi user đưa một clip tiếng Việt và muốn dựng thành video TikTok có chữ động + phụ đề + zoom nhấn nhịp theo phong cách dark fintech xanh.
---

# TikTok VN Edit — chuẩn của Noti.vn / GĐT

## ⚖️ STYLE DESIGN — LUẬT ƯU TIÊN (đọc trước tiên)

Nếu edit prompt có mục **"STYLE DESIGN (BẮT BUỘC TUÂN THỦ 100%)"**: bảng màu, font, tone
trong mục đó **THAY THẾ HOÀN TOÀN** mọi quy định màu/font/branding trong skill này
(kể cả "dark fintech xanh", hex GĐT, gradient mặc định...). Chỉ giữ lại: kỹ thuật animation,
layout, nhịp cắt, quy trình render, các fix lỗi. Ảnh minh họa tạo qua /api/illustrations
phải truyền đúng styleId trong prompt. KHÔNG có mục Style Design → dùng branding mặc định của skill.

Skill này dựng video TikTok dọc tiếng Việt bằng HyperFrames (HTML/CSS/JS + GSAP → MP4).
**Project mẫu đã chạy hoàn chỉnh:** `video-projects/sapo/` — copy cấu trúc từ đây là nhanh nhất.

> ⚡ Đọc luôn cả file này trước khi dựng. Các mục ⚠️ là lỗi đã từng gặp & đã fix — KHÔNG lặp lại.

---

## ROLE
Video editor dùng HyperFrames. Compose HTML/CSS/JS, animate GSAP, render MP4 dọc.

## OUTPUT SPEC
- 9:16 — **1080×1920**, **30fps** (60fps nếu rất nhiều kinetic typography).
- Safe zone TikTok: chừa **15% dưới (~288px)** + **12% phải (~130px)**. Text quan trọng + CTA trong khung an toàn giữa-trên. Caption đặt `bottom: ~372px` (trên vùng nút app).
- Mỗi scene = 1 sub-composition HTML riêng (`<template>` + `data-composition-src`), timing qua `data-start`/`data-duration`/`data-track-index`.

## STYLE (Noti.vn / GĐT)
- Nền dark `#0A0E1A → #0F1629` (gradient) + grain nhẹ.
- Accent gradient text: `linear-gradient(100deg, #0061ff, #00c2ff)` qua `background-clip:text` cho tiêu đề.
- Glassmorphism: `background: rgba(255,255,255,0.06); backdrop-filter: blur(20px); border-radius: 20px;` viền bằng box-shadow (KHÔNG dùng border 1px cứng):
  `box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), inset 0 0 0 1px rgba(255,255,255,0.05), 0 18px 50px rgba(0,0,0,0.45);`
- Chữ: tiêu đề weight 800, phụ đề 600, body 400. Letter-spacing chặt (`-0.03em`) cho heading lớn.
- Glow chữ nhấn: `filter: drop-shadow(0 0 26px rgba(0,140,255,0.4))` (drop-shadow cho gradient text, KHÔNG dùng text-shadow vì chữ trong suốt).

## HIỆU ỨNG (GSAP)
- Text reveal: y 40→0, opacity 0→1, stagger 0.06–0.09, ease `power3.out`.
- Kinetic keyword: scale-pop 0.8→1.05→1 + glow flash (tween `filter` drop-shadow).
- Caption karaoke: bám timestamp, cụm 4–7 từ, từ đang nói highlight `#19c8ff` + scale 1.13.
- Chuyển cảnh: mặc định blur+fade crossfade 0.4s; nhịp nhanh slide-push (`power4.inOut`); scene nhấn scale-zoom (xem mục 🔍 ZOOM).
- Background: blob gradient xanh trôi chậm (parallax) + grain CSS tất định.
- ⚠️ KHÔNG dùng `setTimeout`/`Date.now()`/`Math.random()` — chỉ GSAP timeline (HyperFrames capture frame theo thời gian timeline). Mọi animation tất định.

---

## 🔍 ZOOM / PUNCH-IN (chống video tĩnh & nhàm)
Talking-head đứng yên 30–60s rất chán. Thêm chuyển động camera (zoom) **bám timestamp + khớp SFX + hợp nội dung** để giữ mắt. Đây là yếu tố giữ retention chính → BẮT BUỘC có ở mọi video.

### ⚠️⚠️ KỸ THUẬT (BẮT BUỘC — nếu sai sẽ đóng băng frame)
- KHÔNG bao giờ animate `width/height/top/left` trên `<video>` → frame đóng băng (đã ghi ở RENDER CONTRACT). **Zoom = animate `scale` (transform) trên DIV bọc video** (`#face-wrapper`), không animate trực tiếp `<video>`.
  ```css
  #face-wrapper { position:absolute; inset:0; overflow:hidden; will-change:transform; }
  #face-video { width:100%; height:100%; object-fit:cover; }
  ```
  ```js
  // transform-origin nhắm vào MẶT người (không phải tâm khung) để zoom vào mặt, không vào trán/cằm
  gsap.set("#face-wrapper", { transformOrigin: "50% 38%" });
  // punch-in nhấn: snap nhanh vào, giữ, thả ra
  tl.to("#face-wrapper", { scale: 1.12, duration: 0.30, ease: "power4.out" }, AT)
    .to("#face-wrapper", { scale: 1.0,  duration: 0.45, ease: "power2.inOut" }, AT + HOLD);
  ```
- ⚠️ Chỉ zoom **lớp face** (wrapper video). KHÔNG bọc caption/chữ động/SFX vào wrapper bị zoom — caption phải đứng yên đúng safe zone, nếu không sẽ trôi/cắt khi zoom.
- ⚠️ `transform-origin` cố định trong suốt 1 cú zoom (đừng đổi giữa chừng → giật). Mọi tween tất định (GSAP timeline, không setTimeout/random).
- ⚠️ Scale lên làm lộ mép khung → wrapper phải `overflow:hidden` và video `object-fit:cover` phủ kín dư; biên độ punch giữ nhỏ (xem dưới) để mép không bao giờ lộ nền.

### 3 loại zoom (chọn theo nội dung)
| Loại | Khi nào dùng | Biên độ & ease |
|---|---|---|
| **Punch-in nhấn** (snap vào rồi thả) | Câu chốt/punchline, con số sốc, keyword đắt, lúc giọng lên cao/căng | `1.0→1.10–1.14`, vào nhanh `power4.out` 0.25–0.4s, giữ ~0.6–1s rồi thả `power2.inOut` |
| **Ken Burns drift** (zoom rất chậm, liên tục) | Nền cho đoạn nói dài bình thường để không bị tĩnh | `1.0→1.05` (hoặc 1.05→1.0) trải DÀI cả beat, ease `none`/`sine.inOut` — gần như không thấy nhưng hết tĩnh |
| **Zoom-out reveal** (đang gần → kéo ra) | Mở đầu scene mới, hạ nhịp, chuyển ý, "lùi lại nhìn toàn cảnh" | `1.12→1.0`, ease `power3.out` ~0.5s |

### Quy tắc đồng bộ (timestamp ↔ nội dung ↔ SFX)
1. **Mốc zoom = mốc nội dung**: punch-in landing đúng frame keyword/con số **bắt đầu** xuất hiện (lấy từ word timestamp của caption), KHÔNG đặt random.
2. **Zoom khớp SFX**: punch-in scale-up phải **trùng đúng onset của SFX nhấn** (vd `pop.mp3`/`ding.mp3`/`anime-wow-1.mp3`) → `data-start` của SFX = thời điểm tween scale bắt đầu. Mắt thấy zoom + tai nghe "bụp" cùng frame → đã nhân đôi cú nhấn (xem mục 🔊 SOUND EFFECT).
3. **Hợp nội dung & cảm xúc**: zoom-IN khi nhấn mạnh/căng/số liệu/punchline; zoom-OUT khi mở cảnh/reveal/hạ nhịp; còn lại để Ken Burns nhẹ hoặc giữ yên. Đừng zoom ngược cảm xúc (vd zoom-out lúc đang chốt mạnh).
4. **Tiết chế**: ~1 cú zoom nhấn mỗi **4–8s**, KHÔNG zoom liên tục mỗi câu (chóng mặt, mất tác dụng nhấn). Giữa các cú nhấn cho Ken Burns chạy nền.

### Verify zoom (bắt buộc khi render draft)
Trích frame **ngay biên cú zoom** (đầu, đỉnh, cuối) — vd punch tại 14.2s thì trích 14.1 / 14.4 / 15.0s — kiểm: mặt phóng mượt không méo/đóng băng, **không lộ mép nền**, caption vẫn đứng yên đúng vị trí, zoom landing trùng SFX onset (nghe lại đoạn đó).

---

## 🔊 SOUND EFFECT (đồng bộ với zoom & nội dung)
Thư viện dùng chung: `assets/sound-effects/` (từ trong project: `../../assets/sound-effects/`). Bộ đề xuất = các entry có tag `hay-dung` trong `assets/sound-effects/library.json`. Tham khảo cách ghép thật: `video-projects/mcp-tiktok-2/index.html` (block `<audio id="sfx-*">`).

### Quy trình tự chọn SFX (theo nội dung + timestamp + zoom)
1. Đọc transcript + caption timestamp + storyboard → tìm "điểm nhấn": con số/count-up, reveal keyword, **mốc punch-in zoom**, chuyển scene mạnh, punchline, CTA cuối.
2. Map mỗi điểm nhấn → 1 SFX hợp ngữ nghĩa. `data-start` = đúng MỐC sự kiện (= mốc zoom nếu cú đó có zoom), KHÔNG phải đầu scene chung chung.
3. ⚠️ Tiết chế: ~1 SFX mỗi 3–6s, không mỗi câu một tiếng. Đa dạng file, tránh lặp 1 tiếng quá dày.
4. **Trình user duyệt bảng SFX + bảng ZOOM** (mốc giây | sự kiện | zoom | file SFX | volume) cùng storyboard trước khi ghép.

Map ngữ nghĩa → file: số liệu tốt → `ding.mp3`/`ting.wav`; tiền → `ka-ching.mp3`/`money.mp3`; pop element/keyword → `pop.mp3`; ảnh/chụp → `camera-snap.wav`/`camera-flash-1.wav`; số xấu/sai → `error.mp3`; wow/punch → `anime-wow-1.mp3`; gõ phím → `mechanical-keyboard.mp3`/`iphone-typing.mp3`; click → `click-button.mp3`/`mouse-click.mp3`.

Ghép:
1. **Copy** file đã chọn vào `assets/sfx/` (giữ project portable — KHÔNG để `src` trỏ ra ngoài project).
2. Mỗi SFX = 1 `<audio>` riêng trong root composition, cạnh `<audio>` narration. ⚠️ KHÔNG `class="clip"` trên `<audio>` (Render Contract — phá audio):
   ```html
   <audio id="sfx-1" data-start="14.20" data-duration="2.0" data-track-index="6" data-volume="0.5" src="assets/sfx/pop.mp3"></audio>
   ```
3. ⚠️ Mỗi SFX một `data-track-index` RIÊNG (4,5,6,…) — cùng track KHÔNG chồng thời gian. Narration track 0; SFX dùng track **từ 4 trở lên**.
4. ⚠️ Volume `data-volume` **0.4–0.6** (dưới narration 1.0) để không át lời; punch comedic có thể 0.55–0.65.
5. `data-duration` đủ dài cho SFX kêu hết (1–3s); ngắn quá bị cắt cụt.

---

## ⚠️ FONT TIẾNG VIỆT — BẮT BUỘC

1. Font có full glyph VN: **"Be Vietnam Pro"** (ưu tiên) hoặc "Inter" subset vietnamese. KHÔNG để fallback về system font headless Chromium (thiếu dấu → tofu).
2. Nhúng qua Google Fonts subset vietnamese, `display=block` — **renderer HyperFrames tự fetch & cache + inject @font-face tất định** (đã kiểm chứng: log "Fetched ... font face(s) ... Injected deterministic @font-face"):
   ```html
   <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700;800&display=block&subset=vietnamese" rel="stylesheet">
   ```
3. `<meta charset="UTF-8">` + `<html lang="vi">`.
4. `font-display: block` (KHÔNG swap).
5. fallback chain kết bằng font có dấu: `font-family: "Be Vietnam Pro", "Inter", sans-serif;`
6. Test string phải render đủ dấu 100%: `Ưu đãi độc quyền — giảm giá sốc! Đừng để vụt mất cơ hội này. ƯỢ Ễ Ỹ ặ ậ ề`

### ⚠️⚠️ FIX QUAN TRỌNG — MẤT DẤU TRÊN CHỮ GRADIENT
Chữ tiêu đề dùng `background-clip:text; color:transparent` sẽ **CẮT CỤT dấu chồng cao** (dấu ngã trên Ẫ, dấu hỏi trên Ể, mũ trên Ấ…) vì dấu nhô khỏi hộp tô gradient → phần đó không được tô → trông như mất dấu.
**`padding-top: 0.14em` KHÔNG đủ. Phải dùng `0.5em`.** Áp cho MỌI dòng tiêu đề gradient:
```css
.heading-gradient {
  background: linear-gradient(100deg, #0061ff 0%, #00c2ff 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  line-height: 1.0;
  padding-top: 0.5em;     /* chống cắt dấu chồng phía trên (Ẫ Ể Ấ Ữ Ổ…) */
  padding-bottom: 0.14em; /* chống cắt dấu chấm dưới (Ụ Ộ Ạ Ợ…) */
}
```
Chữ TRẮNG thường (không background-clip) KHÔNG bị lỗi này — dấu tràn ra vẫn hiện. Chỉ cần fix chữ gradient.

### ⚠️ Caption không được CHỒNG dòng (lời nói liên tục)
Caption karaoke đặt cùng một vị trí (bottom). Nếu video nói **liên tục không nghỉ**, dòng cũ chưa kịp fade-out thì dòng mới đã fade-in → **2 dòng đè nhau, chữ rối**. (Lỗi này không lộ khi clip có nhiều khoảng lặng.)
**Fix:** dòng cũ phải tắt HẲN trước/đúng lúc dòng mới hiện — fade-out hoàn tất tại thời điểm fade-in của dòng kế. Dùng `PRE_ROLL = 0`, và:
```js
const inAts = SEGMENTS.map(s => Math.max(s.words[0].start, 0));
// mỗi dòng: fadeInAt = inAts[i];
// fadeOutAt = (i < n-1) ? Math.max(segEnd+0.02, inAts[i+1] - FADE_OUT) : segEnd + POST_HOLD;
```
Khi verify, BẮT BUỘC trích thêm vài frame ngay RANH GIỚI giữa 2 dòng caption (không chỉ giữa câu) để chắc không chồng.

### ⚠️ Sub-composition render BIỆT LẬP
Mỗi sub-comp (`data-composition-src`) render trong ngữ cảnh riêng → KHÔNG kế thừa từ master:
- Mỗi sub-comp phải có `<script src=".../gsap.min.js">` **riêng**.
- Mỗi sub-comp có text phải tự nhúng `<link>` font Google **riêng** (đặt ngay trong `<template>`).
- KHÔNG dùng CSS var (`var(--accent-grad)`) từ `:root` của master trong sub-comp — **dùng giá trị literal** (hex/gradient viết thẳng). Var sẽ rỗng khi render biệt lập.

---

## ⚠️ MÔI TRƯỜNG (Windows)
- **FFmpeg**: cài `winget install Gyan.FFmpeg`. PATH chỉ áp cho shell MỚI → khi gọi `npx hyperframes`, prepend bin vào `$env:Path` inline:
  `$bin="C:\Users\<user>\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\ffmpeg-*-full_build\bin"; $env:Path="$bin;$env:Path"`
- `npm install` ở repo root; `npx hyperframes browser ensure` (tải Chromium riêng).
- ⚠️ `npx hyperframes transcribe` cần binary `whisper-cpp` ngoài (KHÔNG bundle) và model `.en` chỉ tiếng Anh → **không dùng cho tiếng Việt**.

## TRANSCRIPTION tiếng Việt
Dùng **faster-whisper** (`pip install faster-whisper` — có wheel cho Python 3.14):
```python
import sys; sys.stdout.reconfigure(encoding="utf-8")   # console Windows cp1252 không in được dấu
from faster_whisper import WhisperModel
# GPU trước (đã kiểm chứng trên GTX 1660: nhanh GẤP ĐÔI + giải phóng CPU cho render) — lỗi thì CPU
try:
    m = WhisperModel("large-v3", device="cuda", compute_type="float16")
except Exception:
    m = WhisperModel("large-v3", device="cpu", compute_type="int8")
segs, info = m.transcribe("audio.wav", language="vi", word_timestamps=True, vad_filter=True, beam_size=5)
# xuất JSON {segments:[{start,end,text,words:[{word,start,end}]}]}
```
Tách audio: `ffmpeg -i input.mp4 -vn -ac 1 -ar 16000 audio.wav`.
Whisper có thể nghe sai vài chỗ (vd "bằng bài công nghệ" → thực ra "về công nghệ") — đọc lại transcript và dọn caption cho đúng/gọn.

---

## CẮT HI-LIGHT (video gốc dài > ~90s)
TikTok hợp video ngắn. Nếu clip gốc dài, đề xuất user cắt còn ~30–60s, ghép các đoạn đắt nhất:
- Cắt-ghép nhiều đoạn bằng 1 lệnh ffmpeg `filter_complex` (trim+atrim+setpts/asetpts → concat) ra `face.mp4` re-encode sạch.
- **Remap timestamp:** với mỗi đoạn giữ `(start, end, shift)` (new = orig - shift, shift cộng dồn theo độ dài đã cắt trước đó); lọc word nằm trong đoạn giữ, đổi sang timeline mới → sinh caption.
- Sinh caption tự động: nhóm word thành dòng theo **dấu câu / khoảng nghỉ giọng (gap > ~0.38s) / tối đa 7 từ** (đừng cắt cứng theo số từ — vỡ cụm). Sửa lỗi Whisper nghe nhầm tên riêng trong bước này.

## QUY TRÌNH (đã kiểm chứng)
1. **Probe + trích frame** video gốc (`ffprobe`, `ffmpeg -ss <t> -frames:v 1`) → xác định talking-head/không, độ dài, fps.
2. **Transcribe** (faster-whisper large-v3, vi) → word-level timestamp.
3. **Storyboard**: cắt filler, chia 4–6 beat (1 ý/beat), đặt data-start/duration. Đánh dấu **mốc zoom** (loại + biên độ) theo keyword/punchline/số liệu. **Trình user duyệt storyboard** trước khi code.
4. **Chọn ZOOM + SFX** (bắt buộc): quét điểm nhấn theo timestamp → mỗi mốc gán loại zoom (punch-in/Ken Burns/zoom-out) + SFX khớp onset → copy SFX vào `assets/sfx/` → **trình user duyệt bảng (mốc | sự kiện | zoom | SFX | volume)**.
5. **Verify font** bằng test string (screenshot Playwright 1080×1920) TRƯỚC khi dựng nhiều.
6. **Dựng**: `index.html` (face wrapper zoom-able + audio narration + SFX + scrim + ambient + scenes + captions) + `compositions/*.html`. Mỗi scene 1 file, mỗi timeline GSAP `paused`, **pad đủ slot** `tl.set({}, {}, DUR)` (Law 11 — nếu timeline ngắn hơn data-duration → frame đen). Zoom = animate `scale` trên `#face-wrapper` (KHÔNG trên `<video>`).
7. `npx hyperframes lint` → 0 error (cảnh báo `composition_self_attribute_selector`/`google_fonts_import`/`font_family_without_font_face` là benign, bỏ qua).
8. **Render draft** → **trích frame từng scene + zoom 3× vùng tiêu đề** kiểm dấu tiếng Việt (`crop=...,scale=...:flags=neighbor`) + timing + safe zone + **frame ngay biên cú zoom** (mặt mượt, không lộ mép, caption đứng yên) + **nghe lại SFX khớp mốc zoom & không át lời**. `Read` từng PNG. Sửa lỗi → render lại.
9. User duyệt → **render final** `--quality standard`.

## RENDER CONTRACT (must)
- Root: `id`, `data-composition-id`, `data-start="0"`, `data-width`, `data-height`.
- Element có thời gian cần `class="clip"` (TRỪ `<video>`/`<audio>`). Cần `data-start`/`data-duration`/`data-track-index`. Cùng track KHÔNG được chồng thời gian (cẩn thận lỗi làm tròn số thực: 6.86+1.84=8.7000…1 → chồng; chừa biên).
- `<video>` phải `muted`; audio để `<audio>` riêng (narration + mỗi SFX 1 `<audio>` track-index ≥4, KHÔNG `class="clip"`). KHÔNG animate width/height/top/left trên `<video>` (đóng băng frame) — bọc div `#face-wrapper`, animate `scale` trên wrapper (đó là cơ chế ZOOM); scale transform thì OK.
- Mỗi composition đăng ký đúng 1 timeline paused vào `window.__timelines["<data-composition-id>"]` (key khớp chính xác).
- Duration comp = `tl.duration()`.

## LỆNH (chạy trong `video-projects/<project>/`)
```powershell
$bin="...\ffmpeg-...\bin"; $env:Path="$bin;$env:Path"
npx hyperframes lint
npx hyperframes compositions
npx hyperframes render --quality draft    --output renders/draft.mp4
npx hyperframes render --quality standard --output renders/final.mp4
# verify dấu: ffmpeg -ss <t> -i renders/draft.mp4 -frames:v 1 -vf "crop=700:340:60:260,scale=1400:680:flags=neighbor" out.png  → Read out.png
# verify zoom: trích frame ngay biên cú zoom (đầu/đỉnh/cuối) xem mặt mượt, không lộ mép, caption đứng yên
# copy SFX: cp ../../assets/sound-effects/<file> assets/sfx/
# verify SFX: ffmpeg -ss <t> -i renders/draft.mp4 -t 4 -vn out.wav  → nghe SFX khớp mốc zoom & không át narration
```

## OUTPUT cho user
File `renders/final.mp4` (1080×1920, 30fps) + bảng timeline scene + **bảng ZOOM & SFX: mốc | sự kiện | loại zoom | file SFX | volume**. Dọn các file draft/test tạm sau khi xong.
