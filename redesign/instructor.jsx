const { useState, useMemo } = React;

// ===== Mock class data =====
const PUZZLES = [
  { id: 'puzzle1', no: 1, title: 'Rescue the Helix', difficulty: 'easy' },
  { id: 'puzzle2', no: 2, title: 'Rebuild the Bundle', difficulty: 'hard' },
  { id: 'puzzle3', no: 3, title: 'Stabilize the Sheet', difficulty: 'medium' },
];

const AVATAR_GRADIENTS = [
  ['#f6c177', '#eb6f92'],
  ['#9ccfd8', '#56949f'],
  ['#c4a7e7', '#7c6f9c'],
  ['#ea9a97', '#b4637a'],
  ['#a4c6a0', '#5e8c61'],
  ['#a3be8c', '#bf616a'],
  ['#ebcb8b', '#d08770'],
  ['#88c0d0', '#5e81ac'],
];

const STUDENTS = [
  { name: 'Amelia Boateng',  id: 'amelia.b',     puzzle: 0, attempts: 5,  solved: true,  mutsUsed: 4, budget: 6, rmsd: 0.62, lastActive: '2m', status: 'solved' },
  { name: 'Beatriz Cruz',    id: 'beatriz.c',    puzzle: 1, attempts: 22, solved: false, mutsUsed: 7, budget: 8, rmsd: 4.30, lastActive: '4m', status: 'stuck' },
  { name: 'Caleb Jin',       id: 'caleb.j',      puzzle: 0, attempts: 3,  solved: true,  mutsUsed: 6, budget: 6, rmsd: 0.78, lastActive: '8m', status: 'solved' },
  { name: 'Devi Ramaswamy',  id: 'devi.r',       puzzle: 1, attempts: 11, solved: false, mutsUsed: 4, budget: 8, rmsd: 2.18, lastActive: '1m', status: 'in-progress' },
  { name: 'Eitan Goldberg',  id: 'eitan.g',      puzzle: 0, attempts: 8,  solved: false, mutsUsed: 3, budget: 6, rmsd: 7.40, lastActive: '12m',status: 'in-progress' },
  { name: 'Farida Saleh',    id: 'farida.s',     puzzle: 2, attempts: 14, solved: true,  mutsUsed: 5, budget: 7, rmsd: 1.21, lastActive: '6m', status: 'solved' },
  { name: 'Gabriel Okafor',  id: 'gabriel.o',    puzzle: 0, attempts: 19, solved: false, mutsUsed: 6, budget: 6, rmsd: 5.10, lastActive: '32m',status: 'stuck' },
  { name: 'Haruki Sato',     id: 'haruki.s',     puzzle: 1, attempts: 9,  solved: false, mutsUsed: 5, budget: 8, rmsd: 2.94, lastActive: '3m', status: 'in-progress' },
  { name: 'Ines Park',       id: 'ines.p',       puzzle: 0, attempts: 4,  solved: true,  mutsUsed: 5, budget: 6, rmsd: 0.71, lastActive: '15m',status: 'solved' },
  { name: 'Jonah Ferreira',  id: 'jonah.f',      puzzle: 0, attempts: 0,  solved: false, mutsUsed: 0, budget: 6, rmsd: 16.5, lastActive: '2d', status: 'idle' },
  { name: 'Kavya Nair',      id: 'kavya.n',      puzzle: 1, attempts: 17, solved: false, mutsUsed: 8, budget: 8, rmsd: 3.42, lastActive: '5m', status: 'stuck' },
  { name: 'Liam Whitaker',   id: 'liam.w',       puzzle: 0, attempts: 6,  solved: true,  mutsUsed: 3, budget: 6, rmsd: 0.54, lastActive: '21m',status: 'solved' },
];

const ACTIVITY = [
  { kind: 'solved', who: 'Liam Whitaker',  what: 'solved', target: 'Rescue the Helix', meta: '3 mutations · RMSD 0.54 Å', t: '21m ago' },
  { kind: 'tutor',  who: 'Beatriz Cruz',   what: 'asked the tutor', target: 'about position 14', meta: 'P → A · RMSD up 0.6 Å', t: '4m ago' },
  { kind: 'stuck',  who: 'Gabriel Okafor', what: 'is stuck on',     target: 'Rescue the Helix', meta: 'budget exhausted · RMSD 5.10 Å', t: '32m ago' },
  { kind: 'solved', who: 'Farida Saleh',   what: 'solved',          target: 'Stabilize the Sheet', meta: '5 mutations · RMSD 1.21 Å', t: '6m ago' },
  { kind: 'stuck',  who: 'Kavya Nair',     what: 'used full budget on', target: 'Rebuild the Bundle', meta: 'RMSD 3.42 Å — still above target', t: '5m ago' },
];

// ===== Helpers =====
function initials(name) {
  return name.split(' ').map(p => p[0]).join('').slice(0,2).toUpperCase();
}
function avatarStyle(seed) {
  const [a, b] = AVATAR_GRADIENTS[seed.charCodeAt(0) % AVATAR_GRADIENTS.length];
  return { background: `linear-gradient(135deg, ${a}, ${b})` };
}

const Icon = {
  Logo:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 18 C 8 14, 8 10, 12 6 M12 18 C 16 14, 16 10, 20 6 M6 12 H 18" /></svg>,
  Sort:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></svg>,
  Eye:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>,
  Mail:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>,
  Export: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3v12M7 10l5-5 5 5"/><path d="M5 21h14"/></svg>,
  Check:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m5 13 4 4L19 7"/></svg>,
  Warn:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>,
  Bulb:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.6 1 1.4 1 2.3v1h6v-1c0-.9.4-1.7 1-2.3A7 7 0 0 0 12 2Z"/></svg>,
};

// ===== App =====
function App() {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    return STUDENTS.filter(s => {
      if (filter !== 'all' && s.status !== filter) return false;
      if (query && !s.name.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [filter, query]);

  // KPIs
  const total = STUDENTS.length;
  const solvedAny = STUDENTS.filter(s => s.solved).length;
  const stuck = STUDENTS.filter(s => s.status === 'stuck').length;
  const idle = STUDENTS.filter(s => s.status === 'idle').length;
  const avgMut = (STUDENTS.filter(s => s.solved).reduce((a, s) => a + s.mutsUsed, 0) / Math.max(solvedAny, 1));
  const solveRate = Math.round((solvedAny / total) * 100);

  // Per-puzzle aggregate
  const puzzleStats = PUZZLES.map((p, i) => {
    const onPuzzle = STUDENTS.filter(s => s.puzzle === i);
    const solved = onPuzzle.filter(s => s.solved).length;
    const inProg = onPuzzle.filter(s => s.status === 'in-progress').length;
    const stuck  = onPuzzle.filter(s => s.status === 'stuck').length;
    const idle   = onPuzzle.filter(s => s.status === 'idle').length;
    return { puzzle: p, solved, inProg, stuck, idle, total: onPuzzle.length };
  });

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Icon.Logo /></span>
          <span>FolditLite</span>
        </div>
        <span className="crumb-sep">/</span>
        <span className="crumb-current">BIOL 230 · Section 3</span>
        <span className="role-badge">Instructor</span>

        <div className="topbar-spacer"></div>

        <a className="tab-link" href="FolditLite.html">Student view</a>
        <a className="tab-link on" href="Instructor.html">Dashboard</a>
        <button className="btn">
          <Icon.Export /> Export CSV
        </button>
        <div className="avatar" title="Dr. M. Lin">ML</div>
      </header>

      <div className="page">
        <div className="page-head">
          <div>
            <div className="page-eyebrow">Spring 2026 · Week 4</div>
            <h1 className="page-title">Protein folding lab</h1>
            <div className="page-meta">
              <span><b>{total}</b> students enrolled</span>
              <span><b>3</b> puzzles assigned</span>
              <span>Due <b>Fri Mar 13</b></span>
            </div>
          </div>
          <div className="head-actions">
            <button className="btn"><Icon.Mail /> Message section</button>
            <button className="btn primary">Open in grader →</button>
          </div>
        </div>

        {/* KPIs */}
        <div className="kpis">
          <div className="kpi" style={{['--kpi-tint']: 'var(--accent)'}}>
            <span className="kpi-label">Solve rate</span>
            <span className="kpi-value">{solveRate}<small>%</small></span>
            <span className="kpi-sub">{solvedAny} of {total} students · <span className="good">+18%</span> vs last week</span>
          </div>
          <div className="kpi" style={{['--kpi-tint']: 'var(--info)'}}>
            <span className="kpi-label">Avg. mutations to solve</span>
            <span className="kpi-value">{avgMut.toFixed(1)}</span>
            <span className="kpi-sub">budget median <b>6</b> · efficiency healthy</span>
          </div>
          <div className="kpi" style={{['--kpi-tint']: 'var(--warn)'}}>
            <span className="kpi-label">Stuck</span>
            <span className="kpi-value">{stuck}</span>
            <span className="kpi-sub">budget exhausted or 20+ min same RMSD</span>
          </div>
          <div className="kpi" style={{['--kpi-tint']: 'var(--muted)'}}>
            <span className="kpi-label">Inactive (24h+)</span>
            <span className="kpi-value">{idle}</span>
            <span className="kpi-sub">no mutation in 24 hours</span>
          </div>
        </div>

        {/* Main two-column */}
        <div className="main-grid">
          {/* Roster */}
          <section className="section-card">
            <div className="section-card-head">
              <h2>Class roster</h2>
              <span className="head-meta">{filtered.length} of {total} shown</span>
            </div>

            <div className="filter-row">
              <input
                className="search-input"
                placeholder="Search by name…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {[
                ['all','All'],
                ['in-progress','In progress'],
                ['stuck','Stuck'],
                ['solved','Solved'],
                ['idle','Idle'],
              ].map(([k, label]) => (
                <button key={k}
                  className={`chip-filter ${filter === k ? 'on' : ''}`}
                  onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
            </div>

            <table className="roster">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Puzzle</th>
                  <th className="col-progress">Progress</th>
                  <th>Mutations</th>
                  <th>Last active</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const puzzle = PUZZLES[s.puzzle];
                  // crude completion percent: 1 - (rmsd-target)/(baseline-target), clamped
                  const baseline = 16.54, target = 0.8;
                  const pct = Math.max(0, Math.min(100, ((baseline - s.rmsd) / (baseline - target)) * 100));
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="student">
                          <span className="student-avatar" style={avatarStyle(s.id)}>{initials(s.name)}</span>
                          <div>
                            <div className="student-name">{s.name}</div>
                            <div className="student-sub">@{s.id}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{fontWeight: 500}}>{puzzle.title}</div>
                        <div className="student-sub">#{String(puzzle.no).padStart(2,'0')} · {puzzle.difficulty}</div>
                      </td>
                      <td className="col-progress">
                        <div className="progress">
                          <div className="progress-fill" style={{width: `${pct}%`}}></div>
                        </div>
                        <div className="progress-meta">
                          <span>RMSD {s.rmsd.toFixed(2)} Å</span>
                          <span>{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="mono">{s.mutsUsed} / {s.budget}</td>
                      <td className="last-active">{s.lastActive}</td>
                      <td>
                        <span className={`status-pill ${s.status}`}>
                          <span className="dot"></span>
                          {s.status === 'in-progress' ? 'In progress' : s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                        </span>
                      </td>
                      <td>
                        <span className="row-actions">
                          <button className="icon-btn" title="View student's view"><Icon.Eye /></button>
                          <button className="icon-btn" title="Send a hint"><Icon.Mail /></button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* Right column */}
          <div className="right-col">
            <section className="section-card">
              <div className="section-card-head">
                <h2>Per-puzzle progress</h2>
                <span className="head-meta">all sections</span>
              </div>
              {puzzleStats.map((s, i) => {
                if (s.total === 0) return null;
                const pct = (n) => (n / s.total) * 100;
                return (
                  <div key={i} className="puzzle-row">
                    <div>
                      <div className="pno">#{String(s.puzzle.no).padStart(2,'0')}</div>
                    </div>
                    <div>
                      <div className="pname">{s.puzzle.title}</div>
                      <div className="puzzle-bar">
                        <span className="solved" style={{width: `${pct(s.solved)}%`}}></span>
                        <span className="in-progress" style={{width: `${pct(s.inProg)}%`}}></span>
                        <span className="stuck" style={{width: `${pct(s.stuck)}%`}}></span>
                        <span className="idle" style={{width: `${pct(s.idle)}%`}}></span>
                      </div>
                    </div>
                    <div className="pmeta">{s.solved} / {s.total}</div>
                  </div>
                );
              })}
              <div className="puzzle-row">
                <div></div>
                <div className="bar-legend">
                  <span className="lk"><span className="sw solved"></span>solved</span>
                  <span className="lk"><span className="sw in-progress"></span>in progress</span>
                  <span className="lk"><span className="sw stuck"></span>stuck</span>
                  <span className="lk"><span className="sw idle"></span>idle</span>
                </div>
                <div></div>
              </div>
            </section>

            <section className="section-card">
              <div className="section-card-head">
                <h2>Recent activity</h2>
                <span className="head-meta">last hour</span>
              </div>
              <div className="activity">
                {ACTIVITY.map((a, i) => (
                  <div key={i} className="activity-item">
                    <span className={`activity-ico ${a.kind}`}>
                      {a.kind === 'solved' && <Icon.Check />}
                      {a.kind === 'tutor'  && <Icon.Bulb />}
                      {a.kind === 'stuck'  && <Icon.Warn />}
                    </span>
                    <span className="activity-body">
                      <b>{a.who}</b> {a.what} <b>{a.target}</b><br/>
                      <span className="student-sub">{a.meta}</span>
                    </span>
                    <span className="activity-time">{a.t}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
