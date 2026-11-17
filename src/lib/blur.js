/**
 * Local, zero-dependency webcam background blur.
 *
 * For each camera frame we estimate the background colour from the frame's
 * border (ignoring the bottom, where the subject usually is), build a soft
 * alpha mask from per-pixel colour distance, then composite a blurred
 * background with a sharp subject. This replaces a fixed circular vignette, so
 * the subject's head, hair and shoulders stay sharp instead of being clipped
 * by a circle.
 *
 * Frames are pulled with MediaStreamTrackProcessor and pushed into a manual
 * captureStream via requestFrame(), so processing follows the camera's frame
 * rate instead of requestAnimationFrame — the recording does not freeze when
 * the tab is in the background. Where that API is unavailable we fall back to
 * a video element driven by rAF.
 *
 * Approximate, local, no model and no network request.
 */

const ANALYSIS_W = 96
const ANALYSIS_H = 54
const GRID_W = 8
const GRID_H = 6
const THRESHOLD = 34

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value)
const lerp = (a, b, t) => a + (b - a) * t

/** Coarse background colour grid sampled from the frame's border. */
function buildBackgroundGrid(data, width, height) {
  const grid = new Array(GRID_W * GRID_H).fill(null)

  for (let gy = 0; gy < GRID_H; gy++) {
    // The bottom border often contains the subject's torso — never sample it.
    if (gy === GRID_H - 1) continue
    for (let gx = 0; gx < GRID_W; gx++) {
      if (gx !== 0 && gx !== GRID_W - 1 && gy !== 0) continue
      const x0 = Math.floor((gx * width) / GRID_W)
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / GRID_W))
      const y0 = Math.floor((gy * height) / GRID_H)
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / GRID_H))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 4
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          n++
        }
      }
      if (n) grid[gy * GRID_W + gx] = [r / n, g / n, b / n]
    }
  }

  // Fill un-sampled cells from their neighbours so the grid covers the frame.
  for (let pass = 0; pass < GRID_H; pass++) {
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const index = gy * GRID_W + gx
        if (grid[index]) continue
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = gx + dx
          const ny = gy + dy
          if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue
          const neighbour = grid[ny * GRID_W + nx]
          if (neighbour) {
            r += neighbour[0]
            g += neighbour[1]
            b += neighbour[2]
            n++
          }
        }
        if (n) grid[index] = [r / n, g / n, b / n]
      }
    }
  }

  const fallback = grid.find(Boolean) || [0, 0, 0]
  return grid.map((cell) => cell || fallback)
}

/** Bilinear background colour at a point in the analysis image. */
function sampleGrid(grid, x, y, width, height) {
  const fx = (x / Math.max(1, width - 1)) * (GRID_W - 1)
  const fy = (y / Math.max(1, height - 1)) * (GRID_H - 1)
  const x0 = Math.min(GRID_W - 1, Math.floor(fx))
  const y0 = Math.min(GRID_H - 1, Math.floor(fy))
  const x1 = Math.min(GRID_W - 1, x0 + 1)
  const y1 = Math.min(GRID_H - 1, y0 + 1)
  const tx = clamp01(fx - x0)
  const ty = clamp01(fy - y0)

  const c00 = grid[y0 * GRID_W + x0]
  const c10 = grid[y0 * GRID_W + x1]
  const c01 = grid[y1 * GRID_W + x0]
  const c11 = grid[y1 * GRID_W + x1]

  return [
    lerp(lerp(c00[0], c10[0], tx), lerp(c01[0], c11[0], tx), ty),
    lerp(lerp(c00[1], c10[1], tx), lerp(c01[1], c11[1], tx), ty),
    lerp(lerp(c00[2], c10[2], tx), lerp(c01[2], c11[2], tx), ty),
  ]
}

export function createBlurPipeline(sourceTrack) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  const sharp = document.createElement('canvas')
  const sharpCtx = sharp.getContext('2d')

  const analysis = document.createElement('canvas')
  analysis.width = ANALYSIS_W
  analysis.height = ANALYSIS_H
  const analysisCtx = analysis.getContext('2d', { willReadFrequently: true })

  const mask = document.createElement('canvas')
  mask.width = ANALYSIS_W
  mask.height = ANALYSIS_H
  const maskCtx = mask.getContext('2d')
  const maskImage = maskCtx.createImageData(ANALYSIS_W, ANALYSIS_H)
  let previousMask = new Float32Array(ANALYSIS_W * ANALYSIS_H)

  // Manual frame requests: the output track emits exactly one frame per
  // processed camera frame, independent of the tab's animation loop.
  const stream = canvas.captureStream(0)
  const outputTrack = stream.getVideoTracks()[0]

  let video = null
  let raf = 0
  let reader = null
  let stopped = false

  const draw = (source, width, height) => {
    if (stopped || !width || !height) return

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      sharp.width = width
      sharp.height = height
    }

    analysisCtx.drawImage(source, 0, 0, ANALYSIS_W, ANALYSIS_H)
    const data = analysisCtx.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H).data
    const grid = buildBackgroundGrid(data, ANALYSIS_W, ANALYSIS_H)
    const pixels = maskImage.data

    for (let y = 0; y < ANALYSIS_H; y++) {
      for (let x = 0; x < ANALYSIS_W; x++) {
        const i = (y * ANALYSIS_W + x) * 4
        const background = sampleGrid(grid, x, y, ANALYSIS_W, ANALYSIS_H)
        const distance = Math.hypot(
          data[i] - background[0],
          data[i + 1] - background[1],
          data[i + 2] - background[2],
        )
        const t = clamp01((distance - THRESHOLD * 0.6) / (THRESHOLD * 0.7))
        const current = t * t * (3 - 2 * t)
        const index = y * ANALYSIS_W + x
        // Temporal smoothing keeps the mask from flickering between frames.
        const alpha = previousMask[index] * 0.5 + current * 0.5
        previousMask[index] = alpha
        pixels[i] = 0
        pixels[i + 1] = 0
        pixels[i + 2] = 0
        pixels[i + 3] = Math.round(alpha * 255)
      }
    }
    maskCtx.putImageData(maskImage, 0, 0)

    // Blurred background, slightly oversized to hide blurred edge bleed.
    ctx.clearRect(0, 0, width, height)
    ctx.save()
    ctx.filter = 'blur(16px)'
    ctx.drawImage(source, -10, -10, width + 20, height + 20)
    ctx.restore()

    // Sharp subject, kept by the soft foreground-only mask.
    sharpCtx.clearRect(0, 0, width, height)
    sharpCtx.globalCompositeOperation = 'source-over'
    sharpCtx.drawImage(source, 0, 0, width, height)
    sharpCtx.globalCompositeOperation = 'destination-in'
    sharpCtx.imageSmoothingEnabled = true
    sharpCtx.imageSmoothingQuality = 'high'
    sharpCtx.drawImage(mask, 0, 0, width, height)
    sharpCtx.globalCompositeOperation = 'source-over'
    ctx.drawImage(sharp, 0, 0)
  }

  const startFallback = () => {
    if (stopped || video) return
    video = document.createElement('video')
    video.muted = true
    video.autoplay = true
    video.playsInline = true
    video.srcObject = new MediaStream([sourceTrack])
    video.play().catch(() => {})
    const loop = () => {
      if (stopped) return
      if (video.readyState >= 2) draw(video, video.videoWidth, video.videoHeight)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
  }

  if (typeof MediaStreamTrackProcessor !== 'undefined' && outputTrack?.requestFrame) {
    const processor = new MediaStreamTrackProcessor({ track: sourceTrack })
    reader = processor.readable.getReader()
    ;(async () => {
      try {
        while (!stopped) {
          const { value: frame, done } = await reader.read()
          if (done) break
          draw(frame, frame.displayWidth, frame.displayHeight)
          frame.close()
          try {
            outputTrack.requestFrame()
          } catch {
            /* track already stopped */
          }
        }
      } catch {
        if (!stopped) startFallback()
      }
    })()
  } else {
    startFallback()
  }

  return {
    stream,
    destroy() {
      if (stopped) return
      stopped = true
      cancelAnimationFrame(raf)
      try {
        reader?.cancel()
      } catch {
        /* ignore */
      }
      try {
        reader?.releaseLock()
      } catch {
        /* ignore */
      }
      reader = null
      if (video) {
        video.pause()
        video.srcObject = null
      }
      try {
        outputTrack?.stop()
      } catch {
        /* ignore */
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      sharpCtx.clearRect(0, 0, sharp.width, sharp.height)
      previousMask = null
    },
  }
}
