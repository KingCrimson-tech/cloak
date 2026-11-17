import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp } from '../lib/timeline.js'

const MIN_CLIP = 0.2
const HEIGHT = 72

/**
 * Amplitude overview with draggable trim handles and a playhead. The timebase
 * is active duration, so paused spans never appear on the timeline.
 */
export default function Waveform({
  peaks,
  activeDuration,
  trim,
  playhead,
  onTrim,
  onSeek,
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const cleanupDragRef = useRef(null)
  const [width, setWidth] = useState(0)

  useEffect(() => () => cleanupDragRef.current?.(), [])

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(HEIGHT * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, HEIGHT)

    ctx.fillStyle = '#111114'
    ctx.fillRect(0, 0, width, HEIGHT)
    ctx.fillStyle = '#3f3f46'
    ctx.fillRect(0, HEIGHT / 2, width, 1)

    const values = peaks.length ? peaks : [0]
    const barWidth = Math.max(1, width / values.length)
    const maxHeight = HEIGHT / 2 - 4

    for (let i = 0; i < values.length; i++) {
      const time = (i / values.length) * activeDuration
      const inside = time >= trim.start && time <= trim.end
      const height = values[i] * maxHeight
      ctx.fillStyle = inside ? '#7dd3fc' : '#3f3f46'
      ctx.fillRect(
        i * barWidth,
        HEIGHT / 2 - height,
        Math.max(1, barWidth - 0.4),
        Math.max(values.length ? 1 : 0, height * 2),
      )
    }

    if (activeDuration > 0) {
      const x = clamp(playhead / activeDuration, 0, 1) * width
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(x - 1, 0, 2, HEIGHT)
    }
  }, [peaks, activeDuration, trim, playhead, width])

  const beginDrag = useCallback(
    (which) => (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const rect = wrapRef.current.getBoundingClientRect()
      const onMove = (moveEvent) => {
        const time = clamp(
          ((moveEvent.clientX - rect.left) / rect.width) * activeDuration,
          0,
          activeDuration,
        )
        if (which === 'start') onTrim({ start: Math.min(time, trim.end - MIN_CLIP) })
        else onTrim({ end: Math.max(time, trim.start + MIN_CLIP) })
      }
      const end = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        cleanupDragRef.current = null
      }
      cleanupDragRef.current = end
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    },
    [activeDuration, onTrim, trim.end, trim.start],
  )

  const seek = (event) => {
    const rect = wrapRef.current.getBoundingClientRect()
    onSeek(clamp((event.clientX - rect.left) / rect.width, 0, 1) * activeDuration)
  }

  const toPercent = (time) =>
    `${activeDuration ? clamp(time / activeDuration, 0, 1) * 100 : 0}%`

  return (
    <div className="waveform" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="waveform__canvas"
        style={{ height: HEIGHT }}
        onClick={seek}
        aria-label="Audio waveform — click to seek"
      />
      <div
        className="waveform__handle"
        style={{ left: toPercent(trim.start) }}
        onPointerDown={beginDrag('start')}
        onClick={(event) => event.stopPropagation()}
        title="Drag to set trim start"
        role="slider"
        aria-label="Trim start"
        aria-valuenow={trim.start}
      />
      <div
        className="waveform__handle"
        style={{ left: toPercent(trim.end) }}
        onPointerDown={beginDrag('end')}
        onClick={(event) => event.stopPropagation()}
        title="Drag to set trim end"
        role="slider"
        aria-label="Trim end"
        aria-valuenow={trim.end}
      />
    </div>
  )
}
