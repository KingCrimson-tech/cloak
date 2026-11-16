import { useCallback, useRef, useState } from 'react'
import { useStore } from '../store.js'
import {
  activeToSource,
  clamp,
  clampPipPosition,
  formatTime,
  maxPipSize,
} from '../lib/timeline.js'
import { pipStyle } from './LiveView.jsx'
import Settings from './Settings.jsx'

/**
 * Playback + trim review. The screen recording is the timeline authority; the
 * webcam preview is kept in sync by offsetting its `currentTime` by the measured
 * recorder start offset. Trim bounds use active time (pauses removed).
 *
 * The PiP's { x, y, size, mirror } live in the store and are the single source
 * of truth for the live preview, this overlay and the export worker.
 */
export default function Review() {
  const screenUrl = useStore((s) => s.screenUrl)
  const camUrl = useStore((s) => s.camUrl)
  const offsetSec = useStore((s) => s.offsetSec)
  const activeDuration = useStore((s) => s.activeDuration)
  const keptRanges = useStore((s) => s.keptRanges)
  const trim = useStore((s) => s.trim)
  const pip = useStore((s) => s.pip)
  const frameAspect = useStore((s) => s.frameAspect)
  const setTrim = useStore((s) => s.setTrim)
  const setPip = useStore((s) => s.setPip)
  const setFrameAspect = useStore((s) => s.setFrameAspect)

  const screenRef = useRef(null)
  const camRef = useRef(null)
  const stageRef = useRef(null)
  const [interacting, setInteracting] = useState(false)

  const syncCam = useCallback(() => {
    const screen = screenRef.current
    const cam = camRef.current
    if (!screen || !cam) return
    const target = Math.max(0, screen.currentTime - offsetSec)
    if (Math.abs(cam.currentTime - target) > 0.15) {
      try {
        cam.currentTime = Math.min(target, cam.duration || target)
      } catch {
        /* seek may fail before metadata loads */
      }
    }
    if (screen.paused || screen.ended) cam.pause()
    else cam.play().catch(() => {})
  }, [offsetSec])

  // Attach global pointer listeners and guarantee cleanup on every path.
  const beginInteraction = useCallback((onMove) => {
    setInteracting(true)
    const move = (event) => onMove(event)
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      setInteracting(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }, [])

  const startMove = useCallback(
    (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      const rect = stageRef.current.getBoundingClientRect()
      const origin = { x: pip.x, y: pip.y }
      const startX = event.clientX
      const startY = event.clientY

      beginInteraction((moveEvent) => {
        const next = clampPipPosition(
          origin.x + (moveEvent.clientX - startX) / rect.width,
          origin.y + (moveEvent.clientY - startY) / rect.height,
          pip.size,
          frameAspect,
        )
        setPip(next)
      })
    },
    [beginInteraction, frameAspect, pip, setPip],
  )

  const startResize = useCallback(
    (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const rect = stageRef.current.getBoundingClientRect()
      const centreX = rect.left + pip.x * rect.width
      const centreY = rect.top + pip.y * rect.height

      beginInteraction((moveEvent) => {
        const dx = Math.abs(moveEvent.clientX - centreX)
        const dy = Math.abs(moveEvent.clientY - centreY)
        const radius = Math.max(dx, dy)
        const size = clamp(
          (radius * 2) / rect.width,
          0.08,
          maxPipSize(pip.x, pip.y, frameAspect),
        )
        setPip({ size })
      })
    },
    [beginInteraction, frameAspect, pip, setPip],
  )

  const onTrimStart = (value) => {
    setTrim({ start: value })
    const screen = screenRef.current
    if (screen) {
      try {
        screen.currentTime = activeToSource(value, keptRanges)
      } catch {
        /* ignore */
      }
    }
  }

  const selectedLength = Math.max(0, trim.end - trim.start)

  return (
    <div className="review">
      <div
        ref={stageRef}
        className="stage"
        style={{ aspectRatio: frameAspect }}
      >
        <video
          ref={screenRef}
          className="stage__screen"
          src={screenUrl}
          controls
          playsInline
          onLoadedMetadata={(e) => {
            const video = e.currentTarget
            if (video.videoWidth && video.videoHeight) {
              setFrameAspect(video.videoWidth / video.videoHeight)
            }
            if (keptRanges.length) video.currentTime = activeToSource(trim.start, keptRanges)
          }}
          onTimeUpdate={syncCam}
          onSeeked={syncCam}
          onPlay={syncCam}
          onPause={syncCam}
        />

        {camUrl && (
          <>
            <div
              className={`stage__pip stage__pip--review${interacting ? ' is-dragging' : ''}`}
              style={pipStyle(pip)}
              onPointerDown={startMove}
              title="Drag to reposition the webcam"
            >
              <video
                ref={camRef}
                className="stage__pip-video"
                style={{ transform: pip.mirror ? 'scaleX(-1)' : 'none' }}
                src={camUrl}
                muted
                playsInline
                preload="auto"
              />
            </div>
            <div
              className="pip-handle"
              style={{
                left: `${(pip.x + pip.size / 2) * 100}%`,
                top: `${(pip.y + (pip.size * frameAspect) / 2) * 100}%`,
              }}
              onPointerDown={startResize}
              title="Drag to resize the webcam"
              role="slider"
              aria-label="Webcam size"
              aria-valuenow={Math.round(pip.size * 100)}
            />
          </>
        )}
      </div>

      <div className="review__grid">
        <div className="trim-panel">
          <h3>Trim</h3>
          <p className="muted">
            Exporting {formatTime(selectedLength)} of {formatTime(activeDuration)}
          </p>

          <label className="trim-row">
            <span>Start {formatTime(trim.start)}</span>
            <input
              type="range"
              min="0"
              max={activeDuration}
              step="0.05"
              value={trim.start}
              onChange={(e) => onTrimStart(Number(e.target.value))}
            />
          </label>
          <label className="trim-row">
            <span>End {formatTime(trim.end)}</span>
            <input
              type="range"
              min="0"
              max={activeDuration}
              step="0.05"
              value={trim.end}
              onChange={(e) => setTrim({ end: Number(e.target.value) })}
            />
          </label>
        </div>

        <Settings />
      </div>
    </div>
  )
}
