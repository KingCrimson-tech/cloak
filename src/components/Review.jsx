import { useCallback, useRef } from 'react'
import { useStore } from '../store.js'
import { activeToSource, formatTime } from '../lib/timeline.js'
import { pipStyle } from './LiveView.jsx'
import Settings from './Settings.jsx'

/**
 * Playback + trim review. The screen recording is the timeline authority; the
 * webcam preview is kept in sync by offsetting its `currentTime` by the measured
 * recorder start offset. Trim bounds use active time (pauses removed).
 */
export default function Review() {
  const screenUrl = useStore((s) => s.screenUrl)
  const camUrl = useStore((s) => s.camUrl)
  const offsetSec = useStore((s) => s.offsetSec)
  const activeDuration = useStore((s) => s.activeDuration)
  const keptRanges = useStore((s) => s.keptRanges)
  const trim = useStore((s) => s.trim)
  const pip = useStore((s) => s.pip)
  const setTrim = useStore((s) => s.setTrim)
  const setFrameAspect = useStore((s) => s.setFrameAspect)

  const screenRef = useRef(null)
  const camRef = useRef(null)

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
      <div className="stage">
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
          <div className="stage__pip stage__pip--review" style={pipStyle(pip)}>
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
