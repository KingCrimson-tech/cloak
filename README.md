# Cloak

**Privacy-first screen & webcam recorder.** Cloak records your screen and webcam as
separate streams, then trims and composites them into a single shareable MP4 —
entirely on your machine. No server, no upload, no account, no telemetry.

Everything runs in the browser: decoding, compositing, encoding and muxing all
happen locally with [mediabunny](https://mediabunny.dev/) and the Web Platform
APIs. The only network requests are the ones your browser makes to load the
app's own static assets.

## Requirements

- Node.js 18+
- A **secure context**: `localhost` or HTTPS (required by `getDisplayMedia` /
  `getUserMedia`)
- A Chromium-based browser (Chrome / Edge recommended) with WebCodecs H.264
  and AAC encoders

## Commands

```bash
npm install       # install dependencies
npm run dev       # start the dev server on localhost
npm run build     # produce a static bundle in dist/
npm run preview   # serve the production build locally
npm test          # run pure-logic unit tests (timeline / geometry math)
```

Deploy the contents of `dist/` to any static host served over HTTPS.

## How it works

### Two recordings, not a live composite

Screen and camera are captured as **two separate WebM files** by two
`MediaRecorder` instances. A live `requestAnimationFrame` canvas composite would
be throttled when the user switches to the app they are demoing — exactly when
they need it. `MediaRecorder` is not throttled because `getDisplayMedia()`
captures at OS level. Compositing is deferred to export time in a Web Worker.

```
screen stream ──► MediaRecorder ──► screen.webm  (video + mixed audio)
webcam stream ─► MediaRecorder ──► cam.webm     (video only)
                                        │
                    ┌───────────────────┘
                    ▼  (export worker)
     mediabunny: demux → decode → cut pauses → trim → composite PiP
                 → rebase timestamps → encode H.264/AAC → mux → MP4 blob → download
```

Mic and system audio are mixed into one track with the Web Audio API
(`MediaStreamAudioSourceNode`s → `MediaStreamDestination`) and attached only to
the screen recording.

### Active-time timebase

Wall-clock time minus paused spans is the app's authoritative timebase. It is
used for the capture timer, preview duration, trim bounds, waveform and the
exported timestamps. The export worker converts active time back to wall-clock
source ranges, skips paused ranges for both video and audio, and rebases output
timestamps to zero — so pauses leave no frozen frames or silence.

The camera starts a fraction of a second after the screen; `offsetSec` records
that difference so camera frames can be looked up at `sourceTime - offsetSec`.

### PiP geometry

`pip = { x, y, size, mirror }` is the single source of truth. `(x, y)` is the
circle centre normalized to the frame, `size` is the diameter as a fraction of
frame width. The live preview, the draggable/resizable review overlay, corner
presets and the export worker all consume the same geometry.

### Local background blur

When enabled, the camera track is routed through a hidden canvas. For each
frame the background colour is estimated from the frame's border (ignoring the
bottom, where the subject usually is) and a soft alpha mask is built from
per-pixel colour distance. A blurred background is composited with a sharp
subject — there is no fixed circular vignette, so hair and shoulders stay
sharp. Frames are pulled with `MediaStreamTrackProcessor` and pushed through
`canvas.captureStream(0)` via `requestFrame()`, so the processed stream follows
the camera's frame rate rather than the tab's animation loop and does not
freeze when you switch tabs. The processed track feeds both the live PiP and
the camera recorder; the original mic audio is preserved. No model is fetched.

## Module map

```
src/
  App.jsx                 flow orchestration, capture timer, export/download UI
  store.js                Zustand state machine, blobs/URLs, PiP geometry, settings
  lib/
    capture.js            streams, audio mix, two recorders, pause bookkeeping
    blur.js               on-device background blur pipeline
    waveform.js           decode audio → normalized amplitude peaks
    timeline.js           active/wall time conversion + PiP clamping helpers
    exporter.js           worker bridge, error description, download filename
    export.worker.js      pause-aware trim + PiP composite + H.264/AAC mux
  components/
    LiveView.jsx          live screen + webcam PiP, timer, paused badge
    Review.jsx            recorded preview, draggable PiP, trim, seek
    Waveform.jsx          peak canvas, trim handles, playhead
    Settings.jsx          corner presets, size, mirror, quality
    ErrorBanner.jsx       errors and warnings
  styles.css
```

## Privacy & cleanup

- No analytics, external fonts/scripts, or runtime fetches to third parties.
- Every native resource is released on success and error paths: media tracks,
  `AudioContext`, the blur RAF loop, `VideoSample`s, object URLs and the export
  worker. Object URLs are revoked when replaced or on reset.
- A permission denial falls back to a screen-only recording with a warning; a
  browser "Stop sharing" click ends the recording cleanly.

## Verification

Automated (`npm test`) covers the pure timebase and geometry logic: active-time
conversion, pause ranges (including pause-then-stop), clamped bounds, trim from a
non-zero start with timestamp rebasing, all four PiP corners, size limits and
mirror-invariant export geometry. `npm run build` must also pass and produce only
static assets.

The following need a real browser and cannot be automated here:

- Chrome / Edge end-to-end: record → pause/resume → stop → trim → export → download
- Playback of `screen.webm` with both mic and system audio, and with camera denied
- Clicking the browser's "Stop sharing" mid-record
- Waveform display with and without audio, and scrubbing with trim handles
- Background blur on/off, confirming no camera indicator is left on
- Memory stability across repeated recordings

Firefox and Safari are not primary targets: they may lack the H.264/AAC
encoders or WebM decoding that the export pipeline needs. Unsupported codecs
surface as a readable error rather than a silent failure.

## Known limits

- **Chrome/Edge first.** Other browsers may lack the required H.264/AAC
  encoders or WebM decoding; codec failures surface as a readable error.
- **Blur is a colour heuristic.** It works best against fairly uniform
  backgrounds (a plain wall, for example). Busy or multi-colour backgrounds can
  cause parts of the subject to be blurred or parts of the background to stay
  sharp. It is not person segmentation and downloads no model. Browsers without
  `MediaStreamTrackProcessor` use an rAF fallback that may freeze in background
  tabs; Chrome/Edge use the frame-driven path.
- **Everything is in memory.** Recordings and the final MP4 are held in RAM as
  Blobs. Very long recordings can use a lot of memory; a full 5-minute session
  is a realistic ceiling on modest hardware.
- **WebM intermediate.** Capture produces WebM because that is what
  `MediaRecorder` supports; the MP4 is created only at export time.
- **Approximate blur.** The local effect is a feathered radial blur, not true
  person segmentation.
- **Single PiP layout, local download only.** Streaming to disk via the File
  System Access API and multiple PiP layouts are deferred beyond v1.
