"""Puzzle templates — the structural archetypes our generator can produce.

A *template* is (1) a target sequence whose ESMFold prediction folds
confidently into a known structure type and (2) a recipe for "breaking"
it that the player can plausibly reverse. The generator picks a seed,
runs the template's recipe, and the validator gates the result.

Today we ship two templates:

* **Marqusee** — a (AEAAAKA)x α-helix repeat. Lengths 28/42/56 aa for
  easy/medium/hard. Breakers are Pro/Gly inserted at non-adjacent
  interior positions (helix caps preserved). ESMFold gives the un-
  broken sequence pLDDT 0.97–0.98.
* **GB1 hairpin** — the β-hairpin from protein G B1 domain (residues
  41-56, ``GEWTYDDATKTFTVTE``). Strand residues are swapped to
  helix-favoring AAs (A, E, K, L) to disrupt the strand. The turn
  residues are off-limits so the fold has a chance to re-form.

Adding a template is a single dataclass instance plus an entry in
:data:`TEMPLATES`. The generator + validator + prewarm flow then handle
it without further changes.
"""

from dataclasses import dataclass
from itertools import combinations
import random
from typing import Callable, Iterable

# ---------------------------------------------------------------------------
# Difficulty preset shape
# ---------------------------------------------------------------------------

# (target_length, n_breakers, mutation_budget, solved_rmsd_per_aa)
DifficultyPreset = tuple[int, int, int, float]


# ---------------------------------------------------------------------------
# Template definition
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Template:
    """Procedural recipe for one structural motif.

    Attributes
    ----------
    id            Unique slug used in puzzle ids and API requests.
    label         Human-readable name shown in titles/descriptions.
    difficulty_presets
                  Map of difficulty → (length, n_breakers, budget, solved_per_aa).
                  Length must be present in :attr:`target_sequence_for_length`.
    target_sequence_for_length
                  Returns the un-broken (target) sequence for the given length.
                  For fixed-length templates (e.g. GB1 hairpin) this raises
                  ``ValueError`` for unsupported lengths.
    pick_break_positions
                  Choose ``n`` non-adjacent positions to break in the target
                  sequence. Must respect any motif-specific constraints
                  (helix caps, turn positions, etc.).
    substitute_aa
                  Given the target sequence, position, and rng, return the
                  one-letter AA to write at that position to "break" the
                  motif. Often a random choice from a small alphabet.
    hint          Static gameplay hint shown in the rail.
    title_template
                  Format string with ``{difficulty}`` placeholder.
    description_template
                  Format string with ``{length}``, ``{n_breakers}``,
                  ``{seed}`` placeholders.
    """

    id: str
    label: str
    difficulty_presets: dict[str, DifficultyPreset]
    target_sequence_for_length: Callable[[int], str]
    pick_break_positions: Callable[[str, int, random.Random], list[int]]
    substitute_aa: Callable[[str, int, random.Random], str]
    hint: str
    title_template: str
    description_template: str

    def target_lengths(self) -> tuple[int, ...]:
        """Unique sorted lengths across all difficulty presets — used by prewarm."""
        return tuple(sorted({preset[0] for preset in self.difficulty_presets.values()}))


# ---------------------------------------------------------------------------
# Template 1: Marqusee α-helix
# ---------------------------------------------------------------------------

MARQUSEE_BLOCK = "AEAAAKA"


def _marqusee_sequence(length: int) -> str:
    if length % len(MARQUSEE_BLOCK) != 0:
        raise ValueError(f"Marqusee length must be a multiple of {len(MARQUSEE_BLOCK)}, got {length}")
    return MARQUSEE_BLOCK * (length // len(MARQUSEE_BLOCK))


def _marqusee_break_positions(target_seq: str, k: int, rng: random.Random) -> list[int]:
    """k positions in [2, length-3], no two adjacent. Raises if infeasible.

    Helix caps (first 2 and last 2 residues) are off-limits — breaking a cap
    doesn't disrupt the interior helix and would skew the gradient signal.
    """
    n = len(target_seq)
    candidates = list(range(2, n - 2))
    rng.shuffle(candidates)
    chosen: list[int] = []
    for pos in candidates:
        if all(abs(pos - c) >= 2 for c in chosen):
            chosen.append(pos)
            if len(chosen) == k:
                return sorted(chosen)
    raise ValueError(f"Could not place {k} non-adjacent breakers in length {n}")


def _marqusee_substitute(target_seq: str, pos: int, rng: random.Random) -> str:
    return rng.choice("PG")


MARQUSEE_TEMPLATE = Template(
    id="marqusee",
    label="Marqusee helix",
    difficulty_presets={
        "easy":   (28, 4, 6,  0.05),
        "medium": (42, 6, 8,  0.04),
        "hard":   (56, 9, 11, 0.035),
    },
    target_sequence_for_length=_marqusee_sequence,
    pick_break_positions=_marqusee_break_positions,
    substitute_aa=_marqusee_substitute,
    hint="Helix-breakers are P and G. Helix-favoring residues are A, E, K, L, M.",
    title_template="Random Marqusee | {difficulty}",
    description_template=(
        "Procedurally generated. {length}-residue Marqusee template "
        "(AEAAAKA repeat) with {n_breakers} helix-breakers (P or G) sprinkled "
        "in the interior. Restore the alpha-helix. Seed: {seed}."
    ),
)


# ---------------------------------------------------------------------------
# Template 2: GB1 β-hairpin
# ---------------------------------------------------------------------------
#
# The hairpin from protein G B1 domain (residues 41-56). 16-residue, two
# antiparallel β-strands joined by a tight type I' turn. ESMFold predicts
# this sequence with high confidence (mean pLDDT ~0.85+) — the cooperative
# β-sheet hydrogen bond pattern is stable enough to be reformed after a
# small number of strand mutations.
#
# Strand-breaker recipe: swap branched/aromatic strand residues
# (W, Y, T, F, V, I) for helix-favoring residues (A, L, K, E). This
# disrupts β-propensity locally without making the polypeptide so flexible
# that ESMFold loses confidence in the global fold. We exclude the turn
# residues (positions 5-7 in 0-indexed coordinates: D-D-A) — touching the
# turn collapses the hairpin geometry rather than just weakening it.

_GB1_HAIRPIN_SEQ = "GEWTYDDATKTFTVTE"  # 16 aa
_GB1_TURN_POSITIONS = {5, 6, 7}        # 0-indexed DDA turn
_GB1_STRAND_BREAKABLE_AAS = set("WYTFVI")  # branched/aromatic, β-loving
_GB1_STRAND_SUBSTITUTES = "ALKE"           # helix-favoring substitutes
# Core hydrophobic positions that stabilise the hairpin pack. Disrupting at
# least one of these per puzzle is what makes the broken starter actually
# unfold — empirically, sweeping the threonines alone leaves ESMFold's
# prediction near the wild-type structure (RMSD < 0.5 Å), and the validator
# correctly rejects those as trivial.
_GB1_CORE_POSITIONS = {2, 4, 11, 13}   # W, Y, F, V


def _gb1_hairpin_sequence(length: int) -> str:
    if length != len(_GB1_HAIRPIN_SEQ):
        raise ValueError(
            f"gb1-hairpin only supports length {len(_GB1_HAIRPIN_SEQ)}, got {length}"
        )
    return _GB1_HAIRPIN_SEQ


def _gb1_hairpin_break_positions(target_seq: str, k: int, rng: random.Random) -> list[int]:
    """k positions in the β-strands, excluding the turn, no two adjacent.

    Picks at least one core hydrophobic position (W/Y/F/V) so the broken
    starter actually unfolds — sweeping the threonines alone leaves the
    hairpin near-intact, which the validator rejects as trivial.

    The eligible pool is tiny (9 strand positions), so we enumerate every
    valid placement and let the rng choose one. A greedy random walk can
    paint itself into a corner (e.g. picking T3 blocks both W2 and Y4),
    which made ~17% of explicit hard seeds unplaceable.
    """
    eligible = [
        i for i, aa in enumerate(target_seq)
        if i not in _GB1_TURN_POSITIONS and aa in _GB1_STRAND_BREAKABLE_AAS
    ]
    if not any(i in _GB1_CORE_POSITIONS for i in eligible):
        raise ValueError("GB1 hairpin: no core positions available (bad template definition)")

    placements = [
        list(combo) for combo in combinations(eligible, k)
        if all(b - a >= 2 for a, b in zip(combo, combo[1:]))
        and any(i in _GB1_CORE_POSITIONS for i in combo)
    ]
    if not placements:
        raise ValueError(
            f"Could not place {k} non-adjacent breakers in GB1 hairpin "
            f"(only {len(eligible)} eligible strand positions available, "
            f"non-adjacency cap is the bottleneck)"
        )
    return rng.choice(placements)


def _gb1_hairpin_substitute(target_seq: str, pos: int, rng: random.Random) -> str:
    """Pick a helix-favoring AA that differs from the native residue."""
    native = target_seq[pos]
    # Should never collide given _GB1_STRAND_BREAKABLE_AAS is disjoint from
    # _GB1_STRAND_SUBSTITUTES, but the check keeps the contract honest.
    options = [a for a in _GB1_STRAND_SUBSTITUTES if a != native]
    return rng.choice(options)


GB1_HAIRPIN_TEMPLATE = Template(
    id="gb1-hairpin",
    label="GB1 hairpin",
    difficulty_presets={
        # All three tiers share the 16 aa target; difficulty scales by
        # breaker count and the budget tightness. Easy is 3 breakers
        # because 2 leaves the broken hairpin folding too close to native
        # (baseline RMSD < 0.5 Å, validator rejects as trivial).
        "easy":   (16, 3, 5, 0.10),
        "medium": (16, 4, 6, 0.08),
        "hard":   (16, 5, 7, 0.07),
    },
    target_sequence_for_length=_gb1_hairpin_sequence,
    pick_break_positions=_gb1_hairpin_break_positions,
    substitute_aa=_gb1_hairpin_substitute,
    hint=(
        "Beta-strands prefer branched residues: V, I, T, W, Y, F. "
        "Helix-favoring residues (A, L, K, E) disrupt sheets. "
        "The turn (positions 6-8, DDA) is intact — focus on the strands."
    ),
    title_template="GB1 hairpin | {difficulty}",
    description_template=(
        "Procedurally generated. The {length}-residue GB1 hairpin "
        "(GEWTYDDATKTFTVTE) with {n_breakers} strand residues swapped for "
        "helix-favorers. Restore the beta-hairpin. Seed: {seed}."
    ),
)


# ---------------------------------------------------------------------------
# Template 3: GCN4 leucine-zipper coiled-coil
# ---------------------------------------------------------------------------
#
# GCN4-p1 (yeast GCN4 transcription factor residues 250-281, plus an N-cap
# R/M for in-vitro stability) is the canonical leucine-zipper coiled coil.
# As a homodimer it forms a parallel two-helix bundle, but ESMFold sees a
# single chain — so it predicts a single α-helix held together by the
# heptad-d Leucines packing into a hydrophobic spine.
#
# This is mechanistically distinct from Marqusee (which stabilises with
# Glu-/Lys+ salt bridges at i, i+4) and from GB1 hairpin (β-strand). The
# pedagogy: heptad-d hydrophobic packing rules the coiled-coil. Replace a
# core Leucine with Glu and the helix loses its anchor.
#
# Breaker pool: the four heptad-d Leucines (4, 11, 18, 25) are the
# mandatory hit positions; two more surface Leucines (12, 28) sit at
# heptad-e/g and serve as supplementary breakers for the harder
# difficulties so the puzzle isn't deterministic at hard.
#
# Substitute: always E. Maximum charge insult into a hydrophobic interior;
# also matches what a frustrated player would think to type back.

_GCN4_SEQ = "RMKQLEDKVEELLSKNYHLENEVARLKKLVGER"  # 33 aa, GCN4-p1 with N-cap RM
_GCN4_CORE_LEU = [4, 11, 18, 25]                  # heptad-d, the hydrophobic spine
_GCN4_SURFACE_LEU = [12, 28]                      # heptad-e/g, supplementary


def _gcn4_sequence(length: int) -> str:
    if length != len(_GCN4_SEQ):
        raise ValueError(
            f"gcn4-coil only supports length {len(_GCN4_SEQ)}, got {length}"
        )
    return _GCN4_SEQ


def _gcn4_break_positions(target_seq: str, k: int, rng: random.Random) -> list[int]:
    """Pick k Leucines, biased toward the heptad-d core.

    The first ``min(k, 4)`` picks come from the core spine so a broken
    starter always loses at least one packing interaction. Beyond 4, the
    surface Leucines round out the breaker count.
    """
    n_core = min(k, len(_GCN4_CORE_LEU))
    core_pool = list(_GCN4_CORE_LEU)
    rng.shuffle(core_pool)
    chosen = core_pool[:n_core]
    if k > n_core:
        other_pool = list(_GCN4_SURFACE_LEU)
        rng.shuffle(other_pool)
        chosen.extend(other_pool[:k - n_core])
    if len(chosen) < k:
        raise ValueError(
            f"GCN4 has {len(_GCN4_CORE_LEU) + len(_GCN4_SURFACE_LEU)} breakable Leucines, "
            f"asked for {k}"
        )
    return sorted(chosen)


def _gcn4_substitute(target_seq: str, pos: int, rng: random.Random) -> str:
    """Always Glu — maximum disruption to the hydrophobic spine."""
    return "E"


GCN4_COIL_TEMPLATE = Template(
    id="gcn4-coil",
    label="GCN4 coiled-coil",
    difficulty_presets={
        # All 33 aa; difficulty scales with how much of the heptad spine we kill.
        "easy":   (33, 2, 4, 0.08),
        "medium": (33, 3, 5, 0.06),
        "hard":   (33, 5, 7, 0.05),
    },
    target_sequence_for_length=_gcn4_sequence,
    pick_break_positions=_gcn4_break_positions,
    substitute_aa=_gcn4_substitute,
    hint=(
        "GCN4 is held together by buried Leucines every 7 residues (heptad "
        "repeat). The breakers swapped them for Glu, which doesn't pack into "
        "a hydrophobic interior. Put the Leucines back."
    ),
    title_template="GCN4 coiled-coil | {difficulty}",
    description_template=(
        "Procedurally generated. The {length}-residue GCN4 leucine-zipper "
        "(a single-chain α-helix held by heptad-d Leucines packing into the "
        "core) with {n_breakers} buried Leucines swapped for Glu. Seed: {seed}."
    ),
)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

TEMPLATES: dict[str, Template] = {
    MARQUSEE_TEMPLATE.id: MARQUSEE_TEMPLATE,
    GB1_HAIRPIN_TEMPLATE.id: GB1_HAIRPIN_TEMPLATE,
    GCN4_COIL_TEMPLATE.id: GCN4_COIL_TEMPLATE,
}


def get_template(template_id: str) -> Template:
    """Return the Template for ``template_id`` or raise ValueError."""
    try:
        return TEMPLATES[template_id]
    except KeyError:
        known = ", ".join(sorted(TEMPLATES))
        raise ValueError(f"Unknown template {template_id!r}. Known: {known}.")


def all_target_lengths() -> set[tuple[str, int]]:
    """Every (template_id, length) pair that prewarm needs to predict."""
    return {(tpl.id, n) for tpl in TEMPLATES.values() for n in tpl.target_lengths()}
