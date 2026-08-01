---
name: auto-cut
description: Cut silences and dead weight (fillers, repeated takes, false starts) out of a talking-head video BEFORE building the edit - the ffmpeg silencedetect + transcript-analysis workflow, remapping word timestamps after the cut, and the mandatory verification with a second silencedetect pass. Read this when the brief enables "Tự động cắt ngắn video" (autoCut) or the user complains that the video still has dead weight/silences.
---

# Auto-Cut - verified silence & dead-weight trimming

## Principles

1. **Cut BEFORE building scenes/captions.** Cutting afterwards throws off every timestamp
   (captions, zooms, SFX). Output of this step: `assets/face.cut.mp4` + the remapped transcript -
   every later step uses the cut version.
2. **Cutting is MANDATORY when the brief enables autoCut** - it is not a suggestion. If nothing
   can be cut, you must state a concrete reason (the video was already tight) in the report.
3. Two kinds must be cut: **silences** (measured by machine) and **content dead weight**
   (read the transcript: fillers "ừm/à/kiểu/thì là", a sentence flubbed then restated - keep the LAST
   take, false starts, rambling and repeated points).

## Step 1 - Measure the silences (ffmpeg, objective)

```bash
ffmpeg -i assets/face.mp4 -af silencedetect=noise=-30dB:d=0.45 -f null - 2>&1 | grep silence_
```
- Every `silence_start`/`silence_end` pair is a cut candidate. Silences **< 0.45s stay** (breathing room).
- When cutting, **keep 0.18s of padding on each edge** (start+0.18 → end−0.18) - cutting flush at 0 clips the breath and sounds robotic.
- Noisy footage (cafes, outdoors) -> raise the threshold to `-25dB` and measure again.
- ⚠️ The silence at the START of the video (before the first word) should be cut entirely except for ~0.2s - a real bug we hit: a video opening with
  1–2s of silence killed the hook.

## Step 2 - Dead weight from the transcript

Once transcribed (with word timestamps), go through it sentence by sentence:
- A filler standing on its own ("ừm", "à", "ờ", "kiểu như là") -> cut the whole cluster using the word timestamps.
- A restated sentence (near-identical content, usually adjacent) -> keep the LAST take, cut the earlier ones.
- Long-winded greetings/preamble that serve no content -> propose cutting them (list them in a table so the user can see).
- Cut aggressiveness follows the brief: default = silence >=0.45s + fillers + flubbed sentences + repeated points; if the user wants "natural"
  -> only silences >=1s; if the user wants "tight/fast-paced" -> 0.3s + also cut the preamble.

### Step 2b - REPEATED POINTS (AI reads the speech - mandatory, this is the "dead weight" users notice most)

Machine measurement cannot catch this kind - you have to READ the whole transcript as a piece of speech and analyze it semantically:

1. **Group sentences that make the SAME POINT** - the words need not match, only the content (a speaker often restates
   one point 2–3 times: short/stumbling the first time, more complete later). Consider NON-adjacent sentences too (says point A,
   rambles, then comes back to point A in more detail).
2. **Keep exactly ONE version per group - the MOST COMPLETE one**:
   - An earlier short version and a later LONGER/more complete restatement -> **keep the later one**, cut the earlier.
   - A later sentence that is only a short echo of the earlier one ("đúng vậy, như tôi nói...") -> keep the earlier, cut the echo.
   - Two equivalent versions -> keep the smoother delivery (fewer stumbles, no fillers).
3. **Check the flow after cutting**: re-read the cut transcript end to end - the kept sentences
   must connect smoothly with no missing context (if a kept sentence refers back ("như vừa nói") to a sentence you cut
   -> either keep both, or pick the version without the back-reference).
4. **Build a table before cutting** (put it in the report/NOTES): `timestamp | sentence cut | reason | sentence kept` -
   so the user can review every cut decision.

## Step 3 - Cut in one pass with filter_complex

Merge every KEEP range into a keep-list `[(start,end)...]`, then cut and stitch with a SINGLE
`trim/atrim + setpts/asetpts + concat` command, re-encoding cleanly to `face.cut.mp4`
(full pattern + timestamp remapping: see the "CẮT HI-LIGHT" section of the `noti-tiktok-vn` skill).

**Word timestamp remapping is mandatory:** for each kept range store the cumulative `shift`;
`new = orig − shift`; drop words that fall inside a cut range -> new transcript. From this point on, captions/zooms/SFX
use ONLY the remapped transcript.

## Step 4 - VERIFY (mandatory, this is where every "there is still dead weight" bug slips through)

1. **Re-measure the cut version**: run silencedetect again on `face.cut.mp4` - there must be no silence
   > 0.8s left (except deliberate pauses at topic changes). If there is -> go back to step 3.
2. **Compare durations**: `ffprobe` original vs cut - state it explicitly in the final report:
   seconds removed (from A to B), number of segments, split into silence segments vs dead-weight segments. Without those numbers the job is not done.
3. **Listen to 3 random cut edges**: extract 2s around an edge (`ffmpeg -ss <edge> -t 2`) and listen -
   no clipped words, no jumps. Clipped -> widen the padding on that edge.

## Known issues

- Using the OLD transcript after cutting -> captions drift further out of sync toward the end. Always re-transcribe or remap.
- Cutting only silences and ignoring flubbed sentences - what users call "dead weight" is mostly this kind.
- Cutting the rendered draft instead of the source -> quality drops from a second encode. Always cut from the source.
- SFX/narration files with their own lead silence -> use `data-media-start` to trim inside HyperFrames
  (see the noti-tiktok-vn skill), do not re-encode an audio file just for 0.3s of leading silence.
