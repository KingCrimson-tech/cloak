import { useEffect, useRef } from 'react'
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
  const screenRef = useRef(null)
  const camRef = useRef(null)

  useEffect(() => {
    if (screenRef.current) screenRef.current.srcObject = screenStream || null
  }, [screenStream])

  useEffect(() => {
    if (camRef.current) camRef.current.srcObject = camStream || null
  }, [camStream])

  return (
    <div className="stage">
      <video ref={screenRef} className="stage__screen" autoPlay playsInline muted />

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
      {paused && <div className="hud hud--badge">Paused</div>}
    </div>
  )
}
