import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from './store.js'
import { CaptureSession } from './lib/capture.js'
import LiveView from './components/LiveView.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'

export default function App() {
  const phase = useStore((s) => s.phase)
  const error = useStore((s) => s.error)
  const warning = useStore((s) => s.warning)
  const blur = useStore((s) => s.blur)
  const quality = useStore((s) => s.quality)
  const pip = useStore((s) => s.pip)
  const setPhase = useStore((s) => s.setPhase)
  const setError = useStore((s) => s.setError)
  const clearError = useStore((s) => s.clearError)
  const setWarning = useStore((s) => s.setWarning)
  const setBlur = useStore((s) => s.setBlur)
  const setQuality = useStore((s) => s.setQuality)
  const setRecordings = useStore((s) => s.setRecordings)
  const reset = useStore((s) => s.reset)

  const sessionRef = useRef(null)
  const finishRef = useRef(null)
  const [screenStream, setScreenStream] = useState(null)
  const [camStream, setCamStream] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)

  // Free-running capture timer; reads active time from the session.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return
    const id = setInterval(() => {
      setElapsed(sessionRef.current?.getElapsed() || 0)
    }, 200)
    return () => clearInterval(id)
  }, [phase])

  const start = useCallback(async () => {
    if (busy) return
    setBusy(true)
    clearError()
    setWarning(null)
    setElapsed(0)
    const session = new CaptureSession()
    sessionRef.current = session
    session.onScreenTrack = (stream) => setScreenStream(stream)
    session.onCamTrack = (stream) => setCamStream(stream)
    session.onEnded = () => finishRef.current?.()
    try {
      await session.start({ blur, onWarning: setWarning })
      setPhase('recording')
    } catch (err) {
      session.destroy()
      sessionRef.current = null
      setScreenStream(null)
      setCamStream(null)
      setError(err?.message || 'Could not start capture.')
    } finally {
      setBusy(false)
    }
  }, [blur, busy, clearError, setCamStream, setError, setPhase, setScreenStream, setWarning])

  const finish = useCallback(async () => {
    const session = sessionRef.current
    if (!session || busy) return
    setBusy(true)
    try {
      const data = await session.stop()
      setRecordings(data)
    } catch (err) {
      setError(err?.message || 'Could not stop the recording.')
    } finally {
      sessionRef.current = null
      setScreenStream(null)
      setCamStream(null)
      setBusy(false)
    }
  }, [busy, setError, setRecordings])

  finishRef.current = finish

  const pause = useCallback(() => {
    sessionRef.current?.pause()
    setPhase('paused')
  }, [setPhase])

  const resume = useCallback(() => {
    sessionRef.current?.resume()
    setPhase('recording')
  }, [setPhase])

  const discard = useCallback(() => {
    reset()
    setElapsed(0)
  }, [reset])

  const isLive = phase === 'recording' || phase === 'paused'

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>Cloak</h1>
          <p className="tagline">Privacy-first screen &amp; webcam recorder.</p>
        </div>
        <div className="privacy-pill" title="All processing happens on this device">
          <span className="privacy-pill__dot" />
          Nothing leaves this device
        </div>
      </header>

      <ErrorBanner
        message={error}
        warning={warning}
        onDismissWarning={() => setWarning(null)}
      />

      {phase === 'idle' && (
        <section className="panel setup">
          <h2>Set up your recording</h2>
          <p className="muted">
            You'll be asked to choose a screen or window. Your camera and mic are recorded
            separately and combined only when you export.
          </p>
          <div className="setup__controls">
            <label className="field">
              <span>Quality</span>
              <select value={quality} onChange={(e) => setQuality(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="field field--toggle">
              <input
                type="checkbox"
                checked={blur}
                onChange={(e) => setBlur(e.target.checked)}
              />
              <span>Blur webcam background (on-device)</span>
            </label>
          </div>
          <button className="button button--primary" onClick={start} disabled={busy}>
            Start recording
          </button>
        </section>
      )}

      {phase === 'requesting' && (
        <section className="panel">
          <p>Requesting screen and camera access…</p>
        </section>
      )}

      {isLive && (
        <section className="panel">
          <LiveView
            screenStream={screenStream}
            camStream={camStream}
            elapsed={elapsed}
            paused={phase === 'paused'}
            pip={pip}
          />
          <div className="controls">
            {phase === 'recording' ? (
              <button className="button" onClick={pause}>Pause</button>
            ) : (
              <button className="button" onClick={resume}>Resume</button>
            )}
            <button className="button button--danger" onClick={finish} disabled={busy}>
              Stop
            </button>
            <button className="button button--ghost" onClick={discard}>Discard</button>
          </div>
        </section>
      )}

      {phase === 'recorded' && (
        <section className="panel">
          <h2>Recording captured</h2>
          <p className="muted">Review and trim will appear here.</p>
          <button className="button button--ghost" onClick={discard}>Discard</button>
        </section>
      )}

      {(phase === 'exporting' || phase === 'done') && (
        <section className="panel">
          <p>Export is handled in the export step.</p>
          <button className="button button--ghost" onClick={discard}>Start over</button>
        </section>
      )}

      {phase === 'error' && (
        <section className="panel">
          <button className="button button--primary" onClick={discard}>Try again</button>
        </section>
      )}
    </main>
  )
}
