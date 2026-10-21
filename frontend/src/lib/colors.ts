/**
 * Colour functions that mirror 3Dmol's cartoon palettes so the sequence strip
 * and the 3D viewer stay in visual lockstep.
 *
 * - spectrum: 3Dmol's 'spectrum' goes purple/blue (N-term) → red (C-term).
 *   We approximate it with HSL hue 270° → 0°.
 * - plddt:    3Dmol's 'roygb' gradient mapped over [0.3, 1.0] of B-factor —
 *             low confidence = red, high = blue.
 * - structure: per-residue secondary structure → helix (rust),
 *              coil (slate), loop (violet).
 */

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r: number, g: number, b: number
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  const to255 = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${to255(r)}${to255(g)}${to255(b)}`
}

export function spectrumColor(index: number, total: number): string {
  if (total <= 1) return hslToHex(135, 0.7, 0.55)
  const t = index / (total - 1)
  const hue = 270 - 270 * t
  return hslToHex(hue, 0.75, 0.55)
}

export function plddtColor(plddt: number): string {
  const t = Math.max(0, Math.min(1, (plddt - 0.3) / 0.7))
  const hue = 0 + 240 * t
  return hslToHex(hue, 0.75, 0.55)
}

export type SS = 'H' | 'C' | 'L'

export function structureColor(ss: SS): string {
  // Match the SS-cell gradients in App.css: helix = rust, coil = slate, loop = violet.
  if (ss === 'H') return 'oklch(0.7 0.16 30)'
  if (ss === 'L') return 'oklch(0.7 0.15 280)'
  return 'oklch(0.7 0.05 240)'
}

/* ----- amino-acid categories (used by mutation popover + debrief swatches) ----- */

export type AACategory = 'hydro' | 'polar' | 'pos' | 'neg' | 'spec'

export const AA_CATS: Record<AACategory, { label: string; aas: string[] }> = {
  hydro: { label: 'Hydrophobic',     aas: ['A', 'V', 'L', 'I', 'M', 'F', 'W'] },
  polar: { label: 'Polar uncharged', aas: ['S', 'T', 'N', 'Q', 'Y', 'C'] },
  pos:   { label: 'Positive',        aas: ['K', 'R', 'H'] },
  neg:   { label: 'Negative',        aas: ['D', 'E'] },
  spec:  { label: 'Special',         aas: ['G', 'P'] },
}

export const AA_CAT: Record<string, AACategory> = (() => {
  const m: Record<string, AACategory> = {}
  for (const k of Object.keys(AA_CATS) as AACategory[]) {
    for (const a of AA_CATS[k].aas) m[a] = k
  }
  return m
})()
