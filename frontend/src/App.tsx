import { useEffect, useMemo, useRef, useState } from 'react'
import { TopBar } from './components/TopBar'
import { ViewerStage } from './components/ViewerStage'
import { HeroScore } from './components/HeroScore'
import { TutorCard } from './components/TutorCard'
import { SequenceDock, type ColorMode } from './components/SequenceDock'
import { NewPuzzleModal } from './components/NewPuzzleModal'
import { DebriefModal, type MutationLogEntry } from './components/DebriefModal'
import { OnboardingTour } from './components/OnboardingTour'
import { AppLoading } from './components/AppLoading'
import { ErrorToast } from './components/ErrorToast'
import { IconArrow, IconCheck, IconPlus } from './components/Icons'
import { useSettings } from './contexts/SettingsContext'
import { annotateSS } from './lib/ss'
import { readProgress, recordAttempt, type ProgressMap } from './lib/progress'
import {
  predict,
  getPuzzle,
  listPuzzles,
  generatePuzzle,
  importPdbPuzzle,
  getTutorStatus,
  explainMutation,
  ApiError,
  type PredictResponse,
  type Puzzle,
  type ExplainResponse,
} from './lib/api'
import './App.css'

const FIRST_PUZZLE_ID = 'puzzle1'
const TOUR_KEY = 'foldit-tour-seen'

// Debug surfaces (token counter, etc.) — enable with ?debug=1 in the URL.
const DEBUG = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('debug') === '1'

// Initial puzzle from ?puzzle=<id> (share-by-URL deep link). If the id
// doesn't exist server-side we fall back to FIRST_PUZZLE_ID via the
// puzzle-load effect's catch.
const URL_PUZZLE_ID = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('puzzle')
  : null

function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length)
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
  return n
}

type Status = 'loading' | 'idle' | 'predicting' | 'error'

function App() {
  const { layout } = useSettings()

  // ----- Game state -----
  const [puzzles, setPuzzles] = useState<Puzzle[]>([])
  const [currentPuzzleId, setCurrentPuzzleId] = useState<string>(URL_PUZZLE_ID || FIRST_PUZZLE_ID)
  const [shareCopied, setShareCopied] = useState(false)
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [sequence, setSequence] = useState<string>('')
  const [prediction, setPrediction] = useState<PredictResponse | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [colorMode, setColorMode] = useState<ColorMode>('spectrum')
  const [hoveredPosition, setHoveredPosition] = useState<number | null>(null)

  // ----- Score history + mutation log + celebrate transition -----
  const [scoreHistory, setScoreHistory] = useState<number[]>([])
  const [mutationLog, setMutationLog] = useState<MutationLogEntry[]>([])
  const [celebrate, setCelebrate] = useState(false)
  const wasSolvedRef = useRef(false)

  // ----- Per-puzzle progress (best RMSD, solved-ever) from localStorage -----
  const [progress, setProgress] = useState<ProgressMap>(readProgress)

  // ----- Modal / tour visibility -----
  const [showGenerator, setShowGenerator] = useState(false)
  const [showDebrief, setShowDebrief] = useState(false)
  const [showTour, setShowTour] = useState<boolean>(() => {
    try { return !localStorage.getItem(TOUR_KEY) } catch { return false }
  })

  // ----- Tutor state -----
  const [tutorAvailable, setTutorAvailable] = useState(false)
  const [tutorLoading, setTutorLoading] = useState(false)
  const [tutorExplanation, setTutorExplanation] = useState<string | null>(null)
  const [tutorTokens, setTutorTokens] = useState<ExplainResponse | null>(null)

  // Track the last single-residue mutation so the tutor can explain it.
  const lastMutationRef = useRef<{
    prevSequence: string
    prevPrediction: PredictResponse
    position: number
  } | null>(null)
  const lastSequenceRef = useRef<string>('')
  const lastPredictionRef = useRef<PredictResponse | null>(null)
  const inflightRef = useRef<AbortController | null>(null)

  // ----- Initial: load puzzle list + tutor status -----
  useEffect(() => {
    const ctrl = new AbortController()
    listPuzzles(ctrl.signal)
      .then((ps) => setPuzzles(ps))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setErrorMsg(err instanceof Error ? err.message : String(err))
      })
    getTutorStatus(ctrl.signal)
      .then((s) => setTutorAvailable(s.available))
      .catch(() => setTutorAvailable(false))
    return () => ctrl.abort()
  }, [])

  // ----- Sync ?puzzle=<id> into the URL whenever the puzzle changes -----
  // history.replaceState (not pushState) so we don't pollute the back stack
  // — the user can still navigate back to whatever brought them to the app.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.get('puzzle') === currentPuzzleId) return
    url.searchParams.set('puzzle', currentPuzzleId)
    window.history.replaceState({}, '', url.toString())
  }, [currentPuzzleId])

  // ----- Load (or reload) the current puzzle whenever its id changes -----
  useEffect(() => {
    const ctrl = new AbortController()
    setStatus('loading')
    setPrediction(null)
    setTutorExplanation(null)
    setTutorTokens(null)
    setScoreHistory([])
    setMutationLog([])
    setCelebrate(false)
    setShowDebrief(false)
    wasSolvedRef.current = false
    lastMutationRef.current = null
    lastSequenceRef.current = ''
    lastPredictionRef.current = null
    getPuzzle(currentPuzzleId, ctrl.signal)
      .then((p) => {
        setPuzzle(p)
        setSequence(p.starting_sequence)
        setStatus('idle')
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        // Share-by-URL fallback: if the deep-linked id doesn't exist
        // (e.g. a generated puzzle from a previous server boot), bounce
        // to the first static puzzle instead of stranding the user.
        if (currentPuzzleId !== FIRST_PUZZLE_ID && err instanceof ApiError && err.status === 404) {
          setCurrentPuzzleId(FIRST_PUZZLE_ID)
          return
        }
        setErrorMsg(err instanceof Error ? err.message : String(err))
        setStatus('error')
      })
    return () => ctrl.abort()
  }, [currentPuzzleId])

  // ----- Predict whenever sequence changes (and a puzzle is loaded) -----
  useEffect(() => {
    if (!puzzle || !sequence) return
    inflightRef.current?.abort()
    const ctrl = new AbortController()
    inflightRef.current = ctrl
    setStatus('predicting')
    setErrorMsg(null)
    predict(sequence, puzzle.id, ctrl.signal)
      .then((data) => {
        if (ctrl.signal.aborted) return

        // Capture single-residue diff for tutor context.
        const prevSeq = lastSequenceRef.current
        const prevPred = lastPredictionRef.current
        if (prevPred && prevSeq && prevSeq.length === sequence.length && prevSeq !== sequence) {
          let diffPos = -1
          let diffs = 0
          for (let i = 0; i < sequence.length; i++) {
            if (prevSeq[i] !== sequence[i]) {
              diffs++
              diffPos = i
              if (diffs > 1) break
            }
          }
          lastMutationRef.current = diffs === 1
            ? { prevSequence: prevSeq, prevPrediction: prevPred, position: diffPos }
            : null
        } else if (!prevPred || prevSeq !== sequence) {
          lastMutationRef.current = null
        }
        lastSequenceRef.current = sequence
        lastPredictionRef.current = data
        setPrediction(data)
        setStatus('idle')

        // Push into the score history sparkline (cap at 10).
        if (data.score) {
          setScoreHistory((h) => [...h, data.score!.rmsd].slice(-10))
        }

        // Persist progress (best RMSD + solved-ever) for the puzzle picker.
        if (data.score && puzzle) {
          const muts = hammingDistance(sequence, puzzle.starting_sequence)
          recordAttempt(puzzle.id, data.score.rmsd, muts, data.score.solved)
          setProgress(readProgress())
        }

        // Celebrate on the false → true solved transition.
        if (data.score?.solved && !wasSolvedRef.current) {
          wasSolvedRef.current = true
          setCelebrate(true)
          window.setTimeout(() => setCelebrate(false), 2400)
          window.setTimeout(() => setShowDebrief(true), 1800)
        } else if (!data.score?.solved) {
          wasSolvedRef.current = false
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        const msg = err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error ? err.message : String(err)
        setErrorMsg(msg)
        setStatus('error')
      })
  }, [puzzle, sequence])

  // ----- Prefetch the next static puzzle's starter prediction -----
  // While the player is solving puzzle N, fire a fire-and-forget /predict
  // for puzzle N+1's starting sequence. The response populates the
  // server-side SQLite cache, so when they actually click "Next puzzle →"
  // the cached prediction lands in ~10ms instead of 1–5s.
  //
  // We only prefetch each id once per page load (prefetchedRef set) and
  // abort the request if the user navigates away first.
  const prefetchedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!puzzle || !prediction || puzzles.length === 0) return
    const idx = puzzles.findIndex((p) => p.id === puzzle.id)
    const next = idx >= 0 && idx < puzzles.length - 1 ? puzzles[idx + 1] : null
    if (!next || prefetchedRef.current.has(next.id)) return
    prefetchedRef.current.add(next.id)
    const ctrl = new AbortController()
    predict(next.starting_sequence, next.id, ctrl.signal).catch(() => {
      /* swallow — this is a speculative warm-up, not user-facing */
    })
    return () => ctrl.abort()
  }, [puzzle?.id, prediction, puzzles])

  // ----- Keyboard shortcuts -----
  // R   reset to starting sequence
  // N   advance to next static puzzle in the catalog
  // ?   replay the welcome tour
  // 1/2/3   cycle color modes (N→C, pLDDT, Structure)
  //
  // Shortcuts suppress themselves whenever the user is typing into an
  // input/textarea or whenever a modal/tour overlay is mounted — those
  // surfaces own their own Esc handlers and the player typing a PDB id
  // shouldn't accidentally reset the puzzle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
      if (document.querySelector('.modal-backdrop, .tour, .settings-pop, .popover')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      switch (e.key) {
        case 'r': case 'R': {
          if (!puzzle) return
          const muts = hammingDistance(sequence, puzzle.starting_sequence)
          if (muts === 0 || status !== 'idle') return
          e.preventDefault()
          reset()
          break
        }
        case 'n': case 'N': {
          if (!puzzles.length || !puzzle) return
          const idx = puzzles.findIndex((p) => p.id === puzzle.id)
          const next = idx >= 0 && idx < puzzles.length - 1 ? puzzles[idx + 1] : null
          if (!next || status !== 'idle') return
          e.preventDefault()
          setCurrentPuzzleId(next.id)
          break
        }
        case '?': {
          e.preventDefault()
          setShowTour(true)
          break
        }
        case '1':
          e.preventDefault()
          setColorMode('spectrum')
          break
        case '2':
          e.preventDefault()
          setColorMode('plddt')
          break
        case '3':
          e.preventDefault()
          setColorMode('structure')
          break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle?.id, sequence, status, puzzles])

  // ----- Actions -----
  const mutate = (position: number, newAA: string) => {
    if (!puzzle || !prediction) return
    if (sequence[position] === newAA) return
    const wasMut = sequence[position] !== puzzle.starting_sequence[position]
    const mutationsUsed = hammingDistance(sequence, puzzle.starting_sequence)
    if (mutationsUsed >= puzzle.mutation_budget && !wasMut) return
    const prevAA = sequence[position]
    setSequence((prev) => prev.substring(0, position) + newAA + prev.substring(position + 1))
    setMutationLog((log) => [
      ...log,
      { pos: position, prev: prevAA, next: newAA, rmsdBefore: prediction.score?.rmsd ?? 0 },
    ])
  }

  const reset = () => {
    if (!puzzle) return
    setSequence(puzzle.starting_sequence)
    setMutationLog([])
    setTutorExplanation(null)
    setTutorTokens(null)
    lastMutationRef.current = null
  }

  const askTutor = async () => {
    const last = lastMutationRef.current
    if (!puzzle || !last || !prediction) return
    setTutorLoading(true)
    setTutorExplanation(null)
    try {
      const result = await explainMutation({
        puzzle_id: puzzle.id,
        position: last.position,
        prev_aa: last.prevSequence[last.position],
        new_aa: sequence[last.position],
        prev_rmsd: last.prevPrediction.score?.rmsd ?? null,
        new_rmsd: prediction.score?.rmsd ?? null,
        prev_plddt_mean: last.prevPrediction.plddt_mean,
        new_plddt_mean: prediction.plddt_mean,
        prev_pos_plddt: last.prevPrediction.plddt_per_residue?.[last.position] ?? null,
        new_pos_plddt: prediction.plddt_per_residue?.[last.position] ?? null,
      })
      setTutorExplanation(result.explanation)
      setTutorTokens(result)
    } catch (err: unknown) {
      const msg = err instanceof ApiError
        ? `${err.status}: ${err.message}`
        : err instanceof Error ? err.message : String(err)
      setTutorExplanation(`Tutor failed: ${msg}`)
      setTutorTokens(null)
    } finally {
      setTutorLoading(false)
    }
  }

  const handleGenerate = async (template: string, difficulty: 'easy' | 'medium' | 'hard') => {
    const generated = await generatePuzzle({ template, difficulty })
    setPuzzles((prev) => {
      const filtered = prev.filter((p) => p.id !== generated.id)
      return [...filtered, generated]
    })
    setCurrentPuzzleId(generated.id)
  }

  const handleImport = async (pdbId: string, chain: string, difficulty: 'easy' | 'medium' | 'hard') => {
    const generated = await importPdbPuzzle({ pdb_id: pdbId, chain, difficulty })
    setPuzzles((prev) => {
      const filtered = prev.filter((p) => p.id !== generated.id)
      return [...filtered, generated]
    })
    setCurrentPuzzleId(generated.id)
  }

  const ssAnnotation = useMemo(() => (sequence ? annotateSS(sequence) : []), [sequence])

  // ----- Derived view state -----
  // On the very first load (no puzzle in state yet) show the full-screen
  // loading splash. On every subsequent puzzle switch the shell stays
  // mounted — only the viewer + dock blank out while the new puzzle
  // arrives, so the topbar and rail don't flicker.
  if (!puzzle) {
    return <AppLoading caption="Loading puzzle…" />
  }
  const switching = status === 'loading'

  const mutationsUsed = hammingDistance(sequence, puzzle.starting_sequence)
  const solved = prediction?.score?.solved ?? false
  const score = prediction?.score
  const baseline = puzzle.baseline_rmsd
  const target = puzzle.expected_solved_rmsd

  const puzzleIndex = puzzles.findIndex((p) => p.id === currentPuzzleId)
  const nextPuzzleId = puzzleIndex >= 0 && puzzleIndex < puzzles.length - 1
    ? puzzles[puzzleIndex + 1].id
    : null

  const delta = (() => {
    const last = lastMutationRef.current
    if (!last || !score) return null
    const prev = last.prevPrediction.score?.rmsd
    if (prev == null) return null
    return score.rmsd - prev
  })()

  const tutorReason = status !== 'idle'
    ? 'Wait for the prediction to finish.'
    : 'Make a single-residue mutation first.'

  const retryPredict = () => {
    if (!puzzle) return
    setSequence((s) => s)
    // Trigger re-run by re-setting status; the predict effect runs on [puzzle, sequence].
    // Toggling sequence to itself won't refire. Force a refetch by reassigning.
    inflightRef.current?.abort()
    const ctrl = new AbortController()
    inflightRef.current = ctrl
    setStatus('predicting')
    setErrorMsg(null)
    predict(sequence, puzzle.id, ctrl.signal)
      .then((data) => {
        if (ctrl.signal.aborted) return
        lastSequenceRef.current = sequence
        lastPredictionRef.current = data
        setPrediction(data)
        setStatus('idle')
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        const msg = err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error ? err.message : String(err)
        setErrorMsg(msg)
        setStatus('error')
      })
  }

  const closeTour = () => {
    setShowTour(false)
    try { localStorage.setItem(TOUR_KEY, '1') } catch { /* ignore */ }
  }

  return (
    <div className="app">
      <TopBar
        puzzleTitle={puzzle.title}
        puzzleId={puzzle.id}
        difficulty={puzzle.difficulty}
        sequenceLength={sequence.length}
        puzzleIndex={puzzleIndex >= 0 ? puzzleIndex + 1 : 1}
        totalPuzzles={Math.max(puzzles.length, 1)}
        onReplayTour={() => setShowTour(true)}
      />

      <div className={`main ${layout === 'rail-left' ? 'left-rail' : ''}`}>
        <ViewerStage
          pdb={switching ? null : prediction?.pdb ?? null}
          colorMode={colorMode}
          highlightPosition={hoveredPosition}
          source={prediction?.source ?? null}
          elapsedMs={prediction?.elapsed_ms ?? null}
          plddtMean={prediction?.plddt_mean ?? null}
          predicting={status === 'predicting' || switching}
          switching={switching}
          mutationsUsed={mutationsUsed}
          puzzleId={puzzle.id}
          onSetColorMode={setColorMode}
          onReset={reset}
        />

        <aside className="rail">
          {/* Score */}
          <div className="rail-section">
            <div className="section-head">
              <span>Score</span>
              <span className="tag">target ≤ {target.toFixed(1)} Å</span>
            </div>

            <HeroScore
              rmsd={score?.rmsd ?? null}
              baseline={baseline}
              target={target}
              normalized={score?.normalized ?? 0}
              history={scoreHistory}
              delta={delta}
              solved={solved}
              celebrate={celebrate}
            />

            <div className="score-grid">
              <div className="score-stat">
                <span className="ss-label">Mutations</span>
                <span className="ss-value">
                  {mutationsUsed} <small>/ {puzzle.mutation_budget}</small>
                </span>
              </div>
              <div className="score-stat">
                <span className="ss-label">pLDDT</span>
                <span className="ss-value">
                  {prediction?.plddt_mean != null ? prediction.plddt_mean.toFixed(2) : '—'}
                </span>
              </div>
              <div className="score-stat">
                <span className="ss-label">Baseline</span>
                <span className="ss-value muted-num">{baseline.toFixed(1)} Å</span>
              </div>
            </div>

            {solved && nextPuzzleId && (
              <button className="btn primary" onClick={() => setCurrentPuzzleId(nextPuzzleId)}>
                Next puzzle <IconArrow />
              </button>
            )}
            {solved && !nextPuzzleId && (
              <div className="solved-strap">
                <span>All puzzles solved — more coming soon</span>
              </div>
            )}
          </div>

          {/* Puzzle */}
          <div className="rail-section">
            <div className="section-head">
              <span>Puzzle</span>
              <button
                className="tag tag-btn"
                onClick={() => {
                  const url = new URL(window.location.href)
                  url.searchParams.set('puzzle', puzzle.id)
                  // Optimistic UI: show "Copied!" immediately. If the clipboard
                  // API isn't available or refuses (some browser contexts deny
                  // programmatic writes), the address bar URL is still
                  // correct so the user can copy it manually as a fallback.
                  setShareCopied(true)
                  window.setTimeout(() => setShareCopied(false), 1500)
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    navigator.clipboard.writeText(url.toString()).catch(() => { /* ignore */ })
                  }
                }}
                title="Copy share link for this puzzle"
              >
                {shareCopied ? 'Copied!' : puzzle.id}
              </button>
            </div>
            <h1 className="puzzle-title">{puzzle.title}</h1>
            <p className="puzzle-desc">{puzzle.description}</p>
            {puzzle.hint && (
              <div className="puzzle-hint">
                <span><b style={{ color: 'var(--text)' }}>Hint —</b> {puzzle.hint}</span>
              </div>
            )}
          </div>

          {/* Tutor */}
          <div className="rail-section">
            <div className="section-head">
              <span>Tutor</span>
              <span className="tag">{tutorTokens?.model ?? 'Claude'}</span>
            </div>
            <TutorCard
              available={tutorAvailable}
              canExplain={!!lastMutationRef.current && status === 'idle'}
              reasonDisabled={tutorReason}
              loading={tutorLoading}
              explanation={tutorExplanation}
              onAsk={askTutor}
              debug={DEBUG}
              tokensInfo={
                tutorTokens
                  ? {
                      input: tutorTokens.input_tokens,
                      output: tutorTokens.output_tokens,
                      cached: tutorTokens.cached_tokens,
                      model: tutorTokens.model,
                    }
                  : null
              }
            />
          </div>

          {/* All puzzles */}
          <div className="rail-section">
            <div className="section-head"><span>All puzzles</span></div>
            <div className="puzzle-list">
              {puzzles.map((p, i) => {
                const prog = progress[p.id]
                const psub = prog
                  ? prog.solved
                    ? `Solved · best ${prog.bestRmsd.toFixed(2)} Å in ${prog.mutationsAtBest} muts`
                    : `Best ${prog.bestRmsd.toFixed(2)} Å · ${prog.mutationsAtBest} muts`
                  : `${p.starting_sequence.length} aa · ${p.mutation_budget} mutations`
                return (
                  <button
                    key={p.id}
                    className={`puzzle-card ${p.id === currentPuzzleId ? 'on' : ''} ${prog?.solved ? 'is-solved' : ''}`}
                    onClick={() => setCurrentPuzzleId(p.id)}
                    disabled={status === 'predicting' || p.id === currentPuzzleId}
                  >
                    <span className="pno">
                      {prog?.solved ? <span className="psolved" title="Solved"><IconCheck /></span> : `#${String(i + 1).padStart(2, '0')}`}
                    </span>
                    <span className="pmeta">
                      <span className="pname">{p.title}</span>
                      <span className="psub">{psub}</span>
                    </span>
                    <span className={`diff ${p.difficulty}`}>{p.difficulty}</span>
                  </button>
                )
              })}
            </div>
            <button
              className="btn ghost new-puzzle"
              onClick={() => setShowGenerator(true)}
              disabled={status === 'predicting'}
            >
              <IconPlus />
              New puzzle
            </button>
          </div>
        </aside>
      </div>

      <SequenceDock
        sequence={sequence}
        startingSequence={puzzle.starting_sequence}
        perResiduePlddt={prediction?.plddt_per_residue ?? []}
        ssAnnotation={ssAnnotation}
        colorMode={colorMode}
        budget={puzzle.mutation_budget}
        used={mutationsUsed}
        disabled={switching || status === 'predicting'}
        onMutate={mutate}
        onHover={setHoveredPosition}
      />

      {showGenerator && (
        <NewPuzzleModal
          onClose={() => setShowGenerator(false)}
          onGenerate={handleGenerate}
          onImportPdb={handleImport}
        />
      )}

      {showDebrief && score && (
        <DebriefModal
          puzzleTitle={puzzle.title}
          mutationBudget={puzzle.mutation_budget}
          baseline={baseline}
          finalRmsd={score.rmsd}
          mutationLog={mutationLog}
          hasNext={!!nextPuzzleId}
          onClose={() => setShowDebrief(false)}
          onNext={() => {
            setShowDebrief(false)
            if (nextPuzzleId) setCurrentPuzzleId(nextPuzzleId)
          }}
        />
      )}

      {showTour && <OnboardingTour onDone={closeTour} />}

      {status === 'error' && errorMsg && (
        <ErrorToast
          message={errorMsg}
          onDismiss={() => {
            setErrorMsg(null)
            setStatus('idle')
          }}
          onRetry={retryPredict}
        />
      )}
    </div>
  )
}

export default App
