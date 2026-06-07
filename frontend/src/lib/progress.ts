/**
 * Per-puzzle player progress, persisted to localStorage.
 *
 * Keyed by puzzle id (both static `puzzleN` and procedurally generated
 * `gen-*` / `pdb-*` puzzles). For each puzzle we remember the best RMSD
 * the player has ever achieved on it, the mutation count at that best,
 * and whether they ever crossed the solved threshold.
 *
 * This is "play history," not "save state" — we don't persist the
 * current sequence, only the best outcome. Reloading the page restarts
 * the active session but the puzzle picker still shows a checkmark on
 * everything solved before.
 */

const KEY = 'foldit-progress'

export interface PuzzleProgress {
  /** Best RMSD (Å) achieved on this puzzle, ever. */
  bestRmsd: number
  /** Mutation count at the best RMSD. */
  mutationsAtBest: number
  /** True if the player has crossed the solved threshold at least once. */
  solved: boolean
  /** ISO timestamp of the last update. */
  lastPlayedISO: string
}

export type ProgressMap = Record<string, PuzzleProgress>

/** Read the full progress map. Returns `{}` if storage is empty or corrupt. */
export function readProgress(): ProgressMap {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as ProgressMap
  } catch {
    /* fall through */
  }
  return {}
}

/** Read progress for a single puzzle (or `null` if never played). */
export function getProgress(puzzleId: string): PuzzleProgress | null {
  return readProgress()[puzzleId] ?? null
}

/**
 * Record an attempt. If `rmsd` is a new best, persist it; otherwise just
 * update `lastPlayedISO`. `solved` sticks once true — re-attempting a
 * solved puzzle and overshooting doesn't un-solve it.
 *
 * Returns the updated `PuzzleProgress` so the caller can show "new best!"
 * UI on a transition.
 */
export function recordAttempt(
  puzzleId: string,
  rmsd: number,
  mutationsUsed: number,
  justSolved: boolean,
): PuzzleProgress {
  const map = readProgress()
  const prev = map[puzzleId]
  const isNewBest = !prev || rmsd < prev.bestRmsd
  const updated: PuzzleProgress = {
    bestRmsd: isNewBest ? rmsd : prev.bestRmsd,
    mutationsAtBest: isNewBest ? mutationsUsed : prev.mutationsAtBest,
    solved: (prev?.solved ?? false) || justSolved,
    lastPlayedISO: new Date().toISOString(),
  }
  map[puzzleId] = updated
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* localStorage full or disabled — silently ignore, in-memory still works for the session */
  }
  return updated
}

/** Forget all progress. Used for testing / a future "reset progress" setting. */
export function resetProgress(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
