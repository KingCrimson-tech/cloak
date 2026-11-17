import { create } from 'zustand'

const DEFAULT_PIP = { x: 0.78, y: 0.22, size: 0.2, mirror: true }

function revoke(url) {
  if (url && typeof URL !== 'undefined' && url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
}

const initial = {
  phase: 'idle', // idle | requesting | recording | paused | recorded | exporting | done | error
  error: null,
  warning: null,

  screenBlob: null,
  camBlob: null,
  screenUrl: null,
  camUrl: null,

  offsetSec: 0,
  wallDuration: 0,
  activeDuration: 0,
  pauseSegments: [],
  keptRanges: [],

  trim: { start: 0, end: 0 },
  peaks: [],

  pip: { ...DEFAULT_PIP },
  frameAspect: 16 / 9,
  quality: 'medium',

  progress: 0,
  progressLabel: '',
  downloadUrl: null,
  downloadName: null,
}

export const useStore = create((set, get) => ({
  ...initial,

  setPhase: (phase) => set({ phase }),

  setError: (error) => set({ error, phase: error ? 'error' : get().phase }),
  clearError: () => set({ error: null, phase: 'idle' }),

  setWarning: (warning) => set({ warning }),

  setQuality: (quality) => set({ quality }),

  setPip: (patch) => set((state) => ({ pip: { ...state.pip, ...patch } })),
  resetPip: () => set({ pip: { ...DEFAULT_PIP } }),
  setFrameAspect: (frameAspect) => set({ frameAspect }),

  setTrim: (patch) =>
    set((state) => {
      const max = state.activeDuration || 0
      const minLength = Math.min(0.2, max)
      let start = Math.max(0, Math.min(patch.start ?? state.trim.start, max))
      let end = Math.max(0, Math.min(patch.end ?? state.trim.end, max))
      if (end - start < minLength) {
        if (patch.start !== undefined && patch.end === undefined) {
          start = Math.max(0, end - minLength)
        } else {
          end = Math.min(max, start + minLength)
        }
      }
      return { trim: { start, end } }
    }),

  setPeaks: (peaks) => set({ peaks }),

  /** Store the finished recordings and generate preview object URLs. */
  setRecordings: (data) => {
    const state = get()
    revoke(state.screenUrl)
    revoke(state.camUrl)
    const screenUrl = URL.createObjectURL(data.screenBlob)
    const camUrl = data.camBlob ? URL.createObjectURL(data.camBlob) : null
    set({
      phase: 'recorded',
      error: null,
      screenBlob: data.screenBlob,
      camBlob: data.camBlob,
      screenUrl,
      camUrl,
      offsetSec: data.offsetSec || 0,
      wallDuration: data.wallDuration || 0,
      activeDuration: data.activeDuration || 0,
      pauseSegments: data.pauseSegments || [],
      keptRanges: data.keptRanges || [],
      trim: { start: 0, end: data.activeDuration || 0 },
      peaks: [],
      progress: 0,
      progressLabel: '',
      downloadUrl: null,
      downloadName: null,
    })
  },

  setProgress: (progress, progressLabel) =>
    set((state) => ({
      progress,
      progressLabel: progressLabel ?? state.progressLabel,
    })),

  setDownload: (blob, name) => {
    const state = get()
    revoke(state.downloadUrl)
    set({
      phase: 'done',
      downloadUrl: URL.createObjectURL(blob),
      downloadName: name,
      progress: 1,
      progressLabel: 'Ready',
    })
  },

  /** Return to idle and release every object URL we own. */
  reset: () => {
    const state = get()
    revoke(state.screenUrl)
    revoke(state.camUrl)
    revoke(state.downloadUrl)
    set({ ...initial, pip: { ...state.pip }, quality: state.quality })
  },
}))

export { DEFAULT_PIP }
