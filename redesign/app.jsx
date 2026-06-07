const { useState, useEffect, useRef, useMemo } = React;

// Puzzles (mirrors backend/data/puzzles.json)
const PUZZLES = [
  {
    id: 'puzzle1', no: 1,
    title: 'Rescue the Helix',
    description: 'This 42-residue peptide should fold into a single continuous α-helix, but six helix-breaking residues (Pro and Gly) have been inserted at structurally bad positions. Mutate residues to restore the helix.',
    starting_sequence: 'AEAPAKAAEAGAKAAEAPAKAAEAGAKAAEAPAKAAEAGAKA',
    mutation_budget: 6,
    baseline_rmsd: 16.54,
    expected_solved_rmsd: 0.8,
    hint: 'Helix-breaking residues are P and G. Helix-favoring are A, E, K, L, M.',
    difficulty: 'easy',
  },
  {
    id: 'puzzle2', no: 2,
    title: 'Rebuild the Bundle',
    description: 'HP35 (villin headpiece) is a classic 36-residue 3-helix bundle. Five mutations have damaged its core. Protein folding is cooperative — fixing one mutation in isolation may not improve the score immediately.',
    starting_sequence: 'MLSDEDGKAVGGMTRSPFANLPLWPQQNPKKEKGLF',
    mutation_budget: 8,
    baseline_rmsd: 9.82,
    expected_solved_rmsd: 1.5,
    hint: 'Helices need contiguous helix-favoring residues. Look for Pro and Gly in helical regions.',
    difficulty: 'hard',
  },
];

// Amino-acid categories
const AA_CATS = {
  hydro:  { label: 'Hydrophobic',     aas: ['A','V','L','I','M','F','W'] },
  polar:  { label: 'Polar uncharged', aas: ['S','T','N','Q','Y','C'] },
  pos:    { label: 'Positive',        aas: ['K','R','H'] },
  neg:    { label: 'Negative',        aas: ['D','E'] },
  spec:   { label: 'Special',         aas: ['G','P'] },
};
const AA_CAT = {};
for (const k of Object.keys(AA_CATS)) for (const a of AA_CATS[k].aas) AA_CAT[a] = k;

// Helix propensity (toy — purely for the mock score)
const HELIX_FAVOR = { A:1, E:1, K:1, L:1, M:1, Q:0.8, R:0.7, F:0.6, I:0.6, V:0.4, S:0.4, T:0.4, H:0.4, W:0.4, N:0.3, C:0.3, Y:0.2, D:0.1, G:-0.5, P:-1 };

// Toy secondary-structure annotator. Real codebase would feed this from DSSP
// or 3Dmol's structure analysis.
function annotateSS(sequence) {
  const score = sequence.split('').map(c => HELIX_FAVOR[c] ?? 0);
  // smooth via 5-residue window
  const smooth = score.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i-2); j <= Math.min(score.length-1, i+2); j++) {
      s += score[j]; n++;
    }
    return s / n;
  });
  return smooth.map((v, i) => {
    if (sequence[i] === 'P' || sequence[i] === 'G') return 'L';
    if (v >= 0.55) return 'H';
    if (v <= 0.15) return 'L';
    return 'C';
  });
}

function hammingDistance(a, b) {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

// Fake prediction. Lower = better.
function mockScore(sequence, puzzle) {
  let propSum = 0;
  for (const c of sequence) propSum += HELIX_FAVOR[c] ?? 0;
  const ideal = sequence.length * 1.0;
  const ratio = Math.max(0, Math.min(1, propSum / ideal));
  const rmsd = puzzle.baseline_rmsd * (1 - ratio * 0.96) + 0.4;
  // per-residue pLDDT: high in stable runs, low near breakers
  const plddt = [];
  for (let i = 0; i < sequence.length; i++) {
    let local = 0;
    for (let j = Math.max(0, i-2); j <= Math.min(sequence.length-1, i+2); j++) {
      local += HELIX_FAVOR[sequence[j]] ?? 0;
    }
    const v = 0.5 + (local / 5) * 0.45;
    plddt.push(Math.max(0.25, Math.min(0.98, v)));
  }
  const plddtMean = plddt.reduce((a,b) => a+b, 0) / plddt.length;
  return { rmsd, plddt, plddtMean, solved: rmsd <= puzzle.expected_solved_rmsd };
}

// Map RMSD to a 0-100 score (normalized like backend)
function normalized(rmsd, puzzle) {
  const span = Math.max(puzzle.baseline_rmsd - puzzle.expected_solved_rmsd, 0.1);
  const v = (puzzle.baseline_rmsd - rmsd) / span * 100;
  return Math.max(0, Math.min(100, v));
}

// ===== Icons =====
const Icon = {
  Logo: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 18 C 8 14, 8 10, 12 6 M12 18 C 16 14, 16 10, 20 6 M6 12 H 18" /></svg>,
  Search: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>,
  Bell: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>,
  Help: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg>,
  Rotate: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>,
  Camera: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 7h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="4"/></svg>,
  Maximize: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>,
  Sparkle: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>,
  Check: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m5 13 4 4L19 7"/></svg>,
  Arrow: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>,
  Reset: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8"/><path d="M3 3v5h5"/></svg>,
  Gear: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>,
};

// ===== App =====
function App() {
  const tweakDefaults = /*EDITMODE-BEGIN*/{
    "layout": "rail-right",
    "accent": "#7be0c3",
    "theme": "dark",
    "compact": false
  }/*EDITMODE-END*/;

  // Settings — persist in localStorage so user preferences survive reload
  const [settings, setSettings] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('foldit-settings') || 'null');
      return { ...tweakDefaults, ...(stored || {}) };
    } catch { return tweakDefaults; }
  });
  const updateSetting = (k, v) => {
    setSettings(prev => {
      const next = { ...prev, [k]: v };
      try { localStorage.setItem('foldit-settings', JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const t = settings;
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Apply theme + accent
  useEffect(() => {
    const root = document.documentElement;
    if (t.theme === 'paper') root.classList.add('paper'); else root.classList.remove('paper');
    if (t.accent) {
      root.style.setProperty('--accent', t.accent);
      // soft variants
      root.style.setProperty('--accent-2', `color-mix(in oklch, ${t.accent} 80%, black)`);
      root.style.setProperty('--accent-bg', `color-mix(in oklch, ${t.accent} 18%, transparent)`);
    }
  }, [t.theme, t.accent]);

  const [puzzleIdx, setPuzzleIdx] = useState(0);
  const puzzle = PUZZLES[puzzleIdx];
  const [sequence, setSequence] = useState(puzzle.starting_sequence);
  const [colorMode, setColorMode] = useState('spectrum');
  const [openPos, setOpenPos] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [predicting, setPredicting] = useState(false);
  const [prediction, setPrediction] = useState(() => mockScore(puzzle.starting_sequence, puzzle));
  const [lastMutation, setLastMutation] = useState(null);
  const [tutorMsg, setTutorMsg] = useState(null);
  const [tutorLoading, setTutorLoading] = useState(false);
  const [scoreHistory, setScoreHistory] = useState(() => [mockScore(puzzle.starting_sequence, puzzle).rmsd]);
  const [celebrate, setCelebrate] = useState(false);
  const wasSolvedRef = useRef(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [showDebrief, setShowDebrief] = useState(false);
  const [showTour, setShowTour] = useState(() => {
    try { return !localStorage.getItem('foldit-tour-seen'); }
    catch { return true; }
  });
  // Per-puzzle mutation log for the debrief
  const [mutationLog, setMutationLog] = useState([]);

  // Switch puzzles
  useEffect(() => {
    const p = PUZZLES[puzzleIdx];
    setSequence(p.starting_sequence);
    setOpenPos(null);
    setLastMutation(null);
    setTutorMsg(null);
    setMutationLog([]);
    const baseline = mockScore(p.starting_sequence, p);
    setPrediction(baseline);
    setScoreHistory([baseline.rmsd]);
    wasSolvedRef.current = false;
  }, [puzzleIdx]);

  // Re-predict on sequence change (simulated latency)
  useEffect(() => {
    if (sequence === puzzle.starting_sequence && !lastMutation) {
      setPrediction(mockScore(sequence, puzzle));
      return;
    }
    setPredicting(true);
    const id = setTimeout(() => {
      const next = mockScore(sequence, puzzle);
      setPrediction(next);
      setScoreHistory(h => [...h, next.rmsd].slice(-10));
      if (next.solved && !wasSolvedRef.current) {
        setCelebrate(true);
        setTimeout(() => setCelebrate(false), 2400);
        setTimeout(() => setShowDebrief(true), 1800);
        wasSolvedRef.current = true;
      }
      if (!next.solved) wasSolvedRef.current = false;
      setPredicting(false);
    }, 500);
    return () => clearTimeout(id);
  }, [sequence, puzzleIdx]);

  const mutationsUsed = hammingDistance(sequence, puzzle.starting_sequence);
  const budgetLeft = Math.max(0, puzzle.mutation_budget - mutationsUsed);

  const mutated = useMemo(() => sequence.split('').map((c,i) => c !== puzzle.starting_sequence[i]), [sequence, puzzle.starting_sequence]);
  const ssAnno = useMemo(() => annotateSS(sequence), [sequence]);

  const mutate = (pos, aa) => {
    if (sequence[pos] === aa) { setOpenPos(null); return; }
    if (budgetLeft <= 0 && !mutated[pos]) return;
    const prev = sequence[pos];
    const next = sequence.substring(0, pos) + aa + sequence.substring(pos + 1);
    setSequence(next);
    setLastMutation({ pos, prev, next: aa, prevPrediction: prediction });
    setMutationLog(log => [...log, { pos, prev, next: aa, rmsdBefore: prediction.rmsd }]);
    setOpenPos(null);
    setTutorMsg(null);
  };

  const reset = () => {
    setSequence(puzzle.starting_sequence);
    setLastMutation(null);
    setTutorMsg(null);
    setMutationLog([]);
  };

  const askTutor = () => {
    if (!lastMutation) return;
    setTutorLoading(true);
    setTimeout(() => {
      const { pos, prev, next, prevPrediction } = lastMutation;
      const dR = prediction.rmsd - prevPrediction.rmsd;
      const dirGood = dR < 0;
      const dirText = dirGood ? `dropped by **${Math.abs(dR).toFixed(2)} Å** — a clear improvement` : `increased by **${Math.abs(dR).toFixed(2)} Å** — the structure got further from the target`;
      const aaNote = (prev === 'P' || prev === 'G')
        ? `**${prev}** is a known helix-breaker — removing it from a helical region was a good call.`
        : (next === 'P' || next === 'G')
        ? `**${next}** breaks α-helices because of its rigid backbone (Pro) or extreme flexibility (Gly). Avoid it inside helices.`
        : `**${next}** has ${HELIX_FAVOR[next] >= 0.6 ? 'high' : 'moderate'} helix propensity.`;
      setTutorMsg(`At position **${pos + 1}**, you swapped <span class="pill">${prev}→${next}</span>. RMSD ${dirText}. ${aaNote}`);
      setTutorLoading(false);
    }, 700);
  };

  const stripeColor = (i) => {
    if (colorMode === 'plddt') return window.plddtColor(prediction.plddt[i] ?? 0.5);
    if (colorMode === 'structure') {
      const ss = ssAnno[i];
      if (ss === 'H') return 'oklch(0.7 0.16 30)';
      if (ss === 'L') return 'oklch(0.7 0.15 280)';
      return 'oklch(0.7 0.05 240)';
    }
    return window.spectrumColor(i, sequence.length);
  };

  const score100 = normalized(prediction.rmsd, puzzle);
  const solved = prediction.solved;
  const brokenFrac = Math.min(1, (prediction.rmsd - puzzle.expected_solved_rmsd) / Math.max(puzzle.baseline_rmsd - puzzle.expected_solved_rmsd, 0.1));

  return (
    <div className="app">
      {/* ===== Top bar ===== */}
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Icon.Logo /></span>
          <span>FolditLite</span>
        </div>
        <span className="crumb-sep">/</span>
        <span className="crumb-current">{puzzle.title}</span>
        <span className={`diff ${puzzle.difficulty}`}>{puzzle.difficulty}</span>
        <span className="crumb-meta mono">{sequence.length} aa · puzzle {puzzle.no} of {PUZZLES.length}</span>

        <div className="topbar-spacer"></div>

        <button className="icon-btn" title="Search puzzles"><Icon.Search /></button>
        <button className="icon-btn" title="Replay the welcome tour" onClick={() => setShowTour(true)}><Icon.Help /></button>
        <div className="settings-wrap">
          <button
            className={`icon-btn ${settingsOpen ? 'on' : ''}`}
            title="Display settings"
            onClick={() => setSettingsOpen(o => !o)}
          >
            <Icon.Gear />
          </button>
          {settingsOpen && (
            <SettingsPopover
              settings={t}
              onChange={updateSetting}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </div>
        <span className="kbd">⌘ K</span>
        <div className="avatar" title="Student account">AB</div>
      </header>

      {/* ===== Main two-column ===== */}
      <div className={`main ${t.layout === 'rail-left' ? 'left-rail' : ''}`}>
        {/* Viewer column */}
        <section className="stage">
          <div className="viewer">
            <div className="hud hud-tl">
              <div className="chip" title="Prediction source">
                <span className={`dot ${predicting ? 'predict' : 'good'}`}></span>
                <span>{predicting ? 'predicting' : 'esmfold'}</span>
                <span style={{color:'var(--muted-2)'}}>· {predicting ? '...' : '142'} ms</span>
              </div>
              <div className="chip">
                <span className="dot warn"></span>
                <span>pLDDT</span>
                <code>{prediction.plddtMean.toFixed(2)}</code>
              </div>
            </div>

            <div className="hud hud-tr">
              <div className="ctl-row">
                <button className="ctl-btn" title="Auto-rotate"><Icon.Rotate /></button>
                <button className="ctl-btn" title="Snapshot"><Icon.Camera /></button>
                <button className="ctl-btn" title="Fullscreen"><Icon.Maximize /></button>
              </div>
            </div>

            <div className="viewer-canvas">
              <window.ProteinView
                length={sequence.length}
                colorMode={colorMode}
                perResiduePlddt={prediction.plddt}
                mutated={mutated}
                highlight={hovered}
                brokenFraction={brokenFrac}
                ssAnnotation={ssAnno}
              />
            </div>

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

            <div className="hud hud-bl">
              <div className="viewer-controls" role="tablist">
                <button className={`seg ${colorMode==='spectrum'?'on':''}`} onClick={() => setColorMode('spectrum')}>N→C</button>
                <button className={`seg ${colorMode==='plddt'?'on':''}`} onClick={() => setColorMode('plddt')}>pLDDT</button>
                <button className={`seg ${colorMode==='structure'?'on':''}`} onClick={() => setColorMode('structure')}>Structure</button>
              </div>
            </div>

            <div className="hud hud-br">
              <button className="btn ghost" onClick={reset} disabled={mutationsUsed===0}>
                <Icon.Reset /> Reset
              </button>
            </div>
          </div>
        </section>

        {/* Rail column */}
        <aside className="rail">
          {/* Score (top of rail — live status during play) */}
          <div className="rail-section">
            <div className="section-head">
              <span>Score</span>
              <span className="tag">target ≤ {puzzle.expected_solved_rmsd.toFixed(1)} Å</span>
            </div>

            <HeroScore
              rmsd={prediction.rmsd}
              baseline={puzzle.baseline_rmsd}
              target={puzzle.expected_solved_rmsd}
              normalized={score100}
              history={scoreHistory}
              delta={lastMutation ? prediction.rmsd - lastMutation.prevPrediction.rmsd : null}
              solved={solved}
              celebrate={celebrate}
            />

            <div className="score-grid">
              <div className="score-stat">
                <span className="ss-label">Mutations</span>
                <span className="ss-value">{mutationsUsed} <small>/ {puzzle.mutation_budget}</small></span>
              </div>
              <div className="score-stat">
                <span className="ss-label">pLDDT</span>
                <span className="ss-value">{prediction.plddtMean.toFixed(2)}</span>
              </div>
              <div className="score-stat">
                <span className="ss-label">Baseline</span>
                <span className="ss-value muted-num">{puzzle.baseline_rmsd.toFixed(1)} Å</span>
              </div>
            </div>
          </div>

          {/* Puzzle */}
          <div className="rail-section">
            <div className="section-head">
              <span>Puzzle</span>
              <span className="tag">{puzzle.id}</span>
            </div>
            <h1 className="puzzle-title">{puzzle.title}</h1>
            <p className="puzzle-desc">{puzzle.description}</p>
            <div className="puzzle-hint">
              <span><b style={{color:'var(--text)'}}>Hint —</b> {puzzle.hint}</span>
            </div>
          </div>

          {/* Tutor */}
          <div className="rail-section">
            <div className="section-head">
              <span>Tutor</span>
              <span className="tag">Claude haiku</span>
            </div>
            <div className="tutor-card">
              <div className="tutor-head">
                <span className="tutor-avatar">
                  <svg viewBox="0 0 32 32" fill="none">
                    <defs>
                      <linearGradient id="helixGrad" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0%" stopColor="oklch(0.88 0.14 168)" />
                        <stop offset="100%" stopColor="oklch(0.72 0.16 220)" />
                      </linearGradient>
                    </defs>
                    <path d="M8 4 C 22 8, 22 14, 8 16 C 22 18, 22 24, 8 28"
                          stroke="url(#helixGrad)" strokeWidth="2.5" strokeLinecap="round" fill="none">
                      <animate attributeName="stroke-dashoffset" from="0" to="-40" dur="3s" repeatCount="indefinite"/>
                    </path>
                    <path d="M24 4 C 10 8, 10 14, 24 16 C 10 18, 10 24, 24 28"
                          stroke="url(#helixGrad)" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.5"/>
                  </svg>
                </span>
                <div className="tutor-name">
                  Foldit Tutor
                  <small>{tutorLoading ? <span className="typing"><i></i><i></i><i></i></span> : (lastMutation ? 'Ready to explain your last move' : 'Waiting for a mutation…')}</small>
                </div>
              </div>

              {tutorMsg && (
                <div className="tutor-msg"
                  dangerouslySetInnerHTML={{
                    __html: tutorMsg
                      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
                  }}
                />
              )}

              <div className="tutor-actions">
                <button className="btn accent flex1" disabled={!lastMutation || tutorLoading || predicting} onClick={askTutor}>
                  <Icon.Sparkle />
                  {tutorLoading ? 'Thinking…' : 'Explain my last mutation'}
                </button>
              </div>
            </div>
          </div>

          {/* Puzzle picker */}
          <div className="rail-section">
            <div className="section-head"><span>All puzzles</span></div>
            <div className="puzzle-list">
              {PUZZLES.map((p, i) => (
                <button key={p.id}
                  className={`puzzle-card ${i === puzzleIdx ? 'on' : ''}`}
                  onClick={() => setPuzzleIdx(i)}>
                  <span className="pno">#{String(p.no).padStart(2,'0')}</span>
                  <span className="pmeta">
                    <span className="pname">{p.title}</span>
                    <span className="psub">{p.starting_sequence.length} aa · {p.mutation_budget} mutations</span>
                  </span>
                  <span className={`diff ${p.difficulty}`}>{p.difficulty}</span>
                </button>
              ))}
            </div>
            <button className="btn ghost new-puzzle" onClick={() => setShowGenerator(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              New puzzle
            </button>
          </div>
        </aside>
      </div>

      {/* ===== Sequence dock ===== */}
      <SequenceDock
        sequence={sequence}
        starting={puzzle.starting_sequence}
        mutated={mutated}
        budget={puzzle.mutation_budget}
        used={mutationsUsed}
        openPos={openPos}
        setOpenPos={setOpenPos}
        onMutate={mutate}
        onHover={setHovered}
        stripeColor={stripeColor}
        plddt={prediction.plddt}
        colorMode={colorMode}
        budgetLeft={budgetLeft}
        ssAnnotation={ssAnno}
      />

      {/* Settings is in the topbar — no dev tweaks panel here */}

      {showGenerator && <GeneratorModal onClose={() => setShowGenerator(false)} />}
      {showDebrief && (
        <DebriefModal
          puzzle={puzzle}
          prediction={prediction}
          mutationLog={mutationLog}
          baseline={puzzle.baseline_rmsd}
          hasNext={puzzleIdx < PUZZLES.length - 1}
          onClose={() => setShowDebrief(false)}
          onNext={() => { setShowDebrief(false); setPuzzleIdx(i => Math.min(i + 1, PUZZLES.length - 1)); }}
        />
      )}
      {showTour && (
        <OnboardingTour
          onDone={() => {
            setShowTour(false);
            try { localStorage.setItem('foldit-tour-seen', '1'); } catch {}
          }}
        />
      )}
    </div>
  );
}

// ===== Hero score with sparkline + delta =====
function HeroScore({ rmsd, baseline, target, normalized, history, delta, solved, celebrate }) {
  // Sparkline path
  const w = 140, h = 36;
  let sparkD = '';
  if (history && history.length > 1) {
    const min = Math.min(...history, target);
    const max = Math.max(...history, baseline);
    const range = Math.max(max - min, 0.5);
    const xs = history.map((_, i) => (i / (history.length - 1)) * w);
    const ys = history.map(v => h - ((v - min) / range) * (h - 4) - 2);
    sparkD = `M ${xs[0]} ${ys[0]}` + xs.slice(1).map((x, i) => ` L ${x} ${ys[i+1]}`).join('');
  }
  const lastX = w;
  const lastY = history.length > 1 ? (() => {
    const min = Math.min(...history, target);
    const max = Math.max(...history, baseline);
    const range = Math.max(max - min, 0.5);
    return h - ((history[history.length-1] - min) / range) * (h - 4) - 2;
  })() : h / 2;

  return (
    <div className={`hero-score ${solved ? 'solved' : ''} ${celebrate ? 'celebrate' : ''}`}>
      {celebrate && <Confetti />}
      <div className="hero-top">
        <div className="hero-num">
          <span className="hn-prefix">RMSD</span>
          <span className="hn-value mono">{rmsd.toFixed(2)}</span>
          <span className="hn-unit">Å</span>
        </div>
        {delta !== null && Math.abs(delta) > 0.01 && (
          <span className={`delta ${delta < 0 ? 'good' : 'bad'}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              {delta < 0 ? <path d="M12 19V5M6 11l6-6 6 6"/> : <path d="M12 5v14M6 13l6 6 6-6"/>}
            </svg>
            <span className="mono">{Math.abs(delta).toFixed(2)} Å</span>
          </span>
        )}
      </div>

      <div className="hero-bar">
        <div className="hero-bar-track">
          {/* target zone */}
          <div className="hero-target-zone" style={{
            left: `${100 - (target / baseline) * 100}%`,
          }}></div>
          <div className="hero-bar-fill" style={{ width: `${normalized}%` }}></div>
        </div>
        <div className="hero-bar-meta">
          <span><b className="mono">{baseline.toFixed(1)}</b> baseline</span>
          <span className="ml-auto"><span className="mono">{target.toFixed(1)}</span> target</span>
        </div>
      </div>

      {history.length > 1 && (
        <div className="spark">
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
            {/* target line */}
            {(() => {
              const min = Math.min(...history, target);
              const max = Math.max(...history, baseline);
              const range = Math.max(max - min, 0.5);
              const targetY = h - ((target - min) / range) * (h - 4) - 2;
              return <line x1="0" y1={targetY} x2={w} y2={targetY}
                stroke="oklch(0.7 0.13 168 / 0.5)" strokeWidth="1" strokeDasharray="2 2"/>;
            })()}
            <path d={sparkD} stroke="var(--accent)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx={lastX} cy={lastY} r="2.5" fill="var(--accent)"/>
          </svg>
          <span className="spark-label">last {history.length} attempts</span>
        </div>
      )}

      {solved && (
        <div className="solved-strap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m5 13 4 4L19 7"/></svg>
          <span>Solved — inside target tolerance</span>
        </div>
      )}
    </div>
  );
}

// Confetti burst (pure CSS dots animated by random transforms)
function Confetti() {
  const dots = useMemo(() => Array.from({length: 28}).map((_, i) => ({
    id: i,
    x: (Math.random() - 0.5) * 240,
    y: -(Math.random() * 80 + 40),
    r: Math.random() * 360,
    c: ['var(--accent)','var(--violet)','var(--warn)','var(--info)'][i % 4],
    d: Math.random() * 0.4,
  })), []);
  return (
    <div className="confetti">
      {dots.map(d => (
        <span key={d.id}
          style={{
            ['--x']: `${d.x}px`,
            ['--y']: `${d.y}px`,
            ['--r']: `${d.r}deg`,
            ['--d']: `${d.d}s`,
            background: d.c,
          }}/>
      ))}
    </div>
  );
}

// ===== Sequence dock =====
function SequenceDock({ sequence, starting, mutated, budget, used, openPos, setOpenPos, onMutate, onHover, stripeColor, plddt, colorMode, budgetLeft, ssAnnotation }) {
  const CHUNK = 10;
  const chunks = [];
  for (let i = 0; i < sequence.length; i += CHUNK) {
    chunks.push({ start: i, end: Math.min(i + CHUNK, sequence.length) });
  }

  return (
    <div className="dock">
      <div className="dock-meta">
        <span className="dock-title"><b>Sequence</b> · click any residue to mutate · hover to highlight in 3D</span>

        <span className="legend">
          <span className={`legend-bar ${colorMode}`}></span>
          <span>{colorMode === 'spectrum' ? 'N → C' : colorMode === 'plddt' ? 'low → high pLDDT' : 'helix / coil / loop'}</span>
        </span>

        <span className="legend">
          <span className="ss-swatch ss-h"></span><span>helix</span>
          <span className="ss-swatch ss-c"></span><span>coil</span>
          <span className="ss-swatch ss-l"></span><span>loop</span>
        </span>

        <span className="ml-auto budget-pill">
          <span>Budget</span>
          <span className="pips">
            {Array.from({length: budget}).map((_, i) => (
              <span key={i} className={`pip ${i < used ? 'used' : ''}`}></span>
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
                {Array.from({length: chunk.end - chunk.start}).map((_, j) => {
                  const i = chunk.start + j;
                  const ss = ssAnnotation[i];
                  return <span key={i} className={`ss-cell ss-${ss?.toLowerCase() ?? 'c'}`} title={`${i+1}: ${ss}`}></span>;
                })}
              </div>
              {/* Cells */}
              <div className="seq-row">
                {Array.from({length: chunk.end - chunk.start}).map((_, j) => {
                  const i = chunk.start + j;
                  const aa = sequence[i];
                  const isMut = mutated[i];
                  const isOpen = openPos === i;
                  const locked = budgetLeft <= 0 && !isMut;
                  return (
                    <div key={i}
                      className={`cell ${isMut ? 'mut' : ''} ${isOpen ? 'active' : ''} ${locked ? 'locked' : ''}`}
                      style={{ ['--stripe']: stripeColor(i) }}
                      onMouseEnter={() => onHover(i)}
                      onMouseLeave={() => onHover(null)}
                      onClick={() => !locked && setOpenPos(isOpen ? null : i)}
                      title={`Position ${i+1}: ${aa}${isMut ? ` (was ${starting[i]})` : ''} · pLDDT ${plddt[i]?.toFixed(2) ?? '-'}`}
                    >
                      <span className="aa">{aa}</span>
                      {isOpen && (
                        <MutationPopover
                          pos={i}
                          starting={starting[i]}
                          current={aa}
                          plddt={plddt[i]}
                          onPick={(newAa) => onMutate(i, newAa)}
                          onClose={() => setOpenPos(null)}
                        />
                      )}
                    </div>
                  );
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
  );
}

// ===== Mutation popover =====
function MutationPopover({ pos, starting, current, plddt, onPick, onClose }) {
  // Compute position so popover stays on screen
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const overflowRight = rect.right - window.innerWidth + 14;
    if (overflowRight > 0) {
      el.style.left = `${-overflowRight}px`;
    }
  }, [pos]);

  const orderedCats = ['hydro','polar','pos','neg','spec'];

  return (
    <div className="popover" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div className="popover-head">
        <span className="ptitle">
          Position <b className="mono">{pos+1}</b> · was <b className="mono">{starting}</b>
          {plddt !== undefined && <> · pLDDT <b className="mono">{plddt.toFixed(2)}</b></>}
        </span>
        <button className="popover-close" onClick={onClose}>×</button>
      </div>

      <div className="aa-grid">
        {orderedCats.flatMap(cat => AA_CATS[cat].aas).map((aa) => {
          const cat = AA_CAT[aa];
          const isCur = aa === current;
          const isOrig = aa === starting;
          return (
            <button key={aa}
              className={`aa-btn cat-${cat} ${isCur ? 'is-cur' : ''} ${isOrig && !isCur ? 'is-orig' : ''}`}
              onClick={() => onPick(aa)}
              title={`${aa} · ${AA_CATS[cat].label}${isOrig ? ' (original)' : ''}`}
            >
              {aa}
            </button>
          );
        })}
      </div>

      <div className="popover-foot">
        <span className="lk"><span className="sw cat-hydro"></span>hydrophobic</span>
        <span className="lk"><span className="sw cat-polar"></span>polar</span>
        <span className="lk"><span className="sw cat-pos"></span>+</span>
        <span className="lk"><span className="sw cat-neg"></span>−</span>
        <span className="lk"><span className="sw cat-spec"></span>special</span>
      </div>
    </div>
  );
}

window.App = App;

// ===== Generator / PDB import modal =====
function GeneratorModal({ onClose }) {
  const [tab, setTab] = useState('generate');
  const [difficulty, setDifficulty] = useState('medium');
  const [pdbId, setPdbId] = useState('');
  const [chain, setChain] = useState('A');
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setBusy(true);
    setTimeout(() => { setBusy(false); onClose(); }, 1100);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>New puzzle</h2>
          <button className="popover-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-tabs">
          <button className={`mtab ${tab==='generate'?'on':''}`} onClick={() => setTab('generate')}>Generate</button>
          <button className={`mtab ${tab==='import'?'on':''}`} onClick={() => setTab('import')}>Import from PDB</button>
        </div>

        <div className="modal-body">
          {tab === 'generate' ? (
            <>
              <p className="modal-lede">
                Pick a difficulty and we'll generate a random misfolded peptide for you. Higher difficulty means a longer chain and more breakers.
              </p>
              <div className="settings-group">
                <label className="settings-label">Difficulty</label>
                <div className="seg-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  {['easy','medium','hard'].map(d => (
                    <button key={d} className={`seg-btn ${difficulty===d?'on':''}`} onClick={() => setDifficulty(d)}>
                      {d[0].toUpperCase() + d.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="diff-summary">
                {difficulty === 'easy' && <p>~30 aa · 4–5 breakers · single helix or hairpin</p>}
                {difficulty === 'medium' && <p>~50 aa · 6–8 breakers · multiple secondary elements</p>}
                {difficulty === 'hard' && <p>~70 aa · 10+ breakers · cooperative fold required</p>}
              </div>
            </>
          ) : (
            <>
              <p className="modal-lede">
                Import a real protein from the <a href="https://www.rcsb.org/" target="_blank" rel="noreferrer">RCSB Protein Data Bank</a> and we'll generate a misfolded variant for you to repair.
              </p>
              <div className="modal-grid-2">
                <div className="settings-group">
                  <label className="settings-label">PDB ID</label>
                  <input value={pdbId} onChange={(e) => setPdbId(e.target.value.toUpperCase().slice(0, 4))}
                    className="modal-input mono" placeholder="1UBQ" maxLength={4} />
                </div>
                <div className="settings-group">
                  <label className="settings-label">Chain</label>
                  <input value={chain} onChange={(e) => setChain(e.target.value.toUpperCase().slice(0, 1))}
                    className="modal-input mono" placeholder="A" maxLength={1} />
                </div>
              </div>
              <div className="settings-group">
                <label className="settings-label">Difficulty</label>
                <div className="seg-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  {['easy','medium','hard'].map(d => (
                    <button key={d} className={`seg-btn ${difficulty===d?'on':''}`} onClick={() => setDifficulty(d)}>
                      {d[0].toUpperCase() + d.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="suggest-row">
                <span className="settings-label">Try one of these:</span>
                <div className="suggest-chips">
                  {[['1UBQ','A','ubiquitin'], ['1VII','A','HP35'], ['2KKW','A','TC5b']].map(([id,ch,name]) => (
                    <button key={id} className="suggest-chip" onClick={() => { setPdbId(id); setChain(ch); }}>
                      <code>{id}</code><span>{name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary"
            disabled={busy || (tab === 'import' && (pdbId.length !== 4 || !chain))}
            onClick={submit}>
            {busy ? 'Working…' : tab === 'generate' ? 'Generate puzzle' : `Import ${pdbId || '…'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Solve-time debrief modal =====
function DebriefModal({ puzzle, prediction, mutationLog, baseline, hasNext, onClose, onNext }) {
  const rmsdDrop = baseline - prediction.rmsd;
  const helpful = mutationLog.filter((m, i) => {
    const next = mutationLog[i + 1];
    const cur = m.rmsdBefore;
    const after = next ? next.rmsdBefore : prediction.rmsd;
    return after < cur - 0.1;
  }).length;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal debrief" onMouseDown={(e) => e.stopPropagation()}>
        <div className="debrief-hero">
          <div className="debrief-check">
            <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="16" cy="16" r="13"/>
              <path d="m10 16 4 4 8-9"/>
            </svg>
          </div>
          <div>
            <div className="debrief-eyebrow">Puzzle solved</div>
            <h2 className="debrief-title">{puzzle.title}</h2>
          </div>
          <button className="popover-close debrief-close" onClick={onClose}>×</button>
        </div>

        <div className="debrief-stats">
          <div className="dstat">
            <span className="ss-label">Final RMSD</span>
            <span className="dstat-v mono">{prediction.rmsd.toFixed(2)} <small>Å</small></span>
            <span className="dstat-meta">down <b className="mono">{rmsdDrop.toFixed(1)}</b> Å from baseline</span>
          </div>
          <div className="dstat">
            <span className="ss-label">Mutations</span>
            <span className="dstat-v mono">{mutationLog.length} <small>/ {puzzle.mutation_budget}</small></span>
            <span className="dstat-meta">{puzzle.mutation_budget - mutationLog.length} left in the budget</span>
          </div>
          <div className="dstat">
            <span className="ss-label">Helpful moves</span>
            <span className="dstat-v mono">{helpful} <small>/ {mutationLog.length || 1}</small></span>
            <span className="dstat-meta">mutations that dropped RMSD</span>
          </div>
        </div>

        <div className="debrief-section">
          <div className="section-head"><span>Mutation log</span></div>
          {mutationLog.length === 0 ? (
            <p className="debrief-empty">No mutations recorded for this attempt.</p>
          ) : (
            <ol className="mlog">
              {mutationLog.map((m, i) => {
                const next = mutationLog[i + 1];
                const after = next ? next.rmsdBefore : prediction.rmsd;
                const delta = after - m.rmsdBefore;
                const good = delta < -0.1;
                const bad = delta > 0.1;
                return (
                  <li key={i}>
                    <span className="mlog-i mono">{String(i+1).padStart(2,'0')}</span>
                    <span className="mlog-pos">pos <b className="mono">{m.pos + 1}</b></span>
                    <span className="mlog-swap mono">
                      <span className={`cat-${AA_CAT[m.prev]}`}>{m.prev}</span>
                      <span className="arrow">→</span>
                      <span className={`cat-${AA_CAT[m.next]}`}>{m.next}</span>
                    </span>
                    <span className={`mlog-delta ${good?'good':bad?'bad':''} mono`}>
                      {delta > 0 ? '+' : ''}{delta.toFixed(2)} Å
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="debrief-foot">
          <button className="btn ghost" onClick={onClose}>Stay here</button>
          {hasNext && (
            <button className="btn primary" onClick={onNext}>
              Next puzzle
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== Onboarding tour =====
function OnboardingTour({ onDone }) {
  const [step, setStep] = useState(0);
  const STEPS = [
    {
      kind: 'center',
      title: 'Welcome to FolditLite',
      body: 'You\'ll learn how proteins fold by repairing broken ones. Five steps, takes 20 seconds.',
      cta: 'Start tour',
    },
    {
      anchor: '.dock',
      side: 'top',
      title: 'This is your sequence',
      body: 'Each letter is an amino acid. The color stripes match the 3D ribbon above so you can map "this letter" to "that bit of structure".',
    },
    {
      anchor: '.cell',
      side: 'top',
      title: 'Click any residue to mutate',
      body: 'Pick a new amino acid from the grouped picker. Categories are colored by chemistry — hydrophobic, polar, charged.',
    },
    {
      anchor: '.hero-score',
      side: 'left',
      title: 'Watch the RMSD drop',
      body: 'RMSD is your distance from the target fold. Lower is better. The sparkline tracks your last few attempts.',
    },
    {
      anchor: '.tutor-card',
      side: 'left',
      title: 'Stuck? Ask the tutor',
      body: 'Claude can explain why your last mutation helped or hurt. Use it as a study partner.',
      cta: 'Got it',
    },
  ];
  const s = STEPS[step];

  // Compute anchor rect each render
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!s.anchor) { setRect(null); return; }
    const el = document.querySelector(s.anchor);
    if (!el) { setRect(null); return; }
    setRect(el.getBoundingClientRect());
  }, [step]);

  // Position the tooltip
  let tipStyle = {};
  if (s.kind === 'center') {
    tipStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  } else if (rect) {
    const W = 320;
    if (s.side === 'top') {
      tipStyle = {
        left: Math.max(16, Math.min(window.innerWidth - W - 16, rect.left + rect.width/2 - W/2)),
        top: Math.max(16, rect.top - 16 - 180),
      };
    } else if (s.side === 'left') {
      tipStyle = {
        left: Math.max(16, rect.left - W - 16),
        top: Math.max(16, rect.top),
      };
    }
  }

  const next = () => step >= STEPS.length - 1 ? onDone() : setStep(step + 1);
  const back = () => setStep(Math.max(0, step - 1));

  return (
    <div className="tour">
      {!rect && <div className="tour-veil"/>}
      {rect && (
        <div
          className="tour-spot"
          style={{
            left: rect.left - 6, top: rect.top - 6,
            width: rect.width + 12, height: rect.height + 12,
          }}
        />
      )}
      <div className={`tour-tip ${s.kind === 'center' ? 'is-center' : ''}`} style={tipStyle}>
        <div className="tour-step">
          {step + 1} / {STEPS.length}
        </div>
        <h3>{s.title}</h3>
        <p>{s.body}</p>
        <div className="tour-actions">
          {step > 0 && <button className="btn ghost" onClick={back}>Back</button>}
          <button className="btn ghost" onClick={onDone}>Skip tour</button>
          <span style={{flex:1}}/>
          <button className="btn primary" onClick={next}>
            {s.cta || (step === STEPS.length - 1 ? 'Finish' : 'Next →')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Settings popover =====
function SettingsPopover({ settings, onChange, onClose }) {
  const ref = useRef(null);
  // close on outside click / escape
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    // delay so the same click that opened doesn't immediately close
    const id = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const ACCENTS = [
    { value: '#7be0c3', name: 'Mint' },
    { value: '#7bc6e0', name: 'Sky' },
    { value: '#e0c47b', name: 'Amber' },
    { value: '#c97be0', name: 'Violet' },
  ];

  return (
    <div className="settings-pop" ref={ref}>
      <div className="settings-head">
        <span>Display</span>
        <button className="popover-close" onClick={onClose}>×</button>
      </div>

      <div className="settings-group">
        <label className="settings-label">Theme</label>
        <div className="seg-row">
          {['dark','paper'].map(m => (
            <button key={m}
              className={`seg-btn ${settings.theme === m ? 'on' : ''}`}
              onClick={() => onChange('theme', m)}>
              {m === 'dark' ? 'Dark' : 'Paper'}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <label className="settings-label">Accent</label>
        <div className="swatch-row">
          {ACCENTS.map(a => (
            <button key={a.value}
              className={`swatch ${settings.accent === a.value ? 'on' : ''}`}
              title={a.name}
              style={{ background: a.value }}
              onClick={() => onChange('accent', a.value)}>
              {settings.accent === a.value && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="m5 13 4 4L19 7"/></svg>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <label className="settings-label">Sidebar position</label>
        <div className="seg-row">
          <button className={`seg-btn ${settings.layout === 'rail-right' ? 'on' : ''}`} onClick={() => onChange('layout', 'rail-right')}>
            <span className="layout-ico"><i className="lc"></i><i className="lc rail"></i></span>
            Right
          </button>
          <button className={`seg-btn ${settings.layout === 'rail-left' ? 'on' : ''}`} onClick={() => onChange('layout', 'rail-left')}>
            <span className="layout-ico"><i className="lc rail"></i><i className="lc"></i></span>
            Left
          </button>
        </div>
      </div>

      <div className="settings-foot">
        <span>Settings are saved to this device.</span>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
