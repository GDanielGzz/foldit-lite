import { useMemo, useState, type CSSProperties } from 'react'
import { MutationPopover } from './MutationPopover'
import { spectrumColor, plddtColor, structureColor } from '../lib/colors'
import type { SS } from '../lib/colors'

export type ColorMode = 'spectrum' | 'plddt' | 'structure'

interface SequenceDockProps {
  sequence: string
  startingSequence: string
  perResiduePlddt: number[]
  ssAnnotation: SS[]
  colorMode: ColorMode
  budget: number
  used: number
  disabled?: boolean
  onMutate: (position: number, newAA: string) => void
  onHover?: (position: number | null) => void
}

const CHUNK = 10

export function SequenceDock({
  sequence,
  startingSequence,
  perResiduePlddt,
  ssAnnotation,
  colorMode,
  budget,
  used,
  disabled,
  onMutate,
  onHover,
}: SequenceDockProps) {
  const [openPos, setOpenPos] = useState<number | null>(null)
  const budgetLeft = Math.max(0, budget - used)

  const chunks = useMemo(() => {
    const out: { start: number; end: number }[] = []
    for (let i = 0; i < sequence.length; i += CHUNK) {
      out.push({ start: i, end: Math.min(i + CHUNK, sequence.length) })
    }
    return out
  }, [sequence.length])

  const stripeColor = (i: number): string => {
    if (colorMode === 'plddt') {
      const v = perResiduePlddt[i]
      if (v === undefined) return 'transparent'
      return plddtColor(v)
    }
    if (colorMode === 'structure') {
      return structureColor(ssAnnotation[i] ?? 'C')
    }
    return spectrumColor(i, sequence.length)
  }

  const isMutated = (i: number) => sequence[i] !== startingSequence[i]

  const legendLabel =
    colorMode === 'spectrum' ? 'N → C'
    : colorMode === 'plddt'  ? 'low → high pLDDT'
    : 'helix / coil / loop'

  return (
    <div className="dock">
      <div className="dock-meta">
        <span className="dock-title">
          <b>Sequence</b> · click any residue to mutate · hover to highlight in 3D
        </span>

        <span className="legend">
          <span className={`legend-bar ${colorMode}`} />
          <span>{legendLabel}</span>
        </span>

        <span className="legend">
          <span className="ss-swatch ss-h" /><span>helix</span>
          <span className="ss-swatch ss-c" /><span>coil</span>
          <span className="ss-swatch ss-l" /><span>loop</span>
        </span>

        <span className="ml-auto budget-pill">
          <span>Budget</span>
          <span className="pips">
            {Array.from({ length: budget }).map((_, i) => (
              <span key={i} className={`pip ${i < used ? 'used' : ''}`} />
            ))}
          </span>
          <span>{budgetLeft} left</span>
        </span>
      </div>

      <div className="seq-scroll">
        <div className="seq-chunks">
          {chunks.map((chunk, ci) => (
            <div key={ci} className="seq-chunk">
              {/* SS track */}
              <div className="ss-track">
                {Array.from({ length: chunk.end - chunk.start }).map((_, j) => {
                  const i = chunk.start + j
                  const ss = ssAnnotation[i] ?? 'C'
                  return (
                    <span
                      key={i}
                      className={`ss-cell ss-${ss.toLowerCase()}`}
                      title={`${i + 1}: ${ss}`}
                    />
                  )
                })}
              </div>

              {/* Cells */}
              <div className="seq-row">
                {Array.from({ length: chunk.end - chunk.start }).map((_, j) => {
                  const i = chunk.start + j
                  const aa = sequence[i]
                  const mut = isMutated(i)
                  const open = openPos === i
                  const locked = !disabled && budgetLeft <= 0 && !mut
                  const cellDisabled = disabled || locked
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`cell ${mut ? 'mut' : ''} ${open ? 'active' : ''} ${locked ? 'locked' : ''}`}
                      style={{ ['--stripe' as string]: stripeColor(i) } as CSSProperties}
                      disabled={cellDisabled && !open}
                      onMouseEnter={() => onHover?.(i)}
                      onMouseLeave={() => onHover?.(null)}
                      onFocus={() => onHover?.(i)}
                      onBlur={() => onHover?.(null)}
                      onClick={() => {
                        if (cellDisabled) return
                        setOpenPos(open ? null : i)
                      }}
                      title={
                        `Position ${i + 1}: ${aa}` +
                        (mut ? ` (was ${startingSequence[i]})` : '') +
                        (perResiduePlddt[i] !== undefined ? ` · pLDDT ${perResiduePlddt[i].toFixed(2)}` : '')
                      }
                    >
                      <span className="aa">{aa}</span>
                      {open && (
                        <MutationPopover
                          pos={i}
                          starting={startingSequence[i]}
                          current={aa}
                          plddt={perResiduePlddt[i]}
                          onPick={(newAa) => {
                            onMutate(i, newAa)
                            setOpenPos(null)
                          }}
                          onClose={() => setOpenPos(null)}
                        />
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Ruler */}
              <div className="chunk-ruler mono">
                <span>{chunk.start + 1}</span>
                <span className="ml-auto">{chunk.end}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
