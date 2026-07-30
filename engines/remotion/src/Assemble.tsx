import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import {
  resolveSceneDurationInFrames,
  type Manifest,
} from "./manifest";
import { CaptionTrack } from "./components/CaptionTrack";
import { HighlightTrack } from "./components/HighlightTrack";
import { SceneClip } from "./components/SceneClip";
import { SfxTrack } from "./components/SfxTrack";
import { Transition } from "./components/Transition";

/**
 * Composition "Assemble" duy nhất — data-driven hoàn toàn từ manifest
 * (meta.json đã resolve đường dẫn staging, xem src/manifest.ts).
 *
 * Timeline: cộng dồn `from` theo durationInFrames từng scene, TRỪ
 * transitionOverlap khi chuyển scene (quên trừ là hở khoảng đen — skill
 * remotion-assemble). Scene sau nằm đè scene trước trong khoảng overlap,
 * crossfade do <Transition> xử lý bằng opacity.
 */
export const Assemble: React.FC<Manifest> = (manifest) => {
  const { scenes, audio, fps, captions, overlays } = manifest;

  let from = 0;
  const sequences = scenes.map((scene, index) => {
    const duration = resolveSceneDurationInFrames(scene, fps);
    // Crossfade của scene này do transitionOverlap của scene LIỀN TRƯỚC quyết định.
    const fadeInFrames = index > 0 ? (scenes[index - 1].transitionOverlap ?? 0) : 0;

    const sequence = (
      <Sequence key={scene.id} from={from} durationInFrames={duration}>
        <Transition fadeInFrames={fadeInFrames}>
          <SceneClip scene={scene} fps={fps} />
        </Transition>
      </Sequence>
    );

    from += duration - (scene.transitionOverlap ?? 0);
    return sequence;
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#101113" }}>
      {sequences}

      {/* Thẻ làm nổi bật key — trên footage, dưới phụ đề (nếu có cả hai thì
          phụ đề là lớp trên cùng vì nó đọc liên tục). Có phụ đề → `raised`
          đẩy band tier "sub" lên trên vùng caption để hai lớp không đè nhau. */}
      {overlays.length > 0 ? (
        <HighlightTrack overlays={overlays} raised={captions.length > 0} />
      ) : null}

      {/* Phụ đề karaoke nằm TRÊN mọi scene, dưới không có gì — overlay cuối cùng */}
      {captions.length > 0 ? <CaptionTrack captions={captions} /> : null}

      {/* Voice: xương sống sync — một track chạy suốt từ frame 0 */}
      {audio.voice ? <Audio src={staticFile(audio.voice)} /> : null}

      {/* Sound effects theo atFrame */}
      <SfxTrack sfx={audio.sfx} />
    </AbsoluteFill>
  );
};
