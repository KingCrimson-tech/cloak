/**
 * Local, zero-dependency background blur for the webcam.
 *
 * A hidden video feeds a hidden canvas. Each animation frame we draw a heavily
 * blurred copy of the frame, then composite a sharp centre kept by a soft
 * radial gradient mask. The result is exposed through `canvas.captureStream(30)`.
 * No model is downloaded and no network request is made: this is an
 * approximate portrait-style blur, not true person segmentation.
 */

export function createBlurPipeline(sourceTrack) {
  const video = document.createElement('video')
  video.muted = true
  video.autoplay = true
  video.playsInline = true
  video.srcObject = new MediaStream([sourceTrack])

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  // Reusable buffer for the feathered sharp centre.
  const mask = document.createElement('canvas')
  const maskCtx = mask.getContext('2d')

  const stream = canvas.captureStream(30)
  let raf = 0
  let stopped = false

  const draw = () => {
    if (stopped) return

    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const width = video.videoWidth
      const height = video.videoHeight

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        mask.width = width
        mask.height = height
      }

      const cx = width / 2
      const cy = height / 2
      const radius = Math.min(width, height) * 0.34

      // 1. Blurred background (slightly zoomed to hide blurry edges).
      ctx.clearRect(0, 0, width, height)
      ctx.save()
      ctx.filter = 'blur(14px)'
      ctx.drawImage(video, -8, -8, width + 16, height + 16)
      ctx.restore()

      // 2. Sharp centre, feathered with a radial alpha mask.
      maskCtx.clearRect(0, 0, width, height)
      maskCtx.globalCompositeOperation = 'source-over'
      maskCtx.drawImage(video, 0, 0, width, height)
      maskCtx.globalCompositeOperation = 'destination-in'
      const gradient = maskCtx.createRadialGradient(
        cx,
        cy,
        radius * 0.45,
        cx,
        cy,
        radius,
      )
      gradient.addColorStop(0, 'rgba(0,0,0,1)')
      gradient.addColorStop(0.65, 'rgba(0,0,0,0.9)')
      gradient.addColorStop(1, 'rgba(0,0,0,0)')
      maskCtx.fillStyle = gradient
      maskCtx.fillRect(0, 0, width, height)
      maskCtx.globalCompositeOperation = 'source-over'

      ctx.drawImage(mask, 0, 0)
    }

    raf = requestAnimationFrame(draw)
  }

  video.play().catch(() => {})
  raf = requestAnimationFrame(draw)

  return {
    stream,
    destroy() {
      if (stopped) return
      stopped = true
      cancelAnimationFrame(raf)
      video.pause()
      video.srcObject = null
      stream.getTracks().forEach((track) => track.stop())
    },
  }
}
