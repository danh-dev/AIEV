---
name: ai-illustrations
description: Generate illustrations with Gemini and composite them into the video being edited - how to pick the moments that need an image, write the prompt, call the /api/illustrations endpoint (images MUST match the selected Style Design), and composite into the composition. Read when the brief enables "Ảnh minh họa AI" (AI illustrations) or the user asks for generated illustrations for a video.
---

# AI Illustrations - Claude directs, Gemini draws, brand stays consistent

## Directing principles

1. **Pick moments deliberately, do not sprinkle images everywhere.** Read the transcript/video content and
   choose 2-5 points where an illustration explains more than the words do: abstract concepts, key numbers,
   a product/setting being mentioned, before-vs-after comparisons. DO NOT illustrate talking-head passages
   that already hold attention on their own.
2. **Each image costs ~$0.05-0.07** - treat it as real money. A short video (<60s) usually needs only 2-4 images.
3. **Illustrations are BACKGROUND visuals - no text by default.** The server already bans text in the prompt;
   numbers and labels are placed on top by HyperFrames/Remotion (correct font + brand color, no typos). The only
   exception: the brief enables "Ảnh có chữ" (`illustrationText`) or the edit prompt says "ĐƯỢC PHÉP CÓ CHỮ"
   (text allowed) -> see the "Images with text (allowText)" section below.
4. **Style Design is LAW - follow it 100%, no exceptions.** Every illustration must match the project's
   selected style: ALWAYS pass `styleId` (from the STYLE DESIGN section of the edit prompt). The server has a
   safety net (if `styleId` is missing it falls back to the style in the project brief), but NEVER rely on it.
   If any skill or prompt suggests a different palette -> IGNORE it, the style wins.

## Calling the image generation API (the server must be running - always true when editing through the system)

```bash
curl -s -X POST http://localhost:6869/api/illustrations \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "<id of the video project>",
    "name": "khai-niem-mcp",
    "prompt": "3D illustration of interconnected glass puzzle pieces forming a network, representing an integration protocol",
    "aspect": "9:16",
    "model": "<model from the brief, omit the field to use the default>",
    "styleId": "<styleId from the STYLE DESIGN section of the edit prompt - MUST be passed when present>",
    "description": "Minh họa khái niệm MCP - ghép vào lúc 12.5s khi nói về kết nối dữ liệu"
  }'
```

- Images are saved to `video-projects/<id>/assets/illustrations/<name>.png`, and the description is written into assets.json automatically.
- **Write the prompt in English and DESCRIBE THE SCENE CONTENT** - do not add brand colors/tone (the server
  mixes the Style Design in itself), and do not instruct "no text" (the server adds that itself).
- `aspect` must match the video frame (vertical video -> "9:16"). If it fails with a missing GEMINI_API_KEY, tell
  the user to enter the key on the "Kết nối" (Connections) tab and move on to another part of the video - do not get stuck.
- `description` MUST always state which point the image illustrates + the second it is expected to be composited at.

## Images with text (allowText)

Only use this when the brief enables `illustrationText` (the edit prompt says "Ảnh minh họa ĐƯỢC PHÉP CÓ CHỮ")
or the user explicitly asks for it. How to do it:

- Pass `"allowText": true` in the POST /api/illustrations body. If the field is missing the server falls back to
  the project's `brief.illustrationText` - but NEVER rely on that, pass it explicitly.
- In the prompt, spell out the EXACT Vietnamese text you want to appear (3-6 words, correct spelling, all diacritics),
  e.g. `... with the exact Vietnamese headline "TĂNG TRƯỞNG 300%"`. Never let Gemini invent the text itself.
- **You MUST verify the spelling after generation**: Read the image file and inspect every character and Vietnamese
  diacritic. Gemini often mangles diacritics (Ề->E, ữ->u) or adds garbage text. If it is wrong -> regenerate (rephrase
  the prompt if it keeps failing), or give up after 2-3 attempts and generate a text-free version (`allowText:false`),
  then let HyperFrames/Remotion place the text as usual.
- If the text is already inside the image, DO NOT overlay duplicate text with HyperFrames/Remotion.

## Compositing into the video

- HyperFrames: insert `<img src="assets/illustrations/<file>.png">` in the scene, animate it in and out
  (gentle fade/slide/scale per MOTION_PHILOSOPHY), and hold it 2-4 seconds around the exact sentence it relates to.
- Sensible coverage: an illustration usually covers 50-75% of a vertical frame and MUST NOT cover the speaker's face
  mid-way through an important sentence; bring it in on the sentence beat (use transcript timestamps).
- Verify with a snapshot after inserting: image in the right place, not distorted (aspect ratio preserved), not bleeding off the edge.

## Known issues

- Generating an image and forgetting to composite it - final checklist: every image in `assets/illustrations/` must
  either appear in the composition or be deleted (do not leave orphan images that wasted money).
- Overly generic prompts ("technology background") -> lifeless images. Describe specific objects/setting/camera angle.
- The SAME image need across multiple scenes -> generate one image and reuse it, do not call the API twice.
