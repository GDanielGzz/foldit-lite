import { useEffect, useRef } from 'react'
import * as $3Dmol from '3dmol'

type ColorMode = 'spectrum' | 'plddt' | 'structure' | string

interface StructureViewerProps {
  pdb: string
  colorMode?: ColorMode
  /** 0-indexed residue position to highlight as stick + bright CA sphere. */
  highlightPosition?: number | null
  backgroundColor?: string
  className?: string
  /**
   * Called once the underlying 3Dmol viewer is created. The wrapper
   * (ViewerStage) holds the reference so its HUD buttons can drive
   * `.spin()`, `.zoomTo()`, etc.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onReady?: (viewer: any) => void
}

// Approximate hex matches for the oklch palette used by lib/colors.ts → structureColor.
// 3Dmol's canvas pipeline doesn't speak oklch, so we hand it equivalent sRGB hex.
const SS_HELIX = '#cc7e54' // rust
const SS_SHEET = '#cc7e54' // (rare in our puzzles; mirror helix tint)
const SS_COIL  = '#8ba8c4' // slate
const SS_LOOP  = '#a07bcc' // violet

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function baseStyle(mode: ColorMode): any {
  if (mode === 'plddt') {
    return { cartoon: { colorscheme: { prop: 'b', gradient: 'roygb', min: 0.3, max: 1.0 } } }
  }
  if (mode === 'structure') {
    return {
      cartoon: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        colorfunc: (atom: any) => {
          const ss = (atom?.ss ?? '').toString().toLowerCase()
          if (ss === 'h') return SS_HELIX
          if (ss === 's') return SS_SHEET
          if (ss === 'l') return SS_LOOP
          return SS_COIL
        },
      },
    }
  }
  if (mode === 'spectrum') return { cartoon: { color: 'spectrum' } }
  return { cartoon: { color: mode } }
}

const HOVER_STICK = { stick: { colorscheme: 'whiteCarbon', radius: 0.22 } }
const HOVER_SPHERE = { sphere: { color: '#ffe14a', radius: 1.2 } }

/**
 * Mounts a 3Dmol viewer once. Three effects manage state:
 *  1. mount/unmount
 *  2. pdb change → reload model + zoom (camera reset is intentional, sequence changed)
 *  3. colorMode / highlightPosition change → restyle only, NO zoom (preserves rotation)
 */
export function StructureViewer({
  pdb,
  colorMode = 'spectrum',
  highlightPosition = null,
  backgroundColor = 'rgba(0,0,0,0)',
  className,
  onReady,
}: StructureViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null)

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return
    viewerRef.current = $3Dmol.createViewer(containerRef.current, { backgroundColor })
    onReady?.(viewerRef.current)
    return () => {
      viewerRef.current?.removeAllModels()
      viewerRef.current = null
    }
    // onReady is intentionally NOT a dep — we only want to notify on initial mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundColor])

  useEffect(() => {
    const v = viewerRef.current
    if (!v || !pdb) return
    v.removeAllModels()
    v.addModel(pdb, 'pdb')
    v.setStyle({}, baseStyle(colorMode))
    if (highlightPosition != null) {
      v.addStyle({ resi: highlightPosition + 1 }, HOVER_STICK)
      v.addStyle({ resi: highlightPosition + 1, atom: 'CA' }, HOVER_SPHERE)
    }
    v.zoomTo()
    v.render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdb])

  useEffect(() => {
    const v = viewerRef.current
    if (!v || !pdb) return
    v.setStyle({}, baseStyle(colorMode))
    if (highlightPosition != null) {
      v.addStyle({ resi: highlightPosition + 1 }, HOVER_STICK)
      v.addStyle({ resi: highlightPosition + 1, atom: 'CA' }, HOVER_SPHERE)
    }
    v.render()
  }, [colorMode, highlightPosition, pdb])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    />
  )
}
