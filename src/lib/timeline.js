/**
 * Shared, pure timing helpers.
 *
 * The app's authoritative timebase is *active time*: wall-clock time minus
 * paused spans. These helpers convert between active time and the wall-clock
 * timestamps found inside the recorded WebM files. Both the main thread and
 * the export worker use them so the preview and the exported MP4 agree.
 */

/** Total active duration for a recording of `wallDuration` seconds. */
export function activeDuration(wallDuration, pauseSegments = []) {
  const paused = pauseSegments.reduce(
    (sum, segment) => sum + Math.max(0, segment.end - segment.start),
    0,
  )
  return Math.max(0, wallDuration - paused)
}

/**
 * The kept (unpaused) wall-clock ranges as an ascending list of `[start, end]`
 * pairs. Pause segments are clamped to the recording bounds and merged.
 */
export function keptRanges(wallDuration, pauseSegments = []) {
  const sorted = [...pauseSegments]
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0 }))
    .sort((a, b) => a.start - b.start)

  const ranges = []
  let cursor = 0

  for (const segment of sorted) {
    const start = Math.max(0, Math.min(wallDuration, segment.start))
    const end = Math.max(start, Math.min(wallDuration, segment.end))
    if (start > cursor) ranges.push([cursor, start])
    cursor = Math.max(cursor, end)
  }

  if (cursor < wallDuration) ranges.push([cursor, wallDuration])
  return ranges
}

/** Map an active-time value to the corresponding wall-clock source time. */
export function activeToSource(active, ranges) {
  if (!ranges.length) return active
  let acc = 0
  for (const [start, end] of ranges) {
    const length = end - start
    if (active <= acc + length) return start + Math.max(0, active - acc)
    acc += length
  }
  return ranges[ranges.length - 1][1]
}

/** Map a wall-clock source time to its active-time value. */
export function sourceToActive(source, ranges) {
  let acc = 0
  for (const [start, end] of ranges) {
    if (source <= end) return acc + Math.max(0, Math.min(source - start, end - start))
    acc += end - start
  }
  return acc
}

/** Clamp helper used by the PiP and trim drag handles. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** Format seconds as `m:ss` (or `h:mm:ss`) for the HUD. */
export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}
