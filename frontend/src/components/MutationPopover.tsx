import { useEffect, useRef } from 'react'
import { AA_CAT, AA_CATS, type AACategory } from '../lib/colors'

interface MutationPopoverProps {
  pos: number
  starting: string
  current: string
  plddt: number | undefined
  onPick: (newAa: string) => void
  onClose: () => void
}

const ORDERED_CATS: AACategory[] = ['hydro', 'polar', 'pos', 'neg', 'spec']

export function MutationPopover({ pos, starting, current, plddt, onPick, onClose }: MutationPopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  // Shift the popover left if it would overflow the viewport.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.left = '0px'
    const rect = el.getBoundingClientRect()
    const overflowRight = rect.right - window.innerWidth + 14
    if (overflowRight > 0) el.style.left = `${-overflowRight}px`
  }, [pos])

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="popover" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div className="popover-head">
        <span className="ptitle">
          Position <b className="mono">{pos + 1}</b> · was <b className="mono">{starting}</b>
          {plddt !== undefined && (
            <>
              {' '}· pLDDT <b className="mono">{plddt.toFixed(2)}</b>
            </>
          )}
        </span>
        <button className="popover-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="aa-grid">
        {ORDERED_CATS.flatMap((cat) => AA_CATS[cat].aas).map((aa) => {
          const cat = AA_CAT[aa]
          const isCur = aa === current
          const isOrig = aa === starting
          return (
            <button
              key={aa}
              className={`aa-btn cat-${cat} ${isCur ? 'is-cur' : ''} ${isOrig && !isCur ? 'is-orig' : ''}`}
              onClick={() => onPick(aa)}
              title={`${aa} · ${AA_CATS[cat].label}${isOrig ? ' (original)' : ''}`}
            >
              {aa}
            </button>
          )
        })}
      </div>

      <div className="popover-foot">
        <span className="lk"><span className="sw cat-hydro" />hydrophobic</span>
        <span className="lk"><span className="sw cat-polar" />polar</span>
        <span className="lk"><span className="sw cat-pos" />+</span>
        <span className="lk"><span className="sw cat-neg" />−</span>
        <span className="lk"><span className="sw cat-spec" />special</span>
      </div>
    </div>
  )
}
