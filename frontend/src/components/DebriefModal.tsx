import { useEffect } from 'react'
import { IconArrow, IconDebriefCheck } from './Icons'
import { AA_CAT } from '../lib/colors'

export interface MutationLogEntry {
  pos: number
  prev: string
  next: string
  rmsdBefore: number
}

interface DebriefModalProps {
  puzzleTitle: string
  mutationBudget: number
  baseline: number
  finalRmsd: number
  mutationLog: MutationLogEntry[]
  hasNext: boolean
  onClose: () => void
  onNext: () => void
}

export function DebriefModal({
  puzzleTitle,
  mutationBudget,
  baseline,
  finalRmsd,
  mutationLog,
  hasNext,
  onClose,
  onNext,
}: DebriefModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const rmsdDrop = baseline - finalRmsd
  const helpful = mutationLog.filter((m, i) => {
    const next = mutationLog[i + 1]
    const cur = m.rmsdBefore
    const after = next ? next.rmsdBefore : finalRmsd
    return after < cur - 0.1
  }).length

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal debrief" role="dialog" aria-modal="true" aria-label="Puzzle solved">
        <div className="debrief-hero">
          <div className="debrief-check"><IconDebriefCheck /></div>
          <div>
            <div className="debrief-eyebrow">Puzzle solved</div>
            <h2 className="debrief-title">{puzzleTitle}</h2>
          </div>
          <button className="popover-close debrief-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="debrief-stats">
          <div className="dstat">
            <span className="ss-label">Final RMSD</span>
            <span className="dstat-v mono">{finalRmsd.toFixed(2)} <small>Å</small></span>
            <span className="dstat-meta">down <b className="mono">{rmsdDrop.toFixed(1)}</b> Å from baseline</span>
          </div>
          <div className="dstat">
            <span className="ss-label">Mutations</span>
            <span className="dstat-v mono">
              {mutationLog.length} <small>/ {mutationBudget}</small>
            </span>
            <span className="dstat-meta">{Math.max(0, mutationBudget - mutationLog.length)} left in the budget</span>
          </div>
          <div className="dstat">
            <span className="ss-label">Helpful moves</span>
            <span className="dstat-v mono">
              {helpful} <small>/ {mutationLog.length || 1}</small>
            </span>
            <span className="dstat-meta">mutations that dropped RMSD</span>
          </div>
        </div>

        <div className="debrief-section">
          <div className="section-head"><span>Mutation log</span></div>
          {mutationLog.length === 0 ? (
            <p className="debrief-empty">No mutations recorded for this attempt.</p>
          ) : (
            <ol className="mlog">
              {mutationLog.map((m, i) => {
                const next = mutationLog[i + 1]
                const after = next ? next.rmsdBefore : finalRmsd
                const delta = after - m.rmsdBefore
                const good = delta < -0.1
                const bad = delta > 0.1
                return (
                  <li key={i}>
                    <span className="mlog-i mono">{String(i + 1).padStart(2, '0')}</span>
                    <span className="mlog-pos">pos <b className="mono">{m.pos + 1}</b></span>
                    <span className="mlog-swap mono">
                      <span className={`cat-${AA_CAT[m.prev]}`}>{m.prev}</span>
                      <span className="arrow">→</span>
                      <span className={`cat-${AA_CAT[m.next]}`}>{m.next}</span>
                    </span>
                    <span className={`mlog-delta ${good ? 'good' : bad ? 'bad' : ''} mono`}>
                      {delta > 0 ? '+' : ''}{delta.toFixed(2)} Å
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        <div className="debrief-foot">
          <button className="btn ghost" onClick={onClose}>Stay here</button>
          {hasNext && (
            <button className="btn primary" onClick={onNext}>
              Next puzzle <IconArrow />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
