import type { SS } from './colors'

/**
 * Toy client-side secondary-structure annotator.
 *
 * The real codebase should replace this with either:
 *   1. A server-side DSSP pass exposed as `ss_per_residue` on the predict
 *      response; or
 *   2. 3Dmol's parsed `ss` per atom (read after `addModel`).
 *
 * Until that lands, we approximate from a 5-residue smoothed helix-propensity
 * with Pro/Gly forced to loop (the same heuristic the redesign prototype
 * uses in `redesign/app.jsx`).
 */
const HELIX_FAVOR: Record<string, number> = {
  A: 1, E: 1, K: 1, L: 1, M: 1,
  Q: 0.8, R: 0.7, F: 0.6, I: 0.6, V: 0.4,
  S: 0.4, T: 0.4, H: 0.4, W: 0.4, N: 0.3, C: 0.3,
  Y: 0.2, D: 0.1, G: -0.5, P: -1,
}

export function annotateSS(sequence: string): SS[] {
  const n = sequence.length
  const raw = new Array(n)
  for (let i = 0; i < n; i++) raw[i] = HELIX_FAVOR[sequence[i]] ?? 0

  const smoothed = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    let s = 0, count = 0
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      s += raw[j]
      count++
    }
    smoothed[i] = s / count
  }

  const out: SS[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const aa = sequence[i]
    if (aa === 'P' || aa === 'G') {
      out[i] = 'L'
      continue
    }
    const v = smoothed[i]
    if (v >= 0.55) out[i] = 'H'
    else if (v <= 0.15) out[i] = 'L'
    else out[i] = 'C'
  }
  return out
}
