import { IconArrowDown, IconArrowUp, IconCheck } from './Icons'
import { Confetti } from './Confetti'

interface HeroScoreProps {
  rmsd: number | null
  baseline: number
  target: number
  normalized: number  // 0-100
  history: number[]
  delta: number | null
  solved: boolean
  celebrate: boolean
}

const W = 140
const H = 36

export function HeroScore({
  rmsd,
  baseline,
  target,
  normalized,
  history,
  delta,
  solved,
  celebrate,
}: HeroScoreProps) {
  let sparkD = ''
  let lastX = W
  let lastY = H / 2
  let targetY = H / 2
  if (history.length > 1) {
    const min = Math.min(...history, target)
    const max = Math.max(...history, baseline)
    const range = Math.max(max - min, 0.5)
    const xs = history.map((_, i) => (i / (history.length - 1)) * W)
    const ys = history.map((v) => H - ((v - min) / range) * (H - 4) - 2)
    sparkD = `M ${xs[0]} ${ys[0]}` + xs.slice(1).map((x, i) => ` L ${x} ${ys[i + 1]}`).join('')
    lastX = xs[xs.length - 1]
    lastY = ys[ys.length - 1]
    targetY = H - ((target - min) / range) * (H - 4) - 2
  }

  // Position of the target marker along the bar — fraction of the baseline range.
  const targetLeftPct = baseline > 0 ? Math.max(0, Math.min(100, 100 - (target / baseline) * 100)) : 100

  return (
    <div className={`hero-score ${solved ? 'solved' : ''} ${celebrate ? 'celebrate' : ''}`}>
      {celebrate && <Confetti />}
      <div className="hero-top">
        <div className="hero-num">
          <span className="hn-prefix">RMSD</span>
          <span className={`hn-value mono ${rmsd === null ? 'pending' : ''}`}>
            {rmsd === null ? '—' : rmsd.toFixed(2)}
          </span>
          <span className="hn-unit">Å</span>
        </div>
        {delta !== null && Math.abs(delta) > 0.01 && (
          <span className={`delta ${delta < 0 ? 'good' : 'bad'}`}>
            {delta < 0 ? <IconArrowDown /> : <IconArrowUp />}
            <span className="mono">{Math.abs(delta).toFixed(2)} Å</span>
          </span>
        )}
      </div>

      <div className="hero-bar">
        <div className="hero-bar-track">
          <div className="hero-target-zone" style={{ left: `${targetLeftPct}%` }} />
          <div className="hero-bar-fill" style={{ width: `${Math.max(0, Math.min(100, normalized))}%` }} />
        </div>
        <div className="hero-bar-meta">
          <span>
            <b className="mono">{baseline.toFixed(1)}</b> baseline
          </span>
          <span className="ml-auto">
            <span className="mono">{target.toFixed(1)}</span> target
          </span>
        </div>
      </div>

      {history.length > 1 && (
        <div className="spark">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <line
              x1={0}
              y1={targetY}
              x2={W}
              y2={targetY}
              stroke="oklch(0.7 0.13 168 / 0.5)"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
            <path
              d={sparkD}
              stroke="var(--accent)"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx={lastX} cy={lastY} r="2.5" fill="var(--accent)" />
          </svg>
          <span className="spark-label">last {history.length} attempts</span>
        </div>
      )}

      {solved && (
        <div className="solved-strap">
          <IconCheck />
          <span>Solved — inside target tolerance</span>
        </div>
      )}
    </div>
  )
}
