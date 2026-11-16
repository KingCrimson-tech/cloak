# Cloak

Privacy-first screen & webcam recorder. Cloak records your screen and webcam as
separate streams, then trims and composites them into a single shareable MP4 —
entirely on your machine. No server, no upload, no account, no telemetry.

> **Status:** under active development. See `spec.md` for the full product spec
> and phased build plan.

## Requirements

- Node.js 18+
- A secure context: `localhost` or HTTPS (browser media APIs require it)
- A Chromium-based browser (Chrome / Edge) is recommended

## Run locally

```bash
npm install
npm run dev
```

Open the printed `localhost` URL (e.g. `http://localhost:5173`).

## Build

```bash
npm run build
npm run preview
```

The production build is emitted to `dist/` and is a fully static bundle — no
runtime network requests beyond loading the app's own assets.

## Tech stack

- React + Vite (JavaScript only, no TypeScript)
- Zustand for state
- mediabunny for demux / decode / encode / mux
- Web Worker for export; Web Audio API for audio mixing
- `MediaRecorder` (WebM) for capture; MP4 output (H.264 + AAC)

## Privacy

No analytics, external fonts/scripts, or runtime fetches to third parties.
Everything is processed in-browser and stays on your device.
