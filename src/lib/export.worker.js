import {
  Input,
  BlobSource,
  ALL_FORMATS,
  VideoSampleSink,
  AudioSampleSink,
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  AudioBufferSource,
} from 'mediabunny'
import { activeToSource, pipRect } from './timeline.js'

const FPS = 30
const TILE = 512
const PROFILES = {
  low: { video: 1_000_000, audio: 96_000 },
  medium: { video: 2_500_000, audio: 128_000 },
  high: { video: 5_000_000, audio: 192_000 },
}

const report = (value, label) =>
  self.postMessage({ type: 'progress', value, label })

self.onmessage = async (event) => {
  try {
    await exportRecording(event.data)
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error?.message || String(error),
    })
  }
}

async function exportRecording(options) {
  const {
    screenBlob,
    camBlob,
    offsetSec = 0,
    keptRanges = [],
    trim = { start: 0, end: 0 },
    pip = { x: 0.78, y: 0.22, size: 0.2, mirror: true },
    quality = 'medium',
    fps = FPS,
  } = options

  report(0.02, 'Opening recordings')
  const screenInput = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(screenBlob),
  })
  const camInput = camBlob
    ? new Input({ formats: ALL_FORMATS, source: new BlobSource(camBlob) })
    : null

  const screenTrack = await screenInput.getPrimaryVideoTrack()
  if (!screenTrack) throw new Error('The screen recording contains no video track.')
  const camTrack = camInput ? await camInput.getPrimaryVideoTrack() : null
  const audioTrack = await screenInput.getPrimaryAudioTrack()

  const screenSink = new VideoSampleSink(screenTrack)
  const camSink = camTrack ? new VideoSampleSink(camTrack) : null
  const audioSink = audioTrack ? new AudioSampleSink(audioTrack) : null

  const firstFrame = await screenSink.getSample(0)
  const width = firstFrame?.displayWidth || 1280
  const height = firstFrame?.displayHeight || 720
  firstFrame?.close?.()

  const bitrate = PROFILES[quality] || PROFILES.medium
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat(), target })

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  const tile = new OffscreenCanvas(TILE, TILE)
  const tileCtx = tile.getContext('2d')

  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: bitrate.video,
    latencyMode: 'quality',
    keyFrameInterval: 2,
    sizeChangeBehavior: 'fill',
  })
  output.addVideoTrack(videoSource, { frameRate: fps })

  const audioSource = audioSink
    ? new AudioBufferSource({ codec: 'aac', bitrate: bitrate.audio })
    : null
  if (audioSource) output.addAudioTrack(audioSource)

  const trimStart = Math.max(0, trim.start)
  const clipDuration = Math.max(0, trim.end - trimStart)
  if (clipDuration <= 0) throw new Error('The selected trim range is empty.')

  await output.start()
  report(0.05, 'Compositing video')

  const frameDuration = 1 / fps
  const totalFrames = Math.max(1, Math.ceil(clipDuration * fps))

  for (let i = 0; i < totalFrames; i++) {
    const outTime = Math.min(i * frameDuration, clipDuration - frameDuration / 2)
    const wall = activeToSource(trimStart + outTime, keptRanges)

    const screenFrame = await screenSink.getSample(wall)
    try {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, width, height)
      if (screenFrame) screenFrame.draw(ctx, 0, 0, width, height)
    } finally {
      screenFrame?.close()
    }

    if (camSink) {
      const camFrame = await camSink.getSample(Math.max(0, wall - offsetSec))
      try {
        if (camFrame) {
          tileCtx.clearRect(0, 0, TILE, TILE)
          camFrame.drawWithFit(tileCtx, { fit: 'cover' })

          const rect = pipRect(pip, width, height)
          ctx.save()
          ctx.translate(rect.cx, rect.cy)
          if (rect.mirror) ctx.scale(-1, 1)
          ctx.beginPath()
          ctx.arc(0, 0, rect.radius, 0, Math.PI * 2)
          ctx.clip()
          ctx.drawImage(tile, -rect.radius, -rect.radius, rect.radius * 2, rect.radius * 2)
          ctx.restore()
        }
      } finally {
        camFrame?.close()
      }
    }

    await videoSource.add(outTime, frameDuration)
    if (i % 10 === 0) report(0.05 + 0.75 * (i / totalFrames), 'Compositing video')
  }
  videoSource.close()

  if (audioSource) {
    report(0.82, 'Mixing audio')
    await writeAudio(audioSink, audioSource, keptRanges, trimStart, clipDuration)
    audioSource.close()
  }

  report(0.95, 'Finalizing MP4')
  await output.finalize()
  if (!target.buffer) throw new Error('Export produced no data.')

  const blob = new Blob([target.buffer], { type: 'video/mp4' })
  report(1, 'Done')
  self.postMessage({ type: 'done', blob })
}

/**
 * Append kept audio spans into one gapless AudioBuffer.
 *
 * Samples are placed with a running frame cursor rather than converting each
 * timestamp independently. Rounding every timestamp to a frame used to leave
 * one-frame holes between packets, which showed up as audible clicks/gaps.
 * Appending in output order keeps the audio continuous while paused spans are
 * still removed and the trim start is rebased to zero.
 */
async function writeAudio(sink, source, ranges, trimStart, clipDuration) {
  const first = await sink.getSample(0)
  if (!first) {
    first?.close?.()
    return
  }
  const sampleRate = first.sampleRate
  const channels = first.numberOfChannels
  first.close()

  const length = Math.max(1, Math.ceil(clipDuration * sampleRate))
  const buffer = new AudioBuffer({ numberOfChannels: channels, length, sampleRate })
  const trimWallStart = activeToSource(trimStart, ranges)
  const trimWallEnd = activeToSource(trimStart + clipDuration, ranges)
  let cursor = 0

  for (const [rangeStart, rangeEnd] of ranges) {
    const from = Math.max(rangeStart, trimWallStart)
    const to = Math.min(rangeEnd, trimWallEnd)
    if (to <= from) continue

    for await (const sample of sink.samples(from, to)) {
      try {
        const start = Math.max(sample.timestamp, from)
        const end = Math.min(sample.timestamp + sample.duration, to)
        if (end <= start) continue

        const frameOffset = Math.max(0, Math.round((start - sample.timestamp) * sampleRate))
        const frameCount = Math.min(Math.round((end - start) * sampleRate), length - cursor)
        if (frameCount <= 0) continue

        for (let channel = 0; channel < channels; channel++) {
          const data = new Float32Array(frameCount)
          sample.copyTo(data, {
            planeIndex: channel,
            format: 'f32-planar',
            frameOffset,
            frameCount,
          })
          buffer.copyToChannel(data, channel, cursor)
        }
        cursor += frameCount
      } finally {
        sample.close()
      }
    }
  }

  await source.add(buffer)
}
