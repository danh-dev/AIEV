---
name: video-pipeline
description: Quy trình sản xuất video end-to-end của hệ thống AI Edit Video — từ yêu cầu người dùng đến file MP4 trong outputs/, phối hợp HyperFrames (scene) và Remotion (lắp ráp). Đọc khi bắt đầu làm bất kỳ video nào hoặc khi xây backend render queue.
---

# Video Pipeline — từ yêu cầu đến MP4

## Phân vai engine (không bao giờ đổi vai)

| Việc | Engine | Lý do |
|---|---|---|
| Scene motion-graphics: kinetic typography, caption karaoke, count-up, bảng số liệu, callout, shader | **HyperFrames** | HTML + GSAP là thế mạnh, skills tiếng Việt đã có sẵn fix |
| Ghép các scene + footage gốc, transition giữa scene, mix audio + sound effect, overlay caption toàn bài, xuất bản cuối | **Remotion** | Lắp ráp có lập trình, `<Sequence>`/`<Audio>`/`<OffthreadVideo>` |

Giao tiếp giữa hai engine: **file MP4 trung gian** trong `video-projects/<ten>/renders/`. HyperFrames không biết Remotion tồn tại và ngược lại — chỉ có manifest chung.

## Vòng đời một project

### 1. Khởi tạo
- Tạo `video-projects/<ten-kebab-case>/` với `index.html`, `compositions/`, `assets/`, `renders/`, `hyperframes.json`, `meta.json`.
- `meta.json` là manifest trung tâm:

```json
{
  "id": "tiktok-paper-gpt5",
  "name": "Mổ xẻ paper GPT-5",
  "width": 1080, "height": 1920, "fps": 30,
  "status": "draft",
  "scenes": [
    { "id": "s01-hook",   "src": "compositions/s01-hook.html",   "durationInFrames": 90,  "render": "renders/s01-hook.mp4" },
    { "id": "s02-talking","srcVideo": "assets/talking-head.mp4", "from": 2.5, "to": 14.0 }
  ],
  "audio": {
    "voice": "assets/voice.mp3",
    "sfx": [ { "file": "assets/sound-effects/whoosh-01.mp3", "atFrame": 88 } ]
  },
  "output": null
}
```

- `scenes[]` là hợp đồng giữa hai engine: scene có `src` do HyperFrames render; scene có `srcVideo` là footage dùng thẳng. Remotion đọc file này để lắp — **không hardcode danh sách scene trong code Remotion**.

### 2. Dựng scene (HyperFrames)
- Copy `assets/brand/brand-tokens.css` vào project, viết composition theo chuẩn `window.__timelines`.
- Video tiếng Việt: áp dụng fix đã kiểm chứng (chữ gradient mất dấu → render chữ bằng element thật + `background-clip` đúng cách; kiểm tra đủ dấu ở mọi frame đầu/cuối reveal).
- Lint sạch lỗi rồi mới render: `npx hyperframes lint`.
- Render draft từng scene: `npx hyperframes render --quality draft --output renders/<scene>.draft.mp4`.

### 3. Verify frame (bắt buộc, trước khi lắp)
```bash
ffmpeg -ss <giây-hero-moment> -i renders/<scene>.draft.mp4 -frames:v 1 verify/<scene>.png
```
Soi từng ảnh: chữ tiếng Việt đủ dấu? text không tràn mép? không frame trắng/đen bất thường? mặt không bị crop? Sai thì sửa scene, không đi tiếp.

### 4. Lắp ráp (Remotion) — xem chi tiết ở skill `remotion-assemble`
- Composition Remotion đọc `meta.json`, dựng `<Sequence>` theo `scenes[]`, chèn sfx theo `atFrame`.
- Render draft toàn bài → xem trong web UI → duyệt.

### 5. Final
- Re-render các scene HyperFrames ở `--quality standard`.
- Remotion render final → `outputs/<project>-v<N>.mp4`.
- Cập nhật `meta.json`: `status: "done"`, `output: "outputs/..."`. Web UI đọc trạng thái từ đây.

## Quy tắc render queue (backend)

1. **Mọi render đi qua queue** — kể cả khi Claude tự chạy tay. Job ghi vào SQLite: `id, projectId, type (scene-draft|scene-final|assemble-draft|assemble-final|image-gen), status, progress, log, startedAt, finishedAt`.
2. Job chạy **song song tối đa `QUEUE_CONCURRENCY`** (mặc định 2, env chỉnh được; máy yếu đặt 1). Ràng buộc an toàn: hai job của **cùng một project không bao giờ chạy đồng thời** (tránh giẫm renders/meta) — song song chỉ xảy ra giữa các project khác nhau.
3. Progress: parse stdout của CLI (cả hai engine đều in tiến độ frame) → cập nhật DB → đẩy SSE cho web UI.
4. Job fail: giữ nguyên log đầy đủ trong DB, hiển thị trên UI, **không tự retry quá 1 lần**.
5. Draft luôn trước final. Backend từ chối job final nếu project chưa có draft thành công ở phiên bản scene hiện tại.

## Sound effects

- Thư viện dùng chung: `assets/sound-effects/`, mỗi file kèm entry trong `assets/sound-effects/library.json` (`file`, `tags`, `durationMs`, `mô tả tiếng Việt`).
- Khi dùng cho một video: copy vào `video-projects/<ten>/assets/sound-effects/` rồi khai trong `meta.json` — project phải tự chứa đủ asset của nó (tái render không phụ thuộc thư viện thay đổi).
- Web UI trang Sound Effects đọc `library.json`, nghe thử inline, cho upload file mới (backend cập nhật json).

## Tăng tốc render (máy này có GTX 1660 — đã kiểm chứng 2026-07)

Nguyên nhân số 1 làm pipeline mất cả tiếng: **re-render draft CẢ BÀI sau mỗi lần sửa nhỏ**. Quy tắc:

1. **Verify layout/chữ bằng `npx hyperframes snapshot` hoặc `inspect`** (vài giây) thay vì render draft
   cả bài (hàng chục phút). Chỉ render draft đầy đủ MỘT lần khi mọi snapshot đã đạt, và final MỘT lần.
2. **Sửa nhỏ → chỉ re-render phần đổi**: sửa 1 scene thì render lại scene đó (`render -c <scene>`),
   đừng render lại cả composition. Pipeline chia scene + Remotion assemble tối ưu nhất cho việc này.
3. **Flags tăng tốc HyperFrames** (queue của backend đã tự thêm; khi chạy tay thì BẮT BUỘC nhớ):
   `-w 8 --browser-gpu` cho mọi render; thêm `--gpu` (NVENC) cho draft. Final giữ encode CPU
   (libx264) để chất lượng tối đa. Đo thực tế: nhanh hơn ~30% scene ngắn, hơn nữa với bài dài.
4. **Transcript chỉ chạy MỘT lần** — `transcript.json` đã có thì dùng lại, tuyệt đối không transcribe lại.
5. **Flags tăng tốc Remotion** (khi chạy tay `npx remotion render/still` BẮT BUỘC thêm):
   `--concurrency 8 --gl angle`. KHÔNG có `--gl angle` thì Chrome của Remotion dựng hình bằng
   software renderer (SwANGLE) — CPU gánh 100%, GPU đứng nhìn (triệu chứng: Task Manager CPU ~95%,
   GPU ~5%). Linux dùng `--gl angle-egl` thay cho `angle`.

## Lỗi đã biết (đã kiểm chứng thực tế 2026-07)

- **`meta.json` phải đúng hợp đồng kiểu dữ liệu** (web UI đọc trực tiếp — sai kiểu là crash trang):
  `output` là **STRING** đường dẫn (vd `"outputs/<id>-v1.mp4"`), KHÔNG phải object. Metadata phụ
  (duration, quality, renderedAt…) đặt vào field riêng `outputInfo` nếu cần. `scenes[].durationInFrames`
  là number; sfx đặt theo `atFrame` (frame, number) như schema đầu file này.

- **Render 1 scene**: dùng cờ `-c`, không phải positional: `npx hyperframes render -c compositions/s01.html --quality draft --output renders/s01.draft.mp4`. Sub-composition dạng `<template>` phải được index.html tham chiếu qua `data-composition-src` thì `-c` mới render được.
- **Chữ dính nhau khi reveal từng từ**: pipeline HyperFrames nuốt whitespace giữa các `<span>` inline-block — tách từ bằng `margin: 0 0.14em` trên `.word`, đừng trông cậy khoảng trắng trong HTML.
- **Warning `sub_timeline_readiness_timeout`** khi render `-c` file template: render vẫn ra đúng (best-effort) nhưng tốn thêm 45s chờ — chấp nhận được ở draft; nếu muốn triệt để thì render qua index.html.
- **Comment TS chứa đường dẫn glob `*/`** (vd `video-projects/*/meta.json`) sẽ đóng block comment sớm → lỗi biên dịch khó hiểu. Viết `video-projects/<id>/meta.json`.

## Checklist trước khi báo hoàn thành

- [ ] Nếu brief bật autoCut: đã cắt theo skill `auto-cut`, verify silencedetect lần 2 trên bản cắt, báo cáo ghi số giây/số đoạn đã cắt
- [ ] Mọi scene qua verify frame, chữ tiếng Việt đủ dấu
- [ ] Audio không lệch sync ở đầu/giữa/cuối (kiểm bằng 3 điểm ngẫu nhiên)
- [ ] Sound effect đúng frame, âm lượng không đè giọng nói (sfx thấp hơn voice ~10dB)
- [ ] Output đúng kích thước/fps trong `meta.json`
- [ ] `meta.json` cập nhật `status` + `output`
- [ ] Bài học mới (nếu có) đã ghi vào skill liên quan
