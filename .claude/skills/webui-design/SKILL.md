---
name: webui-design
description: Design system for the AI Edit Video web dashboard (noti.vn) - light/dark color tokens, Inter font, SVG icons, Shopify Admin style layout. MUST read before writing or modifying any UI in apps/web.
---

# Web UI Design System - AI Edit Video by noti.vn

The web UI is a **monitoring and management dashboard**, not a video editor. Aesthetic standard: Shopify Admin - minimal, high information density but still airy, every element has a reason to exist.

## 1. General principles

1. **Tokens first, hex never**: every color goes through CSS custom properties declared in `:root` and `[data-theme="dark"]`. Components never contain hex codes.
2. **Light is the default**, dark is opt-in. The toggle persists to `localStorage` and is applied via the `data-theme` attribute on `<html>`.
3. **Icons are 100% inline SVG** - Lucide set, stroke 1.5-2px, `currentColor` so they inherit text color. No icon fonts, no PNGs, no emoji as functional icons.
4. **Inter font** via the `@fontsource/inter` package, imported in `apps/web/src/app/layout.tsx` (weights 400/500/600/700). The package bundles the woff2 files at build time, so the font is self-hosted - never load fonts from a CDN at runtime.
5. Fixed metadata: title `AI Edit Video by: noti.vn`, description `Edit video tự động bằng AI`, favicon from `public/brand/favicon.png`.

## 2. Design tokens

```css
:root {
  /* Brand */
  --primary: #ed3c47;
  --primary-hover: #d62e3a;
  --primary-soft: #fdedef;
  --secondary: #ff7849;

  /* Surface */
  --bg: #ffffff;          /* page background */
  --bg-subtle: #f6f6f7;   /* sidebar, nested blocks, zebra rows */
  --surface: #ffffff;     /* card */
  --border: #e7e7ea;

  /* Text */
  --text: #101113;
  --text-muted: #5f6470;

  /* Semantic */
  --success: #16a34a;
  --success-bg: #e7f6ec;
  --danger: #e8590c;
  --danger-bg: #fbeee5;

  /* Shape & motion */
  --radius: 8px;
  --radius-lg: 12px;
  --shadow-card: 0 1px 2px rgba(16, 17, 19, 0.06);
  --transition: 150ms ease;
}

[data-theme="dark"] {
  --primary: #ed3c47;          /* brand color stays the same */
  --primary-hover: #f25560;    /* in dark, hover goes LIGHTER, not darker */
  --primary-soft: #3a1d20;
  --secondary: #ff7849;

  --bg: #131417;
  --bg-subtle: #1a1b1f;
  --surface: #1e1f24;
  --border: #2c2d33;

  --text: #f2f3f5;
  --text-muted: #9a9ea9;

  --success: #2ebd6b;
  --success-bg: #17301f;
  --danger: #f0742e;
  --danger-bg: #33231a;

  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.4);
}
```

Dark mode rule: only change token **values**, NEVER add dark-only tokens. Write the component once, it runs in both themes.

## 3. Brand assets

| File in `apps/web/public/brand/` | Download source | Used when |
|---|---|---|
| `logo-duong-ban.png` | https://noti.vn/image/new/logo-duong-ban.png | Header in light theme |
| `logo-am-ban.png` | https://noti.vn/image/new/logo-am-ban.png | Header in dark theme |
| `favicon.png` | https://noti.vn/image/new/favicon.png | `<link rel="icon">` |

The logo swaps with the theme at the same moment as the tokens (same `data-theme` listener).

## 4. Frame layout (Shopify Admin style)

```
┌────────────────────────────────────────────────┐
│ Topbar 56px: logo · page name · theme toggle · │
│ backend status (green/red dot)                 │
├─────────┬──────────────────────────────────────┤
│ Sidebar │  Content: FULL WIDTH, padding 20px,  │
│ 220px   │  cards spaced 12-16px apart          │
│ bg-     │  NO max-width - use all the space;   │
│ subtle  │  multi-column pages use a grid       │
└─────────┴──────────────────────────────────────┘
```

**Space rule (important):** never leave dead whitespace. The main working page (project detail)
is a multi-column workspace filling the full width; lists and tables stretch with the screen. Only
standalone forms (create project, edit skill) may cap their width for readability (~640px).

Sidebar (SVG icon + label, the active item gets `--primary-soft` background + `--primary` text) - 14 items (source of truth: `NAV` in `apps/web/src/components/Shell.tsx`):
- **Dashboard** (`/`) - overview: running jobs, recent projects, new errors
- **Videos Project** (`/projects`) - list of video projects + status + output preview
- **Images Project** (`/images`) - image generation projects (Gemini)
- **Auto cut** (`/auto-cut`) - cut a long video into short segments, each becoming a project
- **Text to video** (`/text-to-video`) - article/text → script → TTS → video sessions
- **Voices** (`/voices`) - cloned voice library (VieNeu), placed right under Text to video
- **Style Design** (`/styles`) - manage styles (color, font, effects) applied to videos/images
- **Render Queue** (`/queue`) - job queue, progress bar, log, cancel button
- **Assets** (`/assets`) - imports, footage, images, transcripts
- **Sound Effects** (`/sfx`) - library, inline preview playback
- **Prompts** (`/prompts`) - library of prompt templates
- **Skills** (`/skills`) - CRUD for skill markdown
- **Cấu hình** (`/config`) - render settings, concurrency
- **Kết nối** (`/connections`) - API keys for each provider (Claude, Gemini...)

## 5. Standard components

- **Primary button**: `--primary` background, white text, radius `--radius`, hover `--primary-hover`, height 36px, horizontal padding 16px. Secondary: `--surface` background, `--border` outline, `--text` label. Destructive: `--danger` text, `--danger-bg` background on hover.
- **Card**: `--surface` background, 1px `--border`, radius `--radius-lg`, shadow `--shadow-card`, padding 20px. Card title 14px/600 - do not use large headings.
- **Status badge** (job/project): `--success-bg` background with `--success` text (completed), `--primary-soft`/`--primary` (running), `--danger-bg`/`--danger` (error), `--bg-subtle`/`--text-muted` (queued). Full radius, 12px font, with a 6px dot.
- **Table**: header in `--text-muted` 12px uppercase, row hover `--bg-subtle`, horizontal `--border` rules, no vertical borders.
- **Progress bar** (render job): track `--bg-subtle`, fill `--primary`, height 6px, full radius; percentage and current step name on the right in `--text-muted`.
- **Typography**: body 14px/1.5; page title 20px/600; large figures 28px/700. Never use more than 2 heading levels on one page.

## 6. Realtime & state

- Job/agent state streams over SSE - the UI updates live, and never polls more than once per 5s for static data.
- Every list needs a decent empty state: muted SVG icon + one descriptive sentence + the primary action button.
- Errors render as a `--danger-bg` banner with a 3px `--danger` left border, including the raw log content (collapsible). NEVER swallow errors.

## 7. What NOT to do

- No flashy gradients, no glassmorphism, no decorative animation - the only motion allowed is the 150ms transition and the progress bar.
- Never use a color outside the token table (including Tailwind grays - map them to tokens).
- Never write hex CSS values in JSX/TSX.
- Never add video editor features to the web UI - all video processing lives in the backend/engine.
