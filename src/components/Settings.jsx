import { useStore } from '../store.js'
import { clamp } from '../lib/timeline.js'

const CORNERS = [
  { key: 'tl', name: 'Top left', glyph: '↖', x: 'left', y: 'top' },
  { key: 'tr', name: 'Top right', glyph: '↗', x: 'right', y: 'top' },
  { key: 'bl', name: 'Bottom left', glyph: '↙', x: 'left', y: 'bottom' },
  { key: 'br', name: 'Bottom right', glyph: '↘', x: 'right', y: 'bottom' },
]

export default function Settings() {
  const pip = useStore((s) => s.pip)
  const setPip = useStore((s) => s.setPip)
  const resetPip = useStore((s) => s.resetPip)
  const frameAspect = useStore((s) => s.frameAspect)
  const quality = useStore((s) => s.quality)
  const setQuality = useStore((s) => s.setQuality)

  const applyCorner = (corner) => {
    // `size` is a fraction of frame width; convert to a y-radius using the
    // frame's aspect ratio so the circle stays inside the frame.
    const rx = Math.min(0.5, pip.size / 2)
    const ry = Math.min(0.5, (pip.size * frameAspect) / 2)
    setPip({
      x: corner.x === 'right' ? 1 - rx : rx,
      y: corner.y === 'bottom' ? 1 - ry : ry,
    })
  }

  return (
    <div className="settings">
      <div className="settings__group">
        <span className="settings__label">PiP corner</span>
        <div className="corner-grid">
          {CORNERS.map((corner) => (
            <button
              key={corner.key}
              className="corner-button"
              title={corner.name}
              aria-label={corner.name}
              onClick={() => applyCorner(corner)}
            >
              {corner.glyph}
            </button>
          ))}
        </div>
      </div>

      <label className="settings__group settings__slider">
        <span className="settings__label">
          PiP size <span className="settings__value">{Math.round(pip.size * 100)}%</span>
        </span>
        <input
          type="range"
          min="0.08"
          max="0.4"
          step="0.01"
          value={clamp(pip.size, 0.08, 0.4)}
          onChange={(e) => {
            const size = Number(e.target.value)
            const rx = size / 2
            const ry = (size * frameAspect) / 2
            setPip({
              size,
              x: clamp(pip.x, rx, 1 - rx),
              y: clamp(pip.y, ry, 1 - ry),
            })
          }}
        />
      </label>

      <label className="settings__group field--toggle">
        <input
          type="checkbox"
          checked={pip.mirror}
          onChange={(e) => setPip({ mirror: e.target.checked })}
        />
        <span className="settings__label">Mirror webcam</span>
      </label>

      <label className="settings__group">
        <span className="settings__label">Export quality</span>
        <select value={quality} onChange={(e) => setQuality(e.target.value)}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>

      <button className="button button--ghost settings__reset" onClick={resetPip}>
        Reset PiP
      </button>
    </div>
  )
}
