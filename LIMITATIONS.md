# Known Limitations — Foldit Lite

Foldit Lite is a portfolio puzzle game, not a structural biology tool.
Many of the model behaviors that would be "bugs" in a research setting
are deliberate game-design choices here. This document marks where the
two diverge.

Last updated: 2026-05-23 (initial scaffolding by CodeNya)

---

## Model limitations (ESMFold)

- **ESMFold confidence (pLDDT) is corpus-dependent.** Predictions on
  natural-protein-like sequences are high-confidence; predictions on
  designed scaffolds (poly-Ala, poly-Gly, synthetic backbones) can be
  unreliable. We discovered this during puzzle design: the original
  "evolve poly-G to a helix" puzzle was uninstructive because low-pLDDT
  predictions had unusable RMSD gradients.
- **Resolution to the above**: puzzles are now built around high-pLDDT
  templates with Pro/Gly breakers strategically placed for usable RMSD
  gradients. Marqusee α-helix templates are the workhorse.
- **Cα-RMSD as the scoring metric** captures backbone topology but not
  side-chain packing, ligand binding, or thermodynamic stability. A
  puzzle "solved" at low RMSD may still represent a misfolded or
  unstable structure in reality.
- **ESMFold latency**: 3–15 seconds per prediction on the inference
  endpoint. The background-warmed puzzle queue (asyncio-locked refills,
  one slot per template × difficulty) hides this from the player but
  cannot eliminate it during active mutation.

## Game-design limitations

- **Mutation budget per puzzle** is bounded by the level config. Some
  natural protein-design problems require more mutations than the
  budget allows; those problems are out of scope for puzzle-mode play.
- **Single-target backbone** per puzzle. Multi-state design (a
  conformational ensemble) is not represented.
- **Three-check validator** gates every generated puzzle: endpoint
  reachable, RMSD gradient usable, solvable within mutation budget.
  Puzzles that fail any check are silently dropped from the queue. The
  validator is conservative; some solvable puzzles may be rejected.

## Engineering limitations

- **No persistent player state** in v0.1. Solving a puzzle and reloading
  the page restarts the session. Adding accounts and progression is a
  v1.5 feature.
- **LLM tutor card** uses the Anthropic API. Without an API key the
  tutor degrades to a static explanation; the rest of the game still
  works.
- **Backend tested on CPU only.** GPU paths exist in the code but are
  not part of the v0.1 deployment story.

## Scope limitations

- **In scope**: a browser puzzle game where mutations trigger ESMFold
  refolds, scored by Cα-RMSD to a target backbone, with curated
  templates and validated puzzles.
- **Out of scope**: a research-grade protein design tool, multi-state
  design, side-chain packing, thermodynamic scoring, ligand-binding
  prediction, multimer prediction, or any clinical / therapeutic
  application.
- **Not a substitute for**: experimental protein characterization. The
  game teaches intuition; experimental validation is its own discipline.

## Reproducibility caveats

- **ESMFold endpoint pinned** at the version listed in `backend/config.py`.
  Newer endpoint versions may shift predictions slightly; the headline
  game experience is robust to small shifts but specific RMSD numbers
  may drift.
- **Puzzle queue state** is not persisted across backend restarts; the
  queue regenerates from scratch on each boot. Reproducing a specific
  puzzle requires recording its seed (TODO for v0.2).

## Known bugs and open questions

- *Browser refresh during an active ESMFold call* can leave a stale
  loading spinner if the WebSocket reconnects out of sync. Workaround:
  refresh again. Documented as a v0.1 known issue; fix is scheduled
  for v0.2.

## Things I'm uncertain about (honest section)

- Whether Cα-RMSD is the right scoring metric for the kind of intuition
  the game is supposed to build. TM-score or lDDT might be more
  pedagogically useful; not tested.
- Whether the mutation-budget design choice creates the right level of
  challenge. Some players solve every puzzle on the first try; others
  get stuck. A skill-balanced budget is a hard design problem.
- The Marqusee α-helix template family was chosen because it gives
  clean RMSD gradients, but it's not representative of natural protein
  diversity. A future revision might curate templates that span more
  topologies.

---

## Resolved limitations (kept for history)

- ~~Poly-G "evolve to a helix" puzzle was uninstructive due to low
  pLDDT.~~ **Resolved during initial design**: redesigned around
  high-confidence Marqusee α-helix templates with Pro/Gly breakers
  placed for usable RMSD gradients. Documented in the design-rationale
  section of the README.
