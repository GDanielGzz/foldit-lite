# Foldit Lite

> Research code, not production. Tested for the cases it was built
> against but not hardened for deployment. Conclusions about protein
> structure inferred from the game's RMSD scores are bounded by the
> caveats in [`LIMITATIONS.md`](LIMITATIONS.md). Issues and pull
> requests welcome.

A browser puzzle game where mutating residues triggers a live ESMFold
structure re-prediction, scored as Cα-RMSD to a target backbone. Solve
puzzles by evolving a sequence toward a target topology within a
mutation budget.

It demonstrates ESMFold integration, an async queue architecture that
hides 3–15 s inference latency, and a three-check validator pipeline
that gates every generated puzzle. ~3,250 LOC across the stack.

## Try it

Foldit Lite runs locally — the live ESMFold re-prediction needs a backend,
so there's no hosted build. See [How to run locally](#how-to-run-locally)
below (a two-terminal FastAPI + Vite setup).

<!-- TODO: a short screen-capture GIF/video tour is the single highest-value
     addition here. Record ~90 s of solving one puzzle, drop it in the repo
     (or link an unlisted upload), and add it to this line. -->

## What's inside

- **FastAPI backend** with a background-warmed puzzle queue (asyncio-
  locked refills, one slot per template × difficulty). Player clicks
  never wait on ESMFold latency.
- **Three-check validator** gates every candidate puzzle: endpoint
  reachable, RMSD gradient usable, solvable within the mutation budget.
- **15 React components** on the frontend with onboarding tour, residue-
  click mutation popover, debrief modal, optimistic structure updates,
  and an LLM tutor card explaining the effect of each mutation.
- **3Dmol.js** for live structure visualization.

## A design-rationale anecdote

The originally-planned "evolve poly-G to an α-helix" puzzle was
uninstructive because ESMFold's pLDDT on poly-G scaffolds is low and
the RMSD gradient was unusable for player feedback. We redesigned
around high-confidence Marqusee α-helix templates with Pro/Gly breakers
placed for usable gradients. This sort of "found an edge case, redesigned
around it" trail is what `LIMITATIONS.md` documents in detail.

## How to run locally

Requires Python 3.11+ and Node 20+.

```bash
# Clone
git clone https://github.com/GDanielGzz/foldit-lite.git
cd foldit-lite

# Backend
python -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env         # edit if you want the LLM tutor active
uvicorn backend.main:app --reload --port 8000

# Frontend (in a second terminal)
cd frontend
npm install
npm run dev                  # opens http://localhost:5173
```

If you don't set an Anthropic API key in `.env`, the LLM tutor card
shows a static explanation and the rest of the game works normally.

## Repo layout

```
backend/        FastAPI app — puzzle queue, ESMFold proxy, scoring
backend/data/   Puzzle config (puzzles.json) and target structures (.pdb)
frontend/       React + TypeScript + 3Dmol.js
redesign/       Standalone visual-redesign prototypes (HTML + JSX) that
                informed the current UI — kept as a design-rationale trail
spike/          Day-1 ESMFold spike; preserved as the prototype that proved
                the sequence-to-PDB pipeline worked before v1
LIMITATIONS.md  Known limitations and caveats
CITATION.cff    Machine-readable citation metadata
LICENSE         MIT
```

## In scope / out of scope

**In scope (v0.1):**

- A puzzle game scored by Cα-RMSD against a target backbone.
- Curated Marqusee α-helix templates and synthetic puzzle sequences.
- Three-check validated puzzles served from a background-warmed queue.
- LLM tutor card explaining mutation effects (Anthropic API).

**Out of scope (v0.1):**

- A research-grade protein design tool.
- Multi-state design or conformational ensembles.
- Side-chain packing, thermodynamic stability, ligand binding.
- Persistent player accounts (planned for v1.5).
- Mobile-optimized UI (desktop / tablet only).

See [`LIMITATIONS.md`](LIMITATIONS.md) for the full caveats list.

## Citation

If you use this work or reference it in writing:

```
González Lozano, D. (2026). Foldit Lite — ESMFold-backed protein
folding puzzle game (v0.1-portfolio-snapshot) [Software].
https://github.com/GDanielGzz/foldit-lite/releases/tag/v0.1-portfolio-snapshot
```

A machine-readable citation lives in [`CITATION.cff`](CITATION.cff).

## Acknowledgments

ESMFold from Lin, Z. *et al.* (2023). *Evolutionary-scale prediction
of atomic level protein structure with a language model.* Science,
379(6637), 1123–1130. <https://doi.org/10.1126/science.ade2574>

Marqusee α-helix template family from Marqusee, S. & Baldwin, R. L.
(1987). *Helix stabilization by Glu-...Lys+ salt bridges in short
peptides of de novo design.* PNAS, 84(24), 8898–8902.
<https://doi.org/10.1073/pnas.84.24.8898>

3Dm