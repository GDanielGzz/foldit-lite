export interface ScoreBlock {
  puzzle_id: string
  rmsd: number
  baseline_rmsd: number
  normalized: number  // 0-100
  solved: boolean
}

export interface PredictResponse {
  sequence: string
  length: number
  pdb: string
  plddt_mean: number | null
  plddt_per_residue: number[]
  source: 'cache' | 'esm_atlas'
  elapsed_ms: number
  score: ScoreBlock | null
}

export interface Puzzle {
  id: string
  title: string
  description: string
  starting_sequence: string
  mutation_budget: number
  baseline_rmsd: number
  expected_solved_rmsd: number
  hint: string | null
  difficulty: string
  generated?: boolean
  seed?: number | null
}

export interface GenerateRequest {
  template?: string
  difficulty: 'easy' | 'medium' | 'hard'
  seed?: number
}

export interface TemplateInfo {
  id: string
  label: string
  difficulties: string[]
  target_lengths: number[]
  hint: string
}

export async function listTemplates(signal?: AbortSignal): Promise<TemplateInfo[]> {
  const resp = await fetch('/puzzles/templates', { signal })
  return unwrap<TemplateInfo[]>(resp)
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function unwrap<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    // Read the body once: calling resp.text() after a failed resp.json()
    // throws "body already used" instead of surfacing the server's message.
    const text = await resp.text()
    let detail: string
    try {
      const body = JSON.parse(text)
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      detail = text
    }
    throw new ApiError(detail, resp.status)
  }
  return resp.json() as Promise<T>
}

export async function predict(
  sequence: string,
  scoreAgainst?: string,
  signal?: AbortSignal,
): Promise<PredictResponse> {
  const resp = await fetch('/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sequence, score_against: scoreAgainst ?? null }),
    signal,
  })
  return unwrap<PredictResponse>(resp)
}

export async function getPuzzle(id: string, signal?: AbortSignal): Promise<Puzzle> {
  const resp = await fetch(`/puzzles/${id}`, { signal })
  return unwrap<Puzzle>(resp)
}

export async function listPuzzles(signal?: AbortSignal): Promise<Puzzle[]> {
  const resp = await fetch('/puzzles', { signal })
  return unwrap<Puzzle[]>(resp)
}

export async function generatePuzzle(req: GenerateRequest, signal?: AbortSignal): Promise<Puzzle> {
  const resp = await fetch('/puzzles/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      template: req.template ?? 'marqusee',
      difficulty: req.difficulty,
      seed: req.seed ?? null,
    }),
    signal,
  })
  return unwrap<Puzzle>(resp)
}

export interface TutorStatus {
  available: boolean
  model: string
}

export interface ExplainRequest {
  puzzle_id: string
  position: number  // 0-indexed
  prev_aa: string
  new_aa: string
  prev_rmsd: number | null
  new_rmsd: number | null
  prev_plddt_mean: number | null
  new_plddt_mean: number | null
  prev_pos_plddt: number | null
  new_pos_plddt: number | null
}

export interface ExplainResponse {
  explanation: string
  model: string
  input_tokens: number
  output_tokens: number
  cached_tokens: number
}

export interface ImportPdbRequest {
  pdb_id: string
  chain: string
  difficulty: 'easy' | 'medium' | 'hard'
  seed?: number
}

export async function importPdbPuzzle(req: ImportPdbRequest, signal?: AbortSignal): Promise<Puzzle> {
  const resp = await fetch('/puzzles/from-pdb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  })
  return unwrap<Puzzle>(resp)
}

export async function getTutorStatus(signal?: AbortSignal): Promise<TutorStatus> {
  const resp = await fetch('/tutor/status', { signal })
  return unwrap<TutorStatus>(resp)
}

export async function explainMutation(req: ExplainRequest, signal?: AbortSignal): Promise<ExplainResponse> {
  const resp = await fetch('/tutor/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  })
  return unwrap<ExplainResponse>(resp)
}
