---
name: color-grading
description: Chỉnh màu video trong hệ thống AI Edit Video — delog/tonemap footage HDR-HLG-log, áp preset màu người dùng đã duyệt trên UI, và quy trình verify màu bằng mắt. Đọc khi edit prompt có mục "Chỉnh màu", khi footage nguồn là HDR/log, hoặc khi người dùng yêu cầu chỉnh màu/delog.
---

# Color Grading — chỉnh màu video

## Nguyên tắc số 1: preview = kết quả cuối

Người dùng đã DUYỆT màu trên web UI dựa trên preview sinh từ các filter chain chuẩn trong
`apps/server/src/color.ts` (`GRADE_PRESETS`). Khi áp lên video thật, PHẢI dùng **đúng chuỗi filter đó**
— không tự chế, không "cải thiện thêm". Sai chuỗi = màu lệch so với cái người dùng đã chọn.

## Nguồn sự thật của preset + chỉnh tay

Đọc `apps/server/src/color.ts`:
- `GRADE_PRESETS` — 14 template màu (tu-nhien, tuoi-sang, vivid, cinematic, teal-orange,
  film-vintage, mau-phim, golden-hour, am, lanh, dem-xanh, moody, pastel, den-trang) kèm chuỗi -vf.
- `GradeAdjust` — thông số chỉnh tay người dùng cộng CHỒNG lên preset (brightness/contrast/
  saturation/gamma qua `eq`, `colortemperature`, `vibrance`); hàm `buildFilterChain(preset, tonemap, adjust)`
  ghép đúng thứ tự: tonemap → preset → chỉnh tay.
- Prompt edit đã in sẵn chuỗi -vf hoàn chỉnh cho từng asset — CHỈ VIỆC DÙNG NGUYÊN VĂN.

## Delog / tonemap HDR (chèn TRƯỚC preset)

Kiểm tra footage bằng ffprobe:
```bash
ffprobe -v error -select_streams v:0 -show_entries stream=color_transfer,color_primaries -of csv=p=0 input.mp4
```
Nếu `color_transfer` là `arib-std-b67` (HLG — iPhone/Android quay HDR) hoặc `smpte2084` (HDR10),
hoặc `color_primaries` là `bt2020` → chèn tonemap TRƯỚC preset:

```
zscale=t=linear:npl=100,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p
```

Log máy quay chuyên (S-Log3, D-Log, V-Log...) mà metadata không khai HDR: cần LUT `.cube` của hãng —
nếu chưa có LUT trong hệ thống, báo người dùng thay vì đoán mò.

## Quy trình áp màu cho một video

1. Probe màu (lệnh trên) → xác định có cần tonemap không.
2. Tạo bản đã chỉnh màu (encode chất lượng cao, giữ audio nguyên):
```bash
ffmpeg -y -i assets/source.mp4 -vf "<tonemap-nếu-cần>,<chuỗi-preset>" -c:v libx264 -crf 16 -preset medium -c:a copy assets/source.graded.mp4
```
3. **Verify bằng mắt (bắt buộc)**: trích 3 frame (đầu / giữa / cuối) của bản graded, NHÌN từng ảnh:
   da người tự nhiên không cam cháy? highlight không bệt? đen không nát? Có vấn đề → báo lại,
   đừng lặng lẽ đổi filter (người dùng đã chốt preset).
4. Dùng bản `.graded.mp4` trong TOÀN BỘ pipeline thay bản gốc (meta.json srcVideo, transcribe vẫn
   dùng audio nào cũng được vì audio copy nguyên).
5. Ghi vào mô tả asset (assets.json) là đã grade bằng preset nào để lần sau không grade lặp 2 lần.

## Lỗi đã biết

- **Grade 2 lần**: bản `.graded.mp4` bị áp preset lần nữa ở phiên sau → màu gắt. Luôn kiểm tra tên file
  và assets.json trước khi grade.
- **Chỉ grade video chính, quên b-roll/ảnh chèn**: ảnh chèn thường không cần grade (đồ họa), nhưng
  b-roll quay cùng máy thì cần cùng preset — hỏi mô tả asset để biết file nào là footage máy quay.
- **tonemap thiếu `format=yuv420p` cuối chuỗi** → file ra 10-bit, HyperFrames/trình duyệt có thể không phát được.
