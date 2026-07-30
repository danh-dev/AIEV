---
name: auto-cut
description: Cắt bỏ khoảng lặng và đoạn thừa (filler, nói lặp, false start) khỏi video talking-head TRƯỚC khi dựng — quy trình ffmpeg silencedetect + phân tích transcript, remap word timestamp sau cắt, verify bắt buộc bằng silencedetect lần 2. Đọc khi brief bật "Tự động cắt ngắn video" (autoCut) hoặc user phàn nàn video còn đoạn thừa/khoảng lặng.
---

# Auto-Cut — cắt khoảng lặng & đoạn thừa có kiểm chứng

## Nguyên tắc

1. **Cắt TRƯỚC khi dựng scene/caption.** Cắt sau là lệch toàn bộ timestamp (caption, zoom, SFX).
   Đầu ra của bước này: `assets/face.cut.mp4` + transcript đã remap — mọi bước sau dùng bản cắt.
2. **Cắt là BẮT BUỘC khi brief bật autoCut** — không phải gợi ý. Không cắt được gì thì phải
   nêu lý do cụ thể (video vốn đã chặt) trong báo cáo.
3. Hai loại phải cắt: **khoảng lặng** (đo bằng máy) và **đoạn thừa theo nội dung**
   (đọc transcript: filler "ừm/à/kiểu/thì là", câu nói hỏng rồi nói lại — giữ lần CUỐI,
   false start, lan man lặp ý).

## Bước 1 — Đo khoảng lặng (ffmpeg, khách quan)

```bash
ffmpeg -i assets/face.mp4 -af silencedetect=noise=-30dB:d=0.45 -f null - 2>&1 | grep silence_
```
- Mỗi cặp `silence_start`/`silence_end` là một ứng viên cắt. Lặng **< 0.45s giữ nguyên** (nhịp thở).
- Khi cắt, **giữ đệm 0.18s ở mỗi biên** (start+0.18 → end−0.18) — cắt sát 0 là cụt hơi, nghe robot.
- Video ồn nền (quán xá, ngoài trời) → nâng ngưỡng lên `-25dB` rồi đo lại.
- ⚠️ Khoảng lặng ĐẦU video (trước từ đầu tiên) cắt hết chỉ chừa ~0.2s — lỗi đã gặp: video mở màn
  im lặng 1–2s làm mất hook.

## Bước 2 — Đoạn thừa theo transcript

Transcribe xong (word timestamp), rà từng câu:
- Filler đứng một mình ("ừm", "à", "ờ", "kiểu như là") → cắt cả cụm theo timestamp của từ.
- Câu bị nói lại (nội dung gần trùng, thường liền kề) → giữ lần nói CUỐI, cắt các lần trước.
- Chào hỏi/dẫn dắt dông dài không phục vụ nội dung → đề xuất cắt (ghi vào bảng cho user thấy).
- Mức cắt theo brief: mặc định = lặng ≥0.45s + filler + câu hỏng; user muốn "giữ tự nhiên"
  → chỉ lặng ≥1s; user muốn "gắt/nhịp nhanh" → 0.3s + cắt cả dẫn dắt.

## Bước 3 — Cắt một lần bằng filter_complex

Gộp mọi đoạn GIỮ thành keep-list `[(start,end)...]`, cắt-ghép bằng MỘT lệnh
`trim/atrim + setpts/asetpts + concat` re-encode sạch ra `face.cut.mp4`
(pattern đầy đủ + remap timestamp: xem mục "CẮT HI-LIGHT" của skill `noti-tiktok-vn`).

**Remap word timestamp bắt buộc:** với mỗi đoạn giữ lưu `shift` cộng dồn;
`new = orig − shift`; lọc bỏ word nằm trong đoạn cắt → transcript mới. Caption/zoom/SFX
từ đây CHỈ dùng transcript đã remap.

## Bước 4 — VERIFY (bắt buộc, đây là chỗ mọi lỗi "vẫn còn đoạn thừa" lọt qua)

1. **Đo lại bản cắt**: chạy lại silencedetect trên `face.cut.mp4` — không được còn khoảng lặng
   > 0.8s (trừ nghỉ chủ ý ở chuyển ý). Còn → quay lại bước 3.
2. **So thời lượng**: `ffprobe` gốc vs bản cắt — ghi rõ vào báo cáo cuối:
   "Đã cắt Xs (từ As → Bs), N đoạn: lặng M đoạn, thừa K đoạn". Không có con số này = chưa làm xong.
3. **Nghe 3 biên cắt ngẫu nhiên**: trích 2s quanh biên (`ffmpeg -ss <biên-1> -t 2`) nghe thử —
   không cụt từ, không giật. Cụt → nới đệm biên đó.

## Lỗi đã biết

- Cắt xong dùng transcript CŨ → caption lệch dần về cuối. Luôn transcribe lại hoặc remap.
- Chỉ cắt lặng mà bỏ qua câu nói hỏng — "đoạn thừa" trong mắt user chủ yếu là loại này.
- Cắt trên bản draft render thay vì source → chất lượng giảm 2 lần encode. Luôn cắt từ source.
- SFX/narration có lead silence riêng → dùng `data-media-start` cắt trong HyperFrames
  (xem skill noti-tiktok-vn), đừng re-encode file audio chỉ vì 0.3s lặng đầu.
