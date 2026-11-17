import { createBlurPipeline } from './blur.js'
import { activeDuration, keptRanges } from './timeline.js'

const SCREEN_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]
const CAM_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

/** Turn browser-native capture errors into actionable messages. */
export function describeCaptureError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Permission was denied. Allow screen and camera access in your browser, then try again.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera or microphone was found. You can still record your screen.'
    case 'NotReadableError':
      return 'Your camera or microphone is already in use by another application.'
    case 'NotSupportedError':
      return 'This browser does not support the required capture APIs. Try Chrome or Edge.'
    case 'SecurityError':
      return 'Screen recording needs a secure context (HTTPS or localhost).'
    default:
      return error?.message || 'Something went wrong while starting capture.'
  }
}

const canRecord = () =>
  typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices !== 'undefined'

function pickMimeType(candidates) {
  if (!canRecord()) return ''
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function supportsCanvasCapture() {
  return (
    typeof document !== 'undefined' &&
    typeof document.createElement('canvas').captureStream === 'function'
  )
}

function stopTracks(stream) {
  stream?.getTracks?.().forEach((track) => {
    try {
      track.stop()
    } catch {
      /* already stopped */
    }
  })
}

/**
 * Owns every native resource needed for a single capture session: the display
 * and camera streams, the optional blur pipeline, the Web Audio mix and the
 * two MediaRecorders. `destroy()` is safe to call repeatedly and on every
 * success/error path.
 */
export class CaptureSession {
  constructor() {
    this.screenStream = null
    this.camStream = null
    this.processedCamStream = null
    this.mixedStream = null
    this.audioContext = null
    this.screenRecorder = null
    this.camRecorder = null
    this.blurPipeline = null

    this.screenChunks = []
    this.camChunks = []
    this.screenStart = 0
    this.camStart = 0
    this.offsetSec = 0
    this.pauseSegments = []
    this.pauseStartedAt = null
    this.paused = false
    this.destroyed = false

    this.onWarning = () => {}
    this.onEnded = () => {}
    this.onScreenTrack = () => {}
    this.onCamTrack = () => {}
  }

  /** Acquire streams, build the audio mix and start both recorders. */
  async start({ blur = false, onWarning, onEnded } = {}) {
    if (!canRecord()) {
      throw new Error(
        'This browser does not support the required capture APIs. Try Chrome or Edge over localhost or HTTPS.',
      )
    }
    this.onWarning = onWarning || this.onWarning
    this.onEnded = onEnded || this.onEnded

    // 1. Screen first (getDisplayMedia must come from a user gesture).
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 }, cursor: 'always' },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })

    const screenTrack = this.screenStream.getVideoTracks()[0]
    if (!screenTrack) {
      throw new Error('No video track was returned by screen sharing.')
    }
    screenTrack.addEventListener('ended', () => this.onEnded(), { once: true })
    this.onScreenTrack(this.screenStream)

    // 2. Camera + mic, with a graceful screen-only fallback.
    try {
      this.camStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch {
      this.onWarning(
        'Camera or microphone unavailable — continuing with a screen-only recording.',
      )
    }

    let camVideoTrack = this.camStream?.getVideoTracks()[0] || null
    const micTrack = this.camStream?.getAudioTracks()[0] || null

    // 3. Optional local blur runs on the camera video track *before* it is
    //    previewed or recorded. The original mic audio is preserved.
    if (blur && camVideoTrack) {
      if (supportsCanvasCapture()) {
        this.blurPipeline = createBlurPipeline(camVideoTrack)
        this.processedCamStream = this.blurPipeline.stream
        const processedTrack = this.processedCamStream?.getVideoTracks()[0]
        if (processedTrack) {
          camVideoTrack = processedTrack
        } else {
          // Defensive: some browsers delay creating the captureStream track.
          this.blurPipeline.destroy()
          this.blurPipeline = null
          this.processedCamStream = null
          this.onWarning(
            'Background blur is unavailable in this browser — using the raw camera.',
          )
        }
      } else {
        this.onWarning(
          'Background blur is unavailable in this browser — using the raw camera.',
        )
      }
    }

    if (camVideoTrack) {
      this.onCamTrack(this.processedCamStream || this.camStream)
    }

    // 4. Mix system audio and mic into one track for the screen recording.
    const systemTracks = this.screenStream.getAudioTracks()
    const mixedTrack = this.buildMixedAudioTrack([
      ...systemTracks.map((track) => ({ track, gain: 0.85 })),
      ...(micTrack ? [{ track: micTrack, gain: 1 }] : []),
    ])

    // 5. Screen recorder: screen video + mixed audio (when available).
    const screenRecordStream = new MediaStream([
      screenTrack,
      ...(mixedTrack ? [mixedTrack] : []),
    ])
    const screenMime = pickMimeType(SCREEN_MIME_TYPES)
    this.screenRecorder = new MediaRecorder(screenRecordStream, {
      ...(screenMime ? { mimeType: screenMime } : {}),
      videoBitsPerSecond: 2_500_000,
      audioBitsPerSecond: 128_000,
    })
    this.screenChunks = []
    this.screenRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size) this.screenChunks.push(event.data)
    }

    // 6. Camera recorder: video only.
    if (camVideoTrack) {
      const camRecordStream = new MediaStream([camVideoTrack])
      const camMime = pickMimeType(CAM_MIME_TYPES)
      this.camRecorder = new MediaRecorder(camRecordStream, {
        ...(camMime ? { mimeType: camMime } : {}),
        videoBitsPerSecond: 1_500_000,
      })
      this.camChunks = []
      this.camRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size) this.camChunks.push(event.data)
      }
    }

    // 7. Start recorders, recording wall-clock offsets for alignment.
    this.screenStart = performance.now()
    this.screenRecorder.start(250)

    if (this.camRecorder) {
      this.camStart = performance.now()
      this.camRecorder.start(250)
      this.offsetSec = (this.camStart - this.screenStart) / 1000
    }

    return {
      hasCamera: Boolean(camVideoTrack),
      hasAudio: Boolean(mixedTrack),
      offsetSec: this.offsetSec,
    }
  }

  buildMixedAudioTrack(inputs) {
    if (!inputs.length) return null
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return null

    try {
      this.audioContext = new AudioContextClass()
      const destination = this.audioContext.createMediaStreamDestination()

      for (const { track, gain } of inputs) {
        const source = this.audioContext.createMediaStreamSource(new MediaStream([track]))
        const gainNode = this.audioContext.createGain()
        gainNode.gain.value = gain
        source.connect(gainNode)
        gainNode.connect(destination)
      }

      this.audioContext.resume?.().catch(() => {})
      this.mixedStream = destination.stream
      return destination.stream.getAudioTracks()[0] || null
    } catch {
      // Audio mixing is best-effort: recording still works without it.
      return null
    }
  }

  pause() {
    if (this.paused || this.screenRecorder?.state !== 'recording') return
    if (this.screenRecorder.state === 'recording') this.screenRecorder.pause()
    if (this.camRecorder?.state === 'recording') this.camRecorder.pause()
    this.pauseStartedAt = performance.now()
    this.paused = true
  }

  resume() {
    if (!this.paused) return
    if (this.screenRecorder?.state === 'paused') this.screenRecorder.resume()
    if (this.camRecorder?.state === 'paused') this.camRecorder.resume()
    if (this.pauseStartedAt !== null) {
      this.pauseSegments.push({
        start: (this.pauseStartedAt - this.screenStart) / 1000,
        end: (performance.now() - this.screenStart) / 1000,
      })
    }
    this.pauseStartedAt = null
    this.paused = false
  }

  /** Active (unpaused) seconds elapsed since the screen recorder started. */
  getElapsed() {
    if (!this.screenStart) return 0
    const now = performance.now()
    const wall = (now - this.screenStart) / 1000
    let paused = this.pauseSegments.reduce(
      (sum, segment) => sum + Math.max(0, segment.end - segment.start),
      0,
    )
    if (this.pauseStartedAt !== null) paused += (now - this.pauseStartedAt) / 1000
    return Math.max(0, wall - paused)
  }

  /** Stop both recorders, close the open pause span and return the blobs. */
  async stop() {
    if (this.pauseStartedAt !== null) {
      this.pauseSegments.push({
        start: (this.pauseStartedAt - this.screenStart) / 1000,
        end: (performance.now() - this.screenStart) / 1000,
      })
      this.pauseStartedAt = null
      this.paused = false
    }

    const wallDuration = this.screenStart
      ? (performance.now() - this.screenStart) / 1000
      : 0

    await Promise.all([
      stopRecorder(this.screenRecorder),
      stopRecorder(this.camRecorder),
    ])

    const screenBlob = new Blob(this.screenChunks, {
      type: this.screenRecorder?.mimeType || 'video/webm',
    })
    const camBlob = this.camRecorder
      ? new Blob(this.camChunks, { type: this.camRecorder.mimeType || 'video/webm' })
      : null

    const result = {
      screenBlob,
      camBlob,
      wallDuration,
      offsetSec: this.offsetSec,
      pauseSegments: [...this.pauseSegments],
      activeDuration: activeDuration(wallDuration, this.pauseSegments),
      keptRanges: keptRanges(wallDuration, this.pauseSegments),
    }

    this.destroy()
    return result
  }

  /** Release every native resource. Idempotent. */
  destroy() {
    if (this.destroyed) return
    this.destroyed = true

    stopTracks(this.screenStream)
    stopTracks(this.camStream)
    stopTracks(this.processedCamStream)
    stopTracks(this.mixedStream)

    this.blurPipeline?.destroy()
    this.blurPipeline = null

    try {
      this.audioContext?.close()
    } catch {
      /* already closed */
    }
    this.audioContext = null

    this.screenRecorder = null
    this.camRecorder = null
    this.screenChunks = []
    this.camChunks = []
    this.screenStream = null
    this.camStream = null
    this.processedCamStream = null
    this.mixedStream = null
  }
}

function stopRecorder(recorder) {
  return new Promise((resolve) => {
    if (!recorder || recorder.state === 'inactive') {
      resolve()
      return
    }
    const finish = () => resolve()
    recorder.addEventListener('stop', finish, { once: true })
    try {
      recorder.stop()
    } catch {
      finish()
    }
  })
}
