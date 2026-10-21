import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'

interface TourStep {
  kind?: 'center'
  anchor?: string
  side?: 'top' | 'left' | 'right' | 'bottom'
  title: string
  body: string
  cta?: string
}

const STEPS: TourStep[] = [
  {
    kind: 'center',
    title: 'Welcome to FolditLite',
    body: "You'll learn how proteins fold by repairing broken ones. Five steps, twenty seconds.",
    cta: 'Start tour',
  },
  {
    anchor: '.dock',
    side: 'top',
    title: 'This is your sequence',
    body: 'Each letter is an amino acid. The colour stripes match the 3D ribbon above so you can map "this letter" to "that bit of structure".',
  },
  {
    anchor: '.cell',
    side: 'top',
    title: 'Click any residue to mutate',
    body: 'Pick a new amino acid from the grouped picker. Categories are coloured by chemistry — hydrophobic, polar, charged.',
  },
  {
    anchor: '.hero-score',
    side: 'left',
    title: 'Watch the RMSD drop',
    body: 'RMSD is your distance from the target fold. Lower is better. The sparkline tracks your last few attempts.',
  },
  {
    anchor: '.tutor-card',
    side: 'left',
    title: 'Stuck? Ask the tutor',
    body: 'Claude can explain why your last mutation helped or hurt. Use it as a study partner.',
    cta: 'Got it',
  },
]

interface OnboardingTourProps {
  onDone: () => void
}

export function OnboardingTour({ onDone }: OnboardingTourProps) {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const s = STEPS[step]

  // Keep the anchor rect in sync with layout changes (resize, theme flip).
  useLayoutEffect(() => {
    if (!s.anchor) { setRect(null); return }
    const update = () => {
      const el = document.querySelector(s.anchor!) as HTMLElement | null
      if (!el) { setRect(null); return }
      setRect(el.getBoundingClientRect())
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [step, s.anchor])

  const next = () => (step >= STEPS.length - 1 ? onDone() : setStep((n) => n + 1))
  const back = () => setStep((n) => Math.max(0, n - 1))

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone()
      if (e.key === 'Enter') next()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') back()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // Position the tooltip.
  let tipStyle: CSSProperties
  if (s.kind === 'center' || !rect) {
    tipStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  } else {
    const W = 320
    const TIP_HEIGHT = 180
    if (s.side === 'top') {
      tipStyle = {
        left: Math.max(16, Math.min(window.innerWidth - W - 16, rect.left + rect.width / 2 - W / 2)),
        top: Math.max(16, rect.top - 16 - TIP_HEIGHT),
      }
    } else if (s.side === 'left') {
      tipStyle = {
        left: Math.max(16, rect.left - W - 16),
        top: Math.max(16, rect.top),
      }
    } else if (s.side === 'right') {
      tipStyle = {
        left: Math.min(window.innerWidth - W - 16, rect.right + 16),
        top: Math.max(16, rect.top),
      }
    } else {
      tipStyle = {
        left: Math.max(16, Math.min(window.innerWidth - W - 16, rect.left + rect.width / 2 - W / 2)),
        top: rect.bottom + 16,
      }
    }
  }

  const showSpot = !!rect && s.kind !== 'center'

  return (
    <div className="tour">
      {!showSpot && <div className="tour-veil" />}
      {showSpot && (
        <div
          className="tour-spot"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}
      <div className={`tour-tip ${s.kind === 'center' ? 'is-center' : ''}`} style={tipStyle}>
        <div className="tour-step">{step + 1} / {STEPS.length}</div>
        <h3>{s.title}</h3>
        <p>{s.body}</p>
        <div className="tour-actions">
          {step > 0 && <button className="btn ghost" onClick={back}>Back</button>}
          <button className="btn ghost" onClick={onDone}>Skip tour</button>
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={next}>
            {s.cta ?? (step === STEPS.length - 1 ? 'Finish' : 'Next →')}
          </button>
        </div>
      </div>
    </div>
  )
}
