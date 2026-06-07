import { useCallback, useRef, useState } from 'react'
import { StructureViewer } from './StructureViewer'
import { IconRotate, IconCamera, IconMaximize, IconReset } from './Icons'
import type { ColorMode } from './SequenceDock'

interface ViewerStageProps {
  pdb: string | null
  colorMode: ColorMode
  highlightPosition: number | null
  source: string | null
  elapsedMs: number | null
  plddtMean: number | null
  predicting: boolean
  /** True while we're between puzzles — viewer is blank, no structure to show. */
  switching?: boolean
  mutationsUsed: number
  /** Used to build a sensible filename for snapshot downloads. */
  puzzleId?: string
  onSetColorMode: (mode: ColorMode) => void
  onReset: () => void
}

export function ViewerStage({
  pdb,
  colorMode,
  highlightPosition,
  source,
  elapsedMs,
  plddtMean,
  predicting,
  switching = false,
  mutationsUsed,
  puzzleId,
  onSetColorMode,
  onReset,
}: ViewerStageProps) {
  const viewerWrapRef = useRef<HTMLDivElement | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerInstanceRef = useRef<any>(null)
  const [spinning, setSpinning] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  // Callback ref so StructureViewer can hand us the live $3Dmol viewer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleViewerReady = useCallback((viewer: any) => {
    viewerInstanceRef.current = viewer
    // If the user had auto-rotate on when the model swapped, re-arm it.
    if (spinning && viewer) viewer.spin?.('y')
  }, [spinning])

  const toggleSpin = () => {
    const v = viewerInstanceRef.current
    if (!v?.spin) return
    if (spinning) {
      v.spin(false)
      setSpinning(false)
    } else {
      v.spin('y')
      setSpinning(true)
    }
  }

  const downloadSnapshot = () => {
    try {
      // 3Dmol exposes pngURI() which re-renders + reads the buffer in one
      // step — works even when the WebGL context didn't preserve the
      // drawing buffer. Fall back to canvas.toDataURL if that API isn't
      // available (older builds).
      let url: string | undefined
      const v = viewerInstanceRef.current
      if (v?.pngURI) {
        url = v.pngURI()
      } else {
        const canvas = viewerWrapRef.current?.querySelector('canvas') as HTMLCanvasElement | null
        if (!canvas) return
        v?.render?.()
        url = canvas.toDataURL('image/png')
      }
      if (!url) return
      const a = document.createElement('a')
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      a.href = url
      a.download = `foldit-${puzzleId ?? 'snapshot'}-${stamp}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch {
      /* tainted canvas or browser quirk — silently fail */
    }
  }

  const toggleFullscreen = () => {
    const el = viewerWrapRef.current
    if (!el) return
    if (document.fullscreenElement === el) {
      document.exitFullscreen?.()
      setFullscreen(false)
    } else {
      el.requestFullscreen?.()
        .then(() => setFullscreen(true))
        .catch(() => { /* user denied */ })
    }
  }

  const canRotate = !!pdb && !switching
  const canSnap   = !!pdb && !switching
  const canFull   = !!viewerWrapRef.current

  return (
    <section className="stage">
      <div className="viewer" ref={viewerWrapRef}>
        {/* Top-left HUD chips */}
        <div className="hud hud-tl">
          <div className="chip" title="Prediction source">
            <span className={`dot ${predicting ? 'predict' : 'good'}`} />
            <span>{switching ? 'switching' : predicting ? 'predicting' : source ?? 'esmfold'}</span>
            <span style={{ color: 'var(--muted-2)' }}>
              · {predicting || switching ? '...' : elapsedMs != null ? `${elapsedMs}` : '—'} ms
            </span>
          </div>
          <div className="chip">
            <span className="dot warn" />
            <span>pLDDT</span>
            <code>{plddtMean != null ? plddtMean.toFixed(2) : '—'}</code>
          </div>
        </div>

        {/* Top-right viewer controls — now live */}
        <div className="hud hud-tr">
          <div className="ctl-row">
            <button
              className={`ctl-btn ${spinning ? 'on' : ''}`}
              title={spinning ? 'Stop auto-rotate' : 'Auto-rotate'}
              onClick={toggleSpin}
              disabled={!canRotate}
              aria-pressed={spinning}
            >
              <IconRotate />
            </button>
            <button
              className="ctl-btn"
              title="Download a PNG snapshot"
              onClick={downloadSnapshot}
              disabled={!canSnap}
            >
              <IconCamera />
            </button>
            <button
              className={`ctl-btn ${fullscreen ? 'on' : ''}`}
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={toggleFullscreen}
              disabled={!canFull}
              aria-pressed={fullscreen}
            >
              <IconMaximize />
            </button>
          </div>
        </div>

        {/* 3D canvas */}
        <div className="viewer-canvas">
          {pdb && (
            <StructureViewer
              pdb={pdb}
              colorMode={colorMode}
              highlightPosition={highlightPosition}
              backgroundColor="rgba(0,0,0,0)"
              onReady={handleViewerReady}
            />
          )}
        </div>

        {/* Switching-puzzle overlay */}
        {switching && (
          <div className="viewer-switching" role="status" aria-live="polite">
            <span className="app-loading-spinner" />
            <span>Loading puzzle…</span>
          </div>
        )}

        {/* Coordinate axes */}
        <div className="viewer-axes">
          <svg viewBox="0 0 60 60">
            <line x1="10" y1="50" x2="50" y2="50" stroke="currentColor" strokeWidth="1.2" />
            <line x1="10" y1="50" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
            <line x1="10" y1="50" x2="32" y2="28" stroke="currentColor" strokeWidth="1.2" />
            <text x="52" y="53">x</text>
            <text x="2" y="13">y</text>
            <text x="34" y="26">z</text>
          </svg>
        </div>

        {/* Bottom-left segmented control */}
        <div className="hud hud-bl">
          <div className="viewer-controls" role="tablist" aria-label="Colour mode">
            <button
              className={`seg ${colorMode === 'spectrum' ? 'on' : ''}`}
              onClick={() => onSetColorMode('spectrum')}
              role="tab"
              aria-selected={colorMode === 'spectrum'}
            >
              N→C
            </button>
            <button
              className={`seg ${colorMode === 'plddt' ? 'on' : ''}`}
              onClick={() => onSetColorMode('plddt')}
              role="tab"
              aria-selected={colorMode === 'plddt'}
            >
              pLDDT
            </button>
            <button
              className={`seg ${colorMode === 'structure' ? 'on' : ''}`}
              onClick={() => onSetColorMode('structure')}
              role="tab"
              aria-selected={colorMode === 'structure'}
            >
              Structure
            </button>
          </div>
        </div>

        {/* Bottom-right reset */}
        <div className="hud hud-br">
          <button
            className="btn ghost"
            onClick={onReset}
            disabled={mutationsUsed === 0 || predicting || switching}
          >
            <IconReset /> Reset
          </button>
        </div>
      </div>
    </section>
  )
}
