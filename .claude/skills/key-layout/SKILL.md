---
name: key-layout
description: Bố cục Key chính / Key liên quan trên video — KEY CHÍNH (chủ đề/hook) hiển thị band TRÊN video, các KEY LIÊN QUAN hiển thị band DƯỚI (trên vùng caption), đồng bộ timestamp với nội dung đang nói. Đọc khi brief bật "Bố cục Key" (keyLayoutEnabled) hoặc edit prompt có mục "Bố cục Key: BẬT".
---

# Key Layout — Key chính trên, Key liên quan dưới

Mục tiêu: người xem lướt thấy video luôn biết **video nói về gì** (key chính, luôn ở trên)
và **đang nói tới ý nào** (key liên quan, đổi theo nội dung, ở dưới).

## ⚖️ STYLE DESIGN — LUẬT ƯU TIÊN

Edit prompt có mục "STYLE DESIGN (BẮT BUỘC TUÂN THỦ 100%)" → màu/font/tone của key lấy
TOÀN BỘ từ style đó. Không có → dùng branding mặc định của skill format đang dùng.

## Chọn key (khi user không chỉ định)

- **KEY CHÍNH**: MỘT cụm 2–6 từ tóm chủ đề/hook của cả video (vd "MCP chính thức của TikTok",
  "Review iPhone 17 Pro"). Lấy từ transcript — ưu tiên cụm được nhắc nhiều/nằm trong câu hook.
  KHÔNG lấy nguyên câu dài; không dấu chấm câu cuối.
- **KEY LIÊN QUAN**: 3–6 cụm 1–4 từ, mỗi cụm là MỘT ý được nói trong video (tính năng, con số,
  tên riêng, bước quy trình). Mỗi key gắn với timestamp lúc ý đó được nhắc (lấy từ word
  timestamp của transcript). User đưa sẵn danh sách → dùng ĐỦ và đúng thứ tự nội dung nhắc tới.

## Vị trí band (9:16 — 1080×1920; tỉ lệ khác quy đổi theo %)

| Band | Vùng y | Ghi chú |
|---|---|---|
| **KEY CHÍNH (trên)** | ~96–345px (5–18% cao) | Giữa ngang; TRÁNH đè mặt người (mặt thường bắt đầu ~20%) |
| **KEY LIÊN QUAN (dưới)** | ~1290–1490px (67–78%) | TRÊN vùng caption (caption ở `bottom: ~372px` = y≥1548) |

- 16:9 (1920×1080): key chính y ~54–190px; key liên quan y ~700–840px, caption dưới cùng.
- Safe zone TikTok vẫn giữ: 15% dưới + 12% phải — band dưới không tràn vào 2 vùng đó.
- Cả 2 band là layer TĨNH so với camera: **KHÔNG đặt trong wrapper bị zoom** (`#face-wrapper`) —
  giống caption, nếu không key sẽ trôi/cắt khi punch-in.

## Typography & style

- **Key chính**: font heading của style, weight 800, cỡ ~64–88px (1080w), 1 dòng (dài quá thì
  giảm cỡ, không xuống 2 dòng trừ khi ≤2 từ/dòng). Màu primary hoặc gradient primary→secondary
  (`background-clip:text` — BẮT BUỘC kèm fix mất dấu tiếng Việt: `display:inline-block` +
  `line-height ≥1.15` + `padding-top: 0.5em`, xem skill noti-tiktok-vn).
- **Key liên quan**: pill/chip — cỡ chữ ~38–48px weight 700, padding `14px 28px`, bo 999px,
  nền glass (`rgba` nền style + blur) hoặc nền accent nhạt, chữ màu text/accent của style.
- **Đọc được trên mọi footage**: sau band key chính thêm scrim mờ
  (`background: linear-gradient(180deg, rgba(0,0,0,0.45), transparent)` phủ ~0–20% đầu video,
  màu lấy từ background của style) hoặc text-shadow đậm — verify bằng snapshot trên frame SÁNG nhất.

## Timing & animation (GSAP — tất định, không setTimeout/random)

- **Key chính**: vào MỘT lần ở ~0.3–0.8s (reveal y 30→0 + opacity, `power3.out` 0.5s), sau đó
  ĐỨNG YÊN suốt video (được phép glow/scale thở rất nhẹ ±1.5%, chu kỳ ≥3s). Video dài chia chương
  thì mỗi chương được đổi key chính 1 lần.
- **Key liên quan**: mỗi key vào đúng lúc ý đó bắt đầu được nói (theo word timestamp), giữ 2.5–4s
  rồi ra. Vào: y 24→0 + opacity 0→1, 0.35s `power3.out`; ra: opacity→0 + y→-12, 0.3s. Chỉ 1 key
  hiển thị tại một thời điểm (tối đa 2 nếu 2 ý dính nhau); key cách nhau ≥1s.
- Key liên quan xuất hiện NÊN khớp SFX nhấn nhẹ (`pop.mp3`/`ting`, volume 0.4) nếu brief bật SFX.

## Phối hợp với các layer khác

- Key chính ↔ kinetic typography: khi scene có tiêu đề kinetic lớn ở vùng trên (vd hook scene),
  ẨN key chính trong scene đó (tránh 2 chữ lớn đè nhau) — key chính hiện lại từ scene kế.
- Key liên quan ↔ caption: 2 layer riêng biệt, không bao giờ đè nhau (band dưới nằm TRÊN caption).
- Key liên quan ↔ card thông số/stat callout: đang có card ở band dưới thì HOÃN key tới khi card ra.

## Verify (bắt buộc trước khi báo xong)

Trích frame bằng ffmpeg và `Read` từng ảnh:
1. Frame ~1s: key chính đã vào, đúng band trên, không đè mặt, dấu tiếng Việt đủ (zoom 3×).
2. Frame giữa mỗi key liên quan: đúng band dưới, không đè caption, không tràn safe zone.
3. Frame đang punch-in zoom: cả 2 band ĐỨNG YÊN (không bị zoom theo).
4. Frame sáng nhất của footage: key vẫn đọc rõ (scrim/shadow đủ).

## Lỗi đã biết

- Chữ gradient tiếng Việt mất dấu → áp fix inline-block + line-height + padding-top (đã kiểm chứng).
- Đặt band trong `#face-wrapper` → key bị phóng theo zoom, trôi khỏi vị trí. Band phải là sibling.
- Key chính đè tiêu đề hook ở scene mở đầu → ẩn key chính trong scene có kinetic title lớn.
- Quá nhiều key liên quan nhấp nháy liên tục → người xem mệt; giữ nhịp ≥1 key/4s, mỗi key ≥2.5s.
