---
name: remotion-assemble
description: Cách dùng Remotion làm tầng lắp ráp (assembler) — đọc meta.json của project, ghép scene HyperFrames đã render + footage + voice + sound effect thành video hoàn chỉnh. Đọc khi viết/sửa code trong engines/remotion hoặc khi lắp timeline cho một video.
---

# Remotion Assemble — lắp ráp timeline từ meta.json

Remotion trong hệ thống này **chỉ làm một việc**: lắp các mảnh đã có (scene MP4 do HyperFrames render, footage gốc, voice, sound effect) thành video cuối. Không dựng motion-graphics trong Remotion — việc đó của HyperFrames.

## Cấu trúc engines/remotion

```
engines/remotion/
├── package.json          ← remotion, @remotion/cli, @remotion/renderer
├── remotion.config.ts
└── src/
    ├── Root.tsx               ← đăng ký 2 composition: "Assemble" + "Poster"
    ├── Assemble.tsx           ← composition tổng: đọc manifest → dựng timeline
    ├── Poster.tsx             ← composition poster/thumbnail tĩnh
    ├── manifest.ts            ← load + validate props video (zod)
    ├── posterManifest.ts      ← load + validate props poster (zod)
    ├── brandFonts.ts          ← load font brand qua staticFile (offline)
    ├── index.ts               ← entry đăng ký Root
    └── components/
        ├── SceneClip.tsx      ← <OffthreadVideo>/<Img> một scene/footage
        ├── Transition.tsx     ← cắt thẳng / crossfade (fade) — chỉ 2 loại
        ├── SfxTrack.tsx       ← đặt <Audio> theo sfx[].atFrame
        ├── CaptionTrack.tsx   ← caption karaoke theo word timestamp
        ├── HighlightTrack.tsx ← band key chính/key liên quan (key-layout)
        └── vietnameseFont.ts  ← @font-face Inter subset vietnamese
```

## Nguyên tắc cốt lõi

1. **Một composition `Assemble` duy nhất, data-driven.** Mọi thứ đến từ `meta.json` của project, truyền qua `defaultProps`/`inputProps`. Thêm video mới = không sửa code Remotion, chỉ thêm manifest.

```bash
npx remotion render Assemble \
  --props="<abs>/video-projects/<ten>/props.resolved.json" \
  --output="../../outputs/<ten>-v1.mp4" \
  --concurrency 8 --gl angle
```

> ⚠️ Đường dẫn asset trong props phải là `staging/...` — backend stage asset vào
> `engines/remotion/public/staging/` bằng hardlink rồi ghi `props.resolved.json`.
> **KHÔNG render thẳng từ `meta.json`** (đường dẫn trong đó là tương đối theo folder
> project, Remotion không đọc được qua `staticFile`).
>
> `--gl angle` BẮT BUỘC trên máy có GPU — thiếu nó Remotion dựng hình bằng software renderer,
> CPU 100% còn GPU 5%. Draft thêm `--crf 28 --x264-preset veryfast`. (Queue của backend tự thêm các flag này.)

2. **Kích thước/fps lấy từ manifest** — dùng `calculateMetadata` để set `width/height/fps/durationInFrames` động từ props, không hardcode trong `Root.tsx`.

3. **Video nhúng dùng `<OffthreadVideo>`**, không `<Video>` — render server-side ổn định và đúng frame hơn. Scene HyperFrames render ra fps nào thì manifest phải khai đúng fps đó; lệch fps giữa scene và composition là nguồn giật hình số một.

4. **Timeline = cộng dồn `durationInFrames`:**

```tsx
let from = 0;
scenes.map((s) => {
  const seq = (
    <Sequence key={s.id} from={from} durationInFrames={s.durationInFrames}>
      <SceneClip scene={s} />
    </Sequence>
  );
  from += s.durationInFrames - (s.transitionOverlap ?? 0);
  return seq;
});
```

Transition có overlap thì trừ overlap khi cộng dồn — quên trừ là hở khoảng đen giữa scene.

5. **Audio:**
   - Voice: một `<Audio src={voice}>` chạy suốt từ frame 0 — voice là xương sống sync, scene phải khớp theo voice chứ không ngược lại.
   - Sound effect: mỗi entry `sfx[]` một `<Sequence from={atFrame}><Audio volume={0.3}/></Sequence>`. Volume sfx mặc định 0.3 (thấp hơn voice ~10dB), chỉnh trong manifest bằng field `volume` nếu cần.
   - Không normalize/mix bằng FFmpeg thủ công sau render — mix trong Remotion để draft nghe giống final.

6. **Đường dẫn asset**: code Remotion chỉ load qua `staticFile()` — backend stage asset vào `engines/remotion/public/staging/<project>/` (hardlink) và ghi đường dẫn `staging/...` vào `props.resolved.json`; Remotion không bao giờ đọc đường dẫn tuyệt đối. Chạy trên Windows — luôn `path.join` phía backend, không nối chuỗi.

## Draft vs Final

| | Draft | Final |
|---|---|---|
| Lệnh | `--crf 28 --x264-preset veryfast` (+ `--concurrency 8 --gl angle`) | mặc định (crf 18) |
| Scene input | `renders/*.draft.mp4` | `renders/*.mp4` (quality standard) |
| Mục đích | duyệt nhịp, sync, transition | xuất bản |

Backend chọn bộ scene input theo type của job — code Remotion không phân biệt draft/final, chỉ nhận đường dẫn từ manifest.

## Lỗi đã biết & cách né

- **Giật/đơ hình ở ranh giới scene**: fps scene ≠ fps composition, hoặc `durationInFrames` trong manifest lệch với độ dài thật của MP4. Kiểm bằng `ffprobe -show_streams <file>` trước khi lắp.
- **Âm thanh lệch dần về cuối**: voice mp3 VBR → convert sang CBR/WAV trước khi đưa vào manifest (`ffmpeg -i voice.mp3 -ar 48000 voice.wav`).
- **Màu lệch giữa scene HyperFrames và footage**: cả hai engine render qua Chromium nên thường khớp; nếu lệch, kiểm footage có tag color space lạ (`bt709` là chuẩn) — transcode footage về bt709 trước.
- **Render treo trên Windows**: thường do đường dẫn có ký tự tiếng Việt/khoảng trắng trong tên file asset — đặt tên file asset ASCII kebab-case ngay từ khâu import.

## Giấy phép Remotion (nhớ khi triển khai)

Remotion miễn phí cho cá nhân và công ty ≤ 3 người; vượt mức cần Company License. Ghi chú này để cân nhắc khi mở rộng — không ảnh hưởng giai đoạn hiện tại.
