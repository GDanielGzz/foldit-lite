"""Procedural puzzle generator.

Drives the templates in :mod:`backend.services.puzzle_templates`:

    1. Look up the requested template + difficulty preset.
    2. Use a seeded RNG to pick non-adjacent break positions and the
       substitute AA at each.
    3. Predict the broken starter so we can fill ``baseline_rmsd``.
    4. Hand the candidate to :func:`puzzle_validator.validate_puzzle`.
    5. Pass → return; fail → log + try a fresh seed (up to ``max_attempts``).

Baseline RMSD for unvalidated calls is computed lazily by the
``/predict`` router on first scoring request, mirroring the prior
behaviour. The validated path always fills baseline_rmsd up front because
the validator needs it.

Targets are pre-warmed at startup by :func:`prewarm_targets`, which walks
every ``(template, length)`` pair in :data:`puzzle_templates.TEMPLATES`.
"""

import logging
import random
from dataclasses import replace
from typing import Callable

from backend.services.puzzle_templates import (
    TEMPLATES,
    Template,
    all_target_lengths,
    get_template,
)
from backend.services.puzzle_validator import ValidationResult, validate_puzzle
from backend.services.puzzles import Puzzle
from backend.services.scoring import ca_coords_from_pdb, kabsch_rmsd
from backend.services.structure_cache import mean_plddt_from_pdb

log = logging.getLogger(__name__)


PredictFn = Callable[[str], tuple[str, float]]


class PuzzleGenerationError(RuntimeError):
    """Raised when no seed in the attempt budget produces a passing puzzle."""


# Public re-export so callers can probe "what difficulties does marqusee support?"
DIFFICULTY_PRESETS = TEMPLATES["marqusee"].difficulty_presets


# ---------------------------------------------------------------------------
# One-shot generation (no validation) — kept for the /predict baseline path
# and for tests that want a specific deterministic seed.
# ---------------------------------------------------------------------------

def generate_puzzle(
    template_id: str,
    difficulty: str,
    seed: int,
    targets: dict[tuple[str, int], str],
) -> Puzzle:
    """Build a Puzzle for the given template at the given difficulty.

    ``targets`` maps ``(template_id, length)`` → predicted target PDB.
    Pre-warm it via :func:`prewarm_targets`.
    """
    tpl = get_template(template_id)
    if difficulty not in tpl.difficulty_presets:
        raise ValueError(
            f"Template {tpl.id!r} doesn't support difficulty {difficulty!r}. "
            f"Available: {sorted(tpl.difficulty_presets)}"
        )

    length, n_breaks, budget, solved_per_aa = tpl.difficulty_presets[difficulty]
    key = (tpl.id, length)
    if key not in targets:
        raise ValueError(
            f"Target for {tpl.id!r} length {length} not pre-warmed; "
            f"call prewarm_targets first."
        )

    rng = random.Random(seed)
    target_seq = tpl.target_sequence_for_length(length)
    break_positions = tpl.pick_break_positions(target_seq, n_breaks, rng)

    starter = list(target_seq)
    for pos in break_positions:
        starter[pos] = tpl.substitute_aa(target_seq, pos, rng)
    starter_seq = "".join(starter)

    pid = f"gen-{tpl.id}-{difficulty}-{seed}"
    title = tpl.title_template.format(difficulty=difficulty)
    description = tpl.description_template.format(
        length=length, n_breakers=n_breaks, seed=seed,
    )
    solved_rmsd = round(length * solved_per_aa, 2)

    return Puzzle(
        id=pid,
        title=title,
        description=description,
        starting_sequence=starter_seq,
        target_pdb=targets[key],
        mutation_budget=budget,
        baseline_rmsd=0.0,
        expected_solved_rmsd=solved_rmsd,
        hint=tpl.hint,
        difficulty=difficulty,
    )


# Backwards-compatible alias — older callers + tests imported this name.
def generate_marqusee_puzzle(
    difficulty: str,
    seed: int,
    targets: dict[int, str] | dict[tuple[str, int], str],
) -> Puzzle:
    """Generate a Marqusee-template puzzle.

    Accepts both the legacy ``{length: pdb}`` map and the new
    ``{(template_id, length): pdb}`` map so existing tests keep working.
    """
    if targets and isinstance(next(iter(targets.keys())), int):
        targets = {("marqusee", k): v for k, v in targets.items()}  # type: ignore[assignment]
    return generate_puzzle("marqusee", difficulty, seed, targets)  # type: ignore[arg-type]


def fill_baseline_rmsd(puzzle: Puzzle, broken_pdb: str) -> Puzzle:
    """Compute baseline RMSD from the broken-starter prediction and update the puzzle."""
    broken_ca = ca_coords_from_pdb(broken_pdb)
    target_ca = ca_coords_from_pdb(puzzle.target_pdb)
    rmsd = kabsch_rmsd(broken_ca, target_ca)
    return replace(puzzle, baseline_rmsd=round(rmsd, 2))


def prewarm_targets(predict_fn: PredictFn) -> dict[tuple[str, int], str]:
    """Predict the target structure for every (template, length) once at startup.

    `predict_fn(seq) -> (pdb, elapsed)` is the cache-first ESM Atlas wrapper.
    Returns ``{(template_id, length): pdb}``.
    """
    out: dict[tuple[str, int], str] = {}
    for template_id, length in sorted(all_target_lengths()):
        tpl = TEMPLATES[template_id]
        seq = tpl.target_sequence_for_length(length)
        pdb, _ = predict_fn(seq)
        out[(template_id, length)] = pdb
    return out


# ---------------------------------------------------------------------------
# Validated generation — the path the routers call by default
# ---------------------------------------------------------------------------

def _build_candidate(
    template_id: str,
    difficulty: str,
    seed: int,
    targets: dict[tuple[str, int], str],
    predict_fn: PredictFn,
) -> tuple[Puzzle, float | None]:
    """Generate a candidate puzzle and fill its baseline RMSD."""
    puzzle = generate_puzzle(template_id, difficulty, seed, targets)
    broken_pdb, _ = predict_fn(puzzle.starting_sequence)
    puzzle = fill_baseline_rmsd(puzzle, broken_pdb)
    return puzzle, mean_plddt_from_pdb(broken_pdb)


def generate_validated_puzzle(
    template_id: str,
    difficulty: str,
    targets: dict[tuple[str, int], str],
    predict_fn: PredictFn,
    *,
    seed: int | None = None,
    rng: random.Random | None = None,
    max_attempts: int = 4,
) -> tuple[Puzzle, ValidationResult]:
    """Generate puzzles for ``template_id`` until one passes validation.

    If ``seed`` is provided, that exact seed is tried once — pass or fail.
    Otherwise we sample up to ``max_attempts`` random seeds via ``rng``
    (defaults to a fresh SystemRandom).
    """
    tpl = get_template(template_id)
    if difficulty not in tpl.difficulty_presets:
        raise ValueError(
            f"Template {tpl.id!r} doesn't support difficulty {difficulty!r}"
        )
    length = tpl.difficulty_presets[difficulty][0]
    original_seq = tpl.target_sequence_for_length(length)

    def _validate(s: int) -> tuple[Puzzle, ValidationResult]:
        puzzle, plddt = _build_candidate(template_id, difficulty, s, targets, predict_fn)
        result = validate_puzzle(
            starter_seq=puzzle.starting_sequence,
            original_seq=original_seq,
            target_pdb=puzzle.target_pdb,
            mutation_budget=puzzle.mutation_budget,
            expected_solved_rmsd=puzzle.expected_solved_rmsd,
            baseline_rmsd=puzzle.baseline_rmsd,
            starter_plddt=plddt,
            predict_fn=predict_fn,
        )
        return puzzle, result

    if seed is not None:
        puzzle, result = _validate(seed)
        log.info("%s seed=%d %s: %s", tpl.id, seed, difficulty, result.summary())
        if not result.passes:
            raise PuzzleGenerationError(
                f"Seed {seed} for {tpl.id!r} at {difficulty!r} did not validate: {result.reason}"
            )
        return puzzle, result

    rng = rng or random.SystemRandom()
    last_reason = "no attempts run"
    for attempt in range(1, max_attempts + 1):
        candidate_seed = rng.randint(1, 1_000_000)
        try:
            puzzle, result = _validate(candidate_seed)
        except Exception as e:
            log.warning("%s build failed seed=%d: %s", tpl.id, candidate_seed, e)
            last_reason = f"build error: {e}"
            continue
        log.info(
            "%s attempt %d/%d seed=%d %s: %s",
            tpl.id, attempt, max_attempts, candidate_seed, difficulty, result.summary(),
        )
        if result.passes:
            return puzzle, result
        last_reason = result.reason

    raise PuzzleGenerationError(
        f"No valid {tpl.id!r} puzzle found in {max_attempts} attempts at {difficulty!r}: {last_reason}"
    )


# Backwards-compatible wrapper — the previous public function only handled
# marqusee. Callers that already imported this name keep working.
def generate_validated_marqusee_puzzle(
    difficulty: str,
    targets: dict[int, str] | dict[tuple[str, int], str],
    predict_fn: PredictFn,
    *,
    seed: int | None = None,
    rng: random.Random | None = None,
    max_attempts: int = 4,
) -> tuple[Puzzle, ValidationResult]:
    if targets and isinstance(next(iter(targets.keys())), int):
        targets = {("marqusee", k): v for k, v in targets.items()}  # type: ignore[assignment]
    return generate_validated_puzzle(
        "marqusee", difficulty, targets, predict_fn,  # type: ignore[arg-type]
        seed=seed, rng=rng, max_attempts=max_attempts,
    )
