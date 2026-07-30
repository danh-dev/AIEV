---
name: background-music
description: Chọn nhạc nền từ thư viện assets/music/ và cấu hình auto-ducking (nhạc tự nhỏ khi có thoại) qua meta.json audio.music cho tầng lắp ráp Remotion. Đọc khi brief/edit prompt có mục "Nhạc nền" chế độ auto, hoặc khi user yêu cầu thêm/chỉnh nhạc nền cho video.
---

# Background Music — nhạc nền + auto-ducking

Nhạc nền do Remotion phát ở tầng lắp ráp (component `MusicTrack`): loop cả bài, fade-in 0.5s đầu video, fade-out 1s cuối, và **tự duck** (hạ âm lượng mượt trong 0.4s) quanh mỗi đoạn có thoại. Việc của Claude là chọn bài + sinh speech ranges + khai đúng `audio.music` trong `meta.json` — mọi thứ còn lại là tất định trong Remotion.

## 1. Chọn bài theo mood

- Đọc `assets/music/library.json` — mỗi entry có `file`, `tags` (mood: nang-luong, chill, cam-hung, cang-thang, vui-ve…), `durationMs`, `description`.
- Chọn **MỘT** bài có mood khớp nội dung video (video động lực → nang-luong/cam-hung; giải thích chậm rãi → chill…).
- Bài ngắn hơn video vẫn dùng được — `MusicTrack` tự loop, không cần nối file bằng ffmpeg.

## 2. Sinh speech ranges từ transcript

Speech ranges = các đoạn **CÓ thoại** (giây, trên timeline composition đã cắt) — đó là lúc nhạc bị duck.

1. Lấy word timestamps từ transcript (đã remap nếu autoCut).
2. Gộp các word liền nhau thành một range liên tục.
3. **Merge hai range nếu gap giữa chúng < 0.6s** — khoảng thở ngắn giữa hai câu không đáng để nhạc trồi lên rồi tụt xuống.
4. Kết quả: `[[startSec, endSec], ...]` — thường chỉ vài range cho một video talking-head (intro không thoại, thân bài, outro).

## 3. Mức volume

| Ngữ cảnh | volume | Ghi chú |
|---|---|---|
| Đang có thoại (`duckVolume`) | **0.10–0.15** | Nhạc thấp hơn giọng ~18–20dB — giọng luôn RÕ hơn nhạc |
| Không thoại (`volume`): intro/outro/khoảng nghỉ | **0.30–0.40** | Nhạc dẫn cảm xúc nhưng không đè sfx |

Nhạc mạnh / nhiều bass → lấy **cận dưới** của cả hai khoảng (0.10 / 0.30).

## 4. Khai vào meta.json

**Copy file nhạc vào `assets/` của project** (như sfx) để project portable — KHÔNG trỏ thẳng ra thư viện chung:

```powershell
Copy-Item "assets/music/<file>" "video-projects/<id>/assets/music/<file>"
```

Rồi khai (đường dẫn tương đối từ project root):

```json
"audio": {
  "voice": "...",
  "sfx": [...],
  "music": {
    "file": "assets/music/<file>",
    "volume": 0.35,
    "duckVolume": 0.12,
    "speech": [[1.2, 14.8], [16.1, 42.5]]
  }
}
```

Server tự stage file vào Remotion staging khi assemble — không cần làm gì thêm.

## 5. Verify (bắt buộc trước final)

1. Render draft (assemble-draft) rồi **nghe 3 điểm**: đầu video (fade-in + mức intro), giữa video lúc đang thoại (nhạc phải chìm hẳn dưới giọng), cuối video (fade-out sạch).
2. Chuẩn duy nhất: **giọng nói phải RÕ hơn nhạc ở mọi thời điểm**. Nghe mà phải căng tai mới ra lời → giảm `duckVolume`.
3. Nghi ngờ mức âm lượng → đo bằng `ffmpeg -i <draft.mp4> -af volumedetect -f null NUL` trên đoạn có thoại và đoạn không thoại, so mean_volume hai đoạn.

## Lỗi cần né

- **Nhạc to hơn thoại** — duckVolume quá cao hoặc speech ranges thiếu đoạn. Kiểm lại transcript coverage: mọi đoạn có lời phải nằm trong một range.
- **Quên fade-out cuối** — MusicTrack tự fade-out 1s theo durationInFrames; nhưng nếu tính sai tổng duration composition thì nhạc bị cắt cụt. Verify điểm cuối khi nghe draft.
- **Nhạc có lời tiếng Việt** — đè thoại, não người nghe không tách được hai lớp lời. CHỈ dùng nhạc không lời.
- **Tự tải nhạc từ mạng** — CẤM (bản quyền). Chỉ dùng thư viện `assets/music/`. Thư viện trống → bỏ qua nhạc nền, nêu rõ trong báo cáo.
