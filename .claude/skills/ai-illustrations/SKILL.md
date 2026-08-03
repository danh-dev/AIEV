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

## The brand logo is NEVER generated

If the selected Style Design has a logo, the real file is copied into the project at
`assets/brand-logo.<ext>` before the edit session starts, and the edit prompt carries a mandatory
LOGO block. Rules:

- Insert **that exact image file** (`<img>` in a HyperFrames scene, or `srcImage`/overlay in Remotion).
- Never redraw the logo in CSS/SVG/shapes, never ask Gemini for it, and never substitute the brand
  name set in a font. A typeset name where a logo belongs is a brand violation, not a fallback.
- Only size and position may change: no distortion, recolouring, rotation, cropping, or added
  borders/shadows on the mark itself.
- If it genuinely cannot be placed, say so in the final report instead of improvising.

**Symptom:** Gemini renders an invented logo - a glossy monogram on a wall, a mark on a t-shirt or phone screen.
**Cause:** the scene prompt mentioned a logo, which flipped the permissive "decorative brand logos are allowed"
clause on. Adding a prohibition alongside it is **not enough** - measured: with both clauses present the model
followed the permissive one and drew an "N" monogram.
**Fix (already in `buildImagePrompt`):** when `design.logoPath` exists the permissive branch is dropped entirely,
the prohibition tells the model to leave that surface *blank*, and it is repeated as a FINAL RULE at the end of
the prompt. Verified on three hard prompts (logo on a wall / on a t-shirt / on a phone screen): all three came
back with a clean empty surface, which is exactly what you want to composite the real logo onto.
So: **do not write "with the brand logo" into an illustration prompt.** Ask for the blank surface you need
(an empty plaque, a blank screen) and place the real file on top yourself.

**The corner logo is automatic.** When the style has a logo, the assemble step stamps it top-left over the
whole video (`manifest.watermark`). Do not add your own corner logo as well - that yields two overlapping
marks. Place the logo by hand only where you deliberately want it (intro card, end card, a framed mention).

## Other companies' logos - use the library, never draw them

`assets/brand-logos/` holds official brand marks with each brand's official hex colour;
`assets/brand-logos/library.json` is the index - read it rather than guessing file names. The library grows
by itself: any brand a video mentions gets fetched once and stays for every later video.

**Workflow:** read the script, list every brand it names, and resolve each one *before* building the scene
that mentions it.

- Need Facebook / TikTok / Claude / Gemini in a scene? **Use the file.** Never redraw a third-party logo and
  never ask Gemini for one; a wrong brand mark is spotted instantly.
- **Copy the file into the project's `assets/` first**, then reference it. Remotion only stages paths inside
  the project, so pointing straight at `assets/brand-logos/` renders a 404.
- The SVGs are single-colour (black by default). To recolour, inline the SVG and set `fill` - use the official
  hex from `library.json`, or plain white/black when the background demands it.
- **Brand not in the library? Fetch it, do not skip it.** `POST http://localhost:6869/api/brand-logos`
  with `{"name":"OpenAI"}`. The server looks in Simple Icons, then Wikidata's P154 "logo image" property,
  downloads the official file into `assets/brand-logos/`, and returns `relPath`. 201 = newly fetched,
  200 = already there. Brands missing from Simple Icons because their owners asked to be removed
  (OpenAI, Amazon, Microsoft…) come back from Wikidata in **full colour**.
- Only a `404 BRAND_LOGO_NOT_FOUND` justifies going without: then set the brand name in the Style Design
  font and record it in the final report. **Never** draw, improvise or generate a brand logo - in any case.
- CC0 covers the *files*, not the trademarks. Referring to a brand is fine; implying it sponsors or endorses
  the video is not.

## Known issues

- Generating an image and forgetting to composite it - final checklist: every image in `assets/illustrations/` must
  either appear in the composition or be deleted (do not leave orphan images that wasted money).
- Overly generic prompts ("technology background") -> lifeless images. Describe specific objects/setting/camera angle.
- The SAME image need across multiple scenes -> generate one image and reuse it, do not call the API twice.
