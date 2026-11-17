/**
 * Decode the mixed audio of the screen recording and reduce it to `peakCount`
 * normalized amplitude peaks (max absolute sample per bucket). Recordings
 * without audio resolve to an empty array; the timeline still supports trim.
 */
export async function computePeaks(blob, peakCount = 1200) {
  if (!blob || !blob.size) return []
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return []

  let context
  try {
    context = new AudioContextClass()
    const bytes = await blob.arrayBuffer()
    const audioBuffer = await context.decodeAudioData(bytes)

    const channels = []
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      channels.push(audioBuffer.getChannelData(c))
    }
    const length = audioBuffer.length
    if (!length || !channels.length) return []

    const bucket = Math.max(1, Math.floor(length / peakCount))
    const peaks = new Array(peakCount).fill(0)

    for (let i = 0; i < peakCount; i++) {
      const start = i * bucket
      const end = Math.min(length, start + bucket)
      let peak = 0
      for (let j = start; j < end; j++) {
        let value = 0
        for (const channel of channels) {
          const absolute = Math.abs(channel[j])
          if (absolute > value) value = absolute
        }
        if (value > peak) peak = value
      }
      peaks[i] = peak
    }

    const max = Math.max(...peaks, 1e-6)
    return peaks.map((value) => Math.min(1, value / max))
  } catch {
    // decodeAudioData can fail for WebM in some browsers; degrade gracefully.
    return []
  } finally {
    try {
      await context?.close()
    } catch {
      /* ignore */
    }
  }
}
