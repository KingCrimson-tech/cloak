import { useEffect, useRef } from 'react'
import { useStore } from '../store.js'
import { formatTime } from '../lib/timeline.js'

/** Position a square PiP from the normalized { x, y, size } geometry. */
export function pipStyle(pip) {
  return {
    left: `${pip.x * 100}%`,
    top: `${pip.y * 100}%`,
    width: `${pip.size * 100}%`,
    aspectRatio: '1 / 1',
    transform: 'translate(-50%, -50%)',
  }
}

export default function LiveView({ screenStream, camStream, elapsed, paused, pip }) {
  const frameAspect = useStore((s) => s.frameAspect)
  const setFrameAspect = useStore((s) => s.setFrameAspect)

  const screenRef = useRef(null)
  const camRef = useRef(null)

  useEffect(() => {
    if (screenRef.current) screenRef.current.srcObject = screenStream || null
  }, [screenStream])

  useEffect(() => {
    if (camRef.current) camRef.current.srcObject = camStream || null
  }, [camStream])

  // Pausing the elements displaying the live streams freezes the visible
  // frames too, not just the timer — resuming restores both previews.
  useEffect(() => {
    for (const ref of [screenRef, camRef]) {
      const video = ref.current
      if (!video) continue
      if (paused) video.pause()
      else video.play().catch(() => {})
    }
  }, [paused, screenStream, camStream])

  return (
    <div className="stage" style={{ aspectRatio: frameAspect }}>
      <video
        ref={screenRef}
        className="stage__screen"
        autoPlay
        playsInline
        muted
        onLoadedMetadata={(e) => {
          const video = e.currentTarget
          if (video.videoWidth && video.videoHeight) {
            setFrameAspect(video.videoWidth / video.videoHeight)
          }
        }}
      />

      {camStream && (
        <div className="stage__pip" style={pipStyle(pip)}>
          <video
            ref={camRef}
            className="stage__pip-video"
            style={{ transform: pip.mirror ? 'scaleX(-1)' : 'none' }}
            autoPlay
            playsInline
            muted
          />
        </div>
      )}

      <div className="hud hud--timer" aria-label="Recording time">
        <span className={paused ? 'hud__dot hud__dot--paused' : 'hud__dot'} />
        {formatTime(elapsed)}
      </div>
      {paused && <div className="stage__pause-veil" aria-hidden="true" />}
      {paused && <div className="hud hud--badge">Paused</div>}
    </div>
  )
}
