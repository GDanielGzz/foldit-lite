import { useEffect, useMemo, useState } from 'react'
import { listTemplates, type TemplateInfo } from '../lib/api'

type Difficulty = 'easy' | 'medium' | 'hard'
type Tab = 'generate' | 'import'

interface NewPuzzleModalProps {
  onClose: () => void
  onGenerate: (template: string, difficulty: Difficulty) => Promise<void>
  onImportPdb: (pdbId: string, chain: string, difficulty: Difficulty) => Promise<void>
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']

// Per-template summaries shown under the difficulty picker. Keyed by template id.
// Fallback prose is generated from TemplateInfo when an unknown template appears.
const DIFF_SUMMARY: Record<string, Record<Difficulty, string>> = {
  marqusee: {
    easy:   '28 aa Marqusee helix · 4 P/G breakers · gentle gradient · budget 6',
    medium: '42 aa Marqusee helix · 6 breakers · cooperative descent · budget 8',
    hard:   '56 aa Marqusee helix · 9 breakers · long chain · budget 11',
  },
  'gb1-hairpin': {
    easy:   '16 aa GB1 hairpin · 3 strand breakers · classic β-hairpin · budget 5',
    medium: '16 aa GB1 hairpin · 4 strand breakers · tighter gradient · budget 6',
    hard:   '16 aa GB1 hairpin · 5 strand breakers · max disruption · budget 7',
  },
  'gcn4-coil': {
    easy:   '33 aa GCN4 coiled-coil · 2 heptad-d Leu→Glu · budget 4',
    medium: '33 aa GCN4 coiled-coil · 3 core Leu→Glu · budget 5',
    hard:   '33 aa GCN4 coiled-coil · 5 Leu→Glu (4 core + 1 surface) · budget 7',
  },
}

// Pre-validated PDBs — these have been generated through the import flow at
// least once and produced solvable puzzles (high-pLDDT native, breakable
// helix content, non-trivial baseline gap). Anything with too many residues
// (>70 aa) or too little helical content is excluded.
const SUGGESTED_PDBS: { id: string; chain: string; name: string }[] = [
  { id: '1ENH', chain: 'A', name: 'Engrailed homeodomain · 54 aa · 3-helix' },
  { id: '1BDD', chain: 'A', name: 'Protein A B-domain · 60 aa · 3-helix' },
  { id: '1L2Y', chain: 'A', name: 'Trp-cage · 20 aa · α + polyproline cage' },
  { id: '1VII', chain: 'A', name: 'HP35 villin headpiece · 36 aa · 3-helix' },
]

export function NewPuzzleModal({ onClose, onGenerate, onImportPdb }: NewPuzzleModalProps) {
  const [tab, setTab] = useState<Tab>('generate')
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [template, setTemplate] = useState<string>('marqusee')
  const [genDiff, setGenDiff] = useState<Difficulty>('easy')
  const [importDiff, setImportDiff] = useState<Difficulty>('easy')
  const [pdbId, setPdbId] = useState('')
  const [chain, setChain] = useState('A')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Load template metadata on mount.
  useEffect(() => {
    const ctrl = new AbortController()
    listTemplates(ctrl.signal)
      .then((ts) => setTemplates(ts))
      .catch(() => { /* keep going with hardcoded fallback */ })
    return () => ctrl.abort()
  }, [])

  // Escape closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  // Available difficulties depend on the selected template.
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === template),
    [templates, template],
  )
  const availableDiffs: Difficulty[] = useMemo(() => {
    if (!selectedTemplate) return DIFFICULTIES
    return DIFFICULTIES.filter((d) => selectedTemplate.difficulties.includes(d))
  }, [selectedTemplate])

  // If the active difficulty isn't supported by the new template, snap to the first available.
  useEffect(() => {
    if (!availableDiffs.includes(genDiff) && availableDiffs.length > 0) {
      setGenDiff(availableDiffs[0])
    }
  }, [availableDiffs, genDiff])

  const summary = DIFF_SUMMARY[template]?.[genDiff]
    ?? selectedTemplate?.hint
    ?? 'Procedurally generated puzzle.'

  const submit = async () => {
    setErr(null)
    setBusy(true)
    try {
      if (tab === 'generate') {
        await onGenerate(template, genDiff)
      } else {
        await onImportPdb(pdbId.trim().toUpperCase(), chain.trim().toUpperCase() || 'A', importDiff)
      }
      onClose()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const canImport = pdbId.trim().length === 4 && chain.trim().length >= 1

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="New puzzle">
        <div className="modal-head">
          <h2>New puzzle</h2>
          <button className="popover-close" onClick={onClose} aria-label="Close" disabled={busy}>×</button>
        </div>

        <div className="modal-tabs" role="tablist">
          <button
            className={`mtab ${tab === 'generate' ? 'on' : ''}`}
            onClick={() => setTab('generate')}
            role="tab"
            aria-selected={tab === 'generate'}
          >
            Generate
          </button>
          <button
            className={`mtab ${tab === 'import' ? 'on' : ''}`}
            onClick={() => setTab('import')}
            role="tab"
            aria-selected={tab === 'import'}
          >
            Import from PDB
          </button>
        </div>

        <div className="modal-body">
          {tab === 'generate' ? (
            <>
              <p className="modal-lede">
                Pick a structural template and a difficulty. We'll generate a misfolded variant,
                validate it against the gradient, and ship the first one that passes.
              </p>
              <div className="settings-group">
                <label className="settings-label">Template</label>
                <div
                  className="seg-row"
                  style={{ gridTemplateColumns: `repeat(${Math.max(templates.length, 1)}, 1fr)` }}
                >
                  {(templates.length > 0 ? templates : [
                    { id: 'marqusee', label: 'Marqusee helix', difficulties: DIFFICULTIES, target_lengths: [], hint: '' },
                  ]).map((t) => (
                    <button
                      key={t.id}
                      className={`seg-btn ${template === t.id ? 'on' : ''}`}
                      onClick={() => setTemplate(t.id)}
                      title={t.hint}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-group">
                <label className="settings-label">Difficulty</label>
                <div
                  className="seg-row"
                  style={{ gridTemplateColumns: `repeat(${availableDiffs.length}, 1fr)` }}
                >
                  {availableDiffs.map((d) => (
                    <button
                      key={d}
                      className={`seg-btn ${genDiff === d ? 'on' : ''}`}
                      onClick={() => setGenDiff(d)}
                    >
                      {d[0].toUpperCase() + d.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="diff-summary"><p>{summary}</p></div>
            </>
          ) : (
            <>
              <p className="modal-lede">
                Import a real protein from the{' '}
                <a href="https://www.rcsb.org/" target="_blank" rel="noreferrer">RCSB Protein Data Bank</a>{' '}
                and we'll generate a misfolded variant for you to repair.
              </p>
              <div className="modal-grid-2">
                <div className="settings-group">
                  <label className="settings-label">PDB ID</label>
                  <input
                    value={pdbId}
                    onChange={(e) => setPdbId(e.target.value.toUpperCase().slice(0, 4))}
                    className="modal-input mono"
                    placeholder="1UBQ"
                    maxLength={4}
                    spellCheck={false}
                    disabled={busy}
                  />
                </div>
                <div className="settings-group">
                  <label className="settings-label">Chain</label>
                  <input
                    value={chain}
                    onChange={(e) => setChain(e.target.value.toUpperCase().slice(0, 1))}
                    className="modal-input mono"
                    placeholder="A"
                    maxLength={1}
                    spellCheck={false}
                    disabled={busy}
                  />
                </div>
              </div>
              <div className="settings-group">
                <label className="settings-label">Difficulty</label>
                <div className="seg-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d}
                      className={`seg-btn ${importDiff === d ? 'on' : ''}`}
                      onClick={() => setImportDiff(d)}
                    >
                      {d[0].toUpperCase() + d.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="suggest-row">
                <span className="settings-label">Try one of these</span>
                <div className="suggest-chips">
                  {SUGGESTED_PDBS.map((s) => (
                    <button
                      key={s.id}
                      className="suggest-chip"
                      onClick={() => {
                        setPdbId(s.id)
                        setChain(s.chain)
                      }}
                      disabled={busy}
                    >
                      <code>{s.id}</code>
                      <span>{s.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {err && <div className="modal-error">{err}</div>}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="btn primary"
            onClick={submit}
            disabled={busy || (tab === 'import' && !canImport)}
          >
            {busy ? 'Working…' : tab === 'generate' ? 'Generate puzzle' : `Import ${pdbId || '…'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
