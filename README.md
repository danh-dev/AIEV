# AIEV - AI Edit Video by [noti.vn](https://noti.vn)

🇬🇧 English · [🇻🇳 Tiếng Việt](README.vi.md)

> **Automatic AI video editing.** Claude acts as the director - driving **HyperFrames** (motion-graphics scenes built with HTML + GSAP) and **Remotion** (timeline assembly) - while you supervise everything through the web dashboard at `http://localhost:6868`.

Drop in a clip, briefly describe what you want, click **"Start editing with AI"** - the system automatically transcribes, writes the editing script, creates kinetic-typography scenes, karaoke subtitles, beat-synced zooms, timestamped sound effects, assembles the timeline and exports an MP4.

## Features

| | |
|---|---|
| 🎬 **AI video editing** | Claude analyzes the source → builds HyperFrames scenes → assembles with Remotion → MP4. Draft first, final later, every frame verified. |
| 🎨 **Style Design** | Multiple brand kits (colors, fonts, logo, tone, gradient/liquid-glass effects) - every output follows the selected style 100%. Just type a font name and it downloads from Google Fonts (full Vietnamese diacritics). |
| 🖼️ **AI image generation** | Gemini paints the background (no text) → Remotion places titles/logo/figures per the Style Design - Vietnamese text is never misspelled. |
| ✨ **In-video AI illustrations** | Claude picks key moments, Gemini draws style-matched illustrations and they're placed at exactly the right time (~$0.05/image). |
| 🔑 **Key layout** | The main key appears in the upper band of the video, related keys in the lower band synced to what's being said - AI suggests them or you specify. |
| 📝 **Vietnamese karaoke subtitles** | faster-whisper (GPU preferred) word timestamps, keyword highlighting, battle-tested fixes for missing diacritics. |
| 🎨 **Color grading with preview** | 14 presets + manual adjustments, per-frame preview; log/HDR footage is tonemapped automatically. |
| 🔊 **Sound effects** | Library of 100+ files with a curated set - AI inserts them to match the content rhythm and zoom beats. |
| 🧠 **Skills** | Production know-how accumulated as markdown, managed in the web UI; includes **AI-powered skill creation** from a question form. |
| ⚡ **Hardware acceleration** | Auto-detects the GPU (NVENC on NVIDIA, VideoToolbox on macOS), parallel rendering, `--gl angle`. |
| 📊 **Dashboard** | Realtime progress (SSE), render queue, AI tokens by day/project type (in/out), AI sessions auto-resume after interruptions. |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Web UI (Next.js, port 6868)                        │
│  Dashboard · Videos/Images Project · Style Design   │
│  Render Queue · Sound Effects · Skills · Settings   │
└──────────────────────┬──────────────────────────────┘
                       │ REST + SSE
┌──────────────────────┴──────────────────────────────┐
│  Backend (Express, port 6869)                       │
│  Claude Agent SDK · Render queue · SQLite           │
└──────┬──────────────────────────────┬───────────────┘
┌──────┴───────────┐        ┌─────────┴────────────┐
│ HyperFrames      │  MP4   │ Remotion             │
│ SCENE ENGINE     │───────▶│ ASSEMBLER            │
│ HTML + GSAP      │        │ scene + audio + sub  │
└──────────────────┘        └──────────────────────┘
```

Full API contract: [`docs/API.md`](docs/API.md). Production workflow + know-how: [`.claude/skills/`](.claude/skills/).

## Requirements

- **Node.js 20+**
- **FFmpeg** on PATH (macOS: `brew install ffmpeg`)
- **Google Chrome** (HyperFrames and Remotion render through headless Chromium)
- **Claude**: sign in to [Claude Code](https://claude.com/claude-code) on this machine (uses subscription OAuth - recommended) *or* put `ANTHROPIC_API_KEY` in `.env`
- **Gemini** (only needed for image generation): `GEMINI_API_KEY` in `.env` - get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- Optional: an NVIDIA GPU (NVENC) or Apple Silicon Mac (VideoToolbox) for faster rendering; Python + `faster-whisper` for subtitles

## Getting started

```bash
git clone https://github.com/giapducthang/AIEV.git
cd AIEV
```

**Windows** - double-click `start\start.bat` (or run `start\start.ps1`).

**macOS / Linux**
```bash
chmod +x start/start.sh start/stop.sh   # first time only
./start/start.sh
```

The script handles everything: checks the environment → `npm install` (first run) → build → creates `.env` → starts server + web → opens `http://localhost:6868`. Stop with `start\stop.bat` / `./start/stop.sh`.

Manual dev run: `npm install` then `npm run dev`.

## Upload from your phone

On a project page, in the **Sources & Assets** card click **Connect phone** - scan the QR code with your phone camera (same WiFi as the machine running the system) to open the upload page `http://<machine-ip>:6868/m/<project>`. Videos/photos picked on the phone upload straight into the project's assets. The first time Windows asks about the firewall, choose **Allow** (the start script adds the rule automatically when it has admin rights).

**Remote over 4G/5G** (not on the same WiFi):
- **Tailscale** - install it on the machine running the system + your phone, then pick the `100.x` IP in the Connect phone modal; the QR works exactly like on the LAN.
- **Cloudflare Tunnel** (recommended) - fill `TUNNEL_DOMAIN=<your-domain>` (e.g. `aiev.noti.vn`) into `.env`, then the Connect phone QR automatically uses `https://<domain>/m/<project>` - works over 4G/5G.
- Start the tunnel with `start\tunnel.bat` (Windows) / `./start/tunnel.sh` (macOS) - no `TUNNEL_DOMAIN` yet and it falls back to a quick tunnel with a random `trycloudflare.com` URL.
- ⚠️ **Warning**: the dashboard has no login yet - only expose it publicly behind Cloudflare Access, or never share the link.

## Folder structure

```
├── apps/web/          # Next.js dashboard (port 6868)
├── apps/server/       # Express backend: Agent SDK + render queue + SQLite (port 6869)
├── engines/remotion/  # Remotion: Assemble (video) + Poster (image) compositions
├── .claude/skills/    # Skills - production know-how, manageable from the web UI
├── assets/
│   ├── sound-effects/ # Sound-effect library + library.json
│   ├── styles/        # Style Design (styles.json + fonts/logos)
│   └── prompts/       # Prompt templates
├── video-projects/    # One folder per video (not committed)
├── image-projects/    # Image-generation projects (not committed)
├── outputs/           # Final videos (not committed)
├── start/             # Startup scripts for Windows (.bat/.ps1) + macOS/Linux (.sh)
└── docs/API.md        # API contract - the single source of truth
```

## Tech stack

Next.js 16 · React 19 · Tailwind 4 · Express 5 · better-sqlite3 · [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk) · [HyperFrames](https://www.npmjs.com/package/hyperframes) · [Remotion](https://remotion.dev) · Gemini API · faster-whisper · FFmpeg

> License note: Remotion is free for individuals and companies of up to 3 people - beyond that you need a [Company License](https://remotion.pro).

---

Made with ❤️ by **noti.vn** - Claude directs, humans approve.
