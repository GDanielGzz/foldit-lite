"""Import real protein structures from RCSB PDB as Foldit-lite puzzles.

Flow:
1. Fetch canonical sequence from RCSB FASTA endpoint (no auth required)
2. Predict native structure with ESMFold (cache-first)
3. Detect alpha-helix regions via Cα(i)→Cα(i+4) distance criterion
4. Insert P/G breakers at non-adjacent interior helix positions
5. Predict broken starter, compute baseline RMSD, return Puzzle
"""

import logging
import random
import re
from typing import Callable

import numpy as np
import requests

from backend.services.esmfold_client import ESMFoldError
from backend.services.puzzle_validator import ValidationResult, validate_puzzle
from backend.services.puzzles import Puzzle
from backend.services.scoring import ca_coords_from_pdb, kabsch_rmsd
from backend.services.structure_cache import mean_plddt_from_pdb

log = logging.getLogger(__name__)


class PdbImportError(RuntimeError):
    """User-facing failure during the import pipeline. Carries an HTTP-friendly status hint."""
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status

RCSB_FASTA_URL = "https://www.rcsb.org/fasta/entry/{pdb_id}/download"

MIN_AA = 20
MAX_AA = 70

# (min_breaks, max_breaks, mutation_budget, solved_rmsd_per_aa)
DIFFICULTY_PRESETS: dict[str, tuple[int, int, int, float]] = {
    "easy":   (2, 3,  5, 0.06),
    "medium": (3, 6,  8, 0.05),
    "hard":   (5, 9, 11, 0.04),
}

PredictFn = Callable[[str], tuple[str, float]]


# ---------------------------------------------------------------------------
# RCSB sequence fetch
# ---------------------------------------------------------------------------

def fetch_sequence_from_rcsb(pdb_id: str, chain: str = "A") -> tuple[str, str]:
    """Return (canonical_sequence, description) for a chain.

    Raises ValueError with a user-friendly message if the entry or chain is
    not found, or if the network request fails.
    """
    pdb_id = pdb_id.strip().upper()
    chain = chain.strip().upper()
    url = RCSB_FASTA_URL.format(pdb_id=pdb_id)
    try:
        resp = requests.get(url, timeout=15)
    except requests.RequestException as exc:
        raise ValueError(f"Could not reach RCSB ({exc})") from exc

    if resp.status_code == 404:
        raise ValueError(f"PDB entry {pdb_id!r} not found in RCSB")
    if not resp.ok:
        raise ValueError(f"RCSB returned HTTP {resp.status_code} for {pdb_id}")

    return _parse_fasta_for_chain(resp.text, chain, pdb_id)


def _parse_fasta_for_chain(fasta_text: str, chain: str, pdb_id: str) -> tuple[str, str]:
    """Extract (sequence, description) for `chain` from RCSB multi-FASTA text.

    RCSB FASTA header format (each entity is one block):
      >1ENH_1|Chains A[auth A]|ENGRAILED HOMEODOMAIN|Drosophila melanogaster (7227)
      RPRTAFSSEQLARLKREFNENRYLTERRRQQLSSELGLNEAQKISRWPLQSVNATLKNH
    """
    blocks = fasta_text.strip().split(">")[1:]
    available: list[str] = []

    for block in blocks:
        lines = block.strip().split("\n")
        header = lines[0]
        sequence = "".join(lines[1:]).upper().replace(" ", "")

        auth_chains = _extract_auth_chains(header)
        available.extend(auth_chains)

        if chain in auth_chains:
            parts = header.split("|")
            desc = parts[2].strip() if len(parts) > 2 else pdb_id
            return sequence, desc

    unique = sorted(set(available))
    raise ValueError(
        f"Chain {chain!r} not found in PDB {pdb_id}. "
        f"Available chains: {', '.join(unique) or 'none'}"
    )


def _extract_auth_chains(header: str) -> list[str]:
    """Parse auth chain letters from an RCSB FASTA header."""
    m = re.search(r'\[auth\s+([^\]]+)\]', header)
    if m:
        return [c.strip() for c in m.group(1).split(",")]
    # Fallback: 'Chain A' or 'Chains A,B' without [auth ...] annotation
    m2 = re.search(r'Chains?\s+([A-Za-z0-9,\s]+?)(?:\||$)', header)
    if m2:
        return [c.strip() for c in m2.group(1).split(",") if c.strip()]
    return []


# ---------------------------------------------------------------------------
# Helix detection from predicted Cα geometry
# ---------------------------------------------------------------------------

def detect_helix_residues(ca_coords: np.ndarray, min_helix_len: int = 4) -> list[int]:
    """Return 0-indexed positions that lie in alpha-helical regions.

    Criterion: Cα(i)→Cα(i+4) ≤ 6.5 Å marks positions i..i+4 as helical.
    In an ideal α-helix this distance is ~5.1 Å; the threshold is generous
    enough to catch ESMFold's slightly imperfect geometry.
    Runs shorter than `min_helix_len` are discarded.
    """
    n = len(ca_coords)
    in_helix = np.zeros(n, dtype=bool)
    for i in range(n - 4):
        d = float(np.linalg.norm(ca_coords[i + 4] - ca_coords[i]))
        if d <= 6.5:
            in_helix[i: i + 5] = True

    positions: list[int] = []
    run_start: int | None = None
    for i in range(n + 1):
        currently_in = (i < n) and bool(in_helix[i])
        if currently_in:
            if run_start is None:
                run_start = i
        else:
            if run_start is not None:
                if i - run_start >= min_helix_len:
                    positions.extend(range(run_start, i))
                run_start = None
    return positions


def _interior_helix_positions(helix_positions: list[int]) -> list[int]:
    """Strip the first/last 2 positions of each helix run (helix caps)."""
    helix_set = set(helix_positions)
    return [
        p for p in helix_positions
        if all((p + d) in helix_set for d in (-2, -1, 1, 2))
    ]


def _pick_break_positions(
    interior: list[int], n_breaks: int, rng: random.Random
) -> list[int]:
    """Choose `n_breaks` non-adjacent positions from `interior`."""
    shuffled = interior[:]
    rng.shuffle(shuffled)
    chosen: list[int] = []
    for pos in shuffled:
        if all(abs(pos - c) >= 2 for c in chosen):
            chosen.append(pos)
            if len(chosen) == n_breaks:
                return sorted(chosen)
    raise ValueError(
        f"Could not place {n_breaks} non-adjacent breakers "
        f"(only {len(interior)} interior helix positions available)"
    )


# ---------------------------------------------------------------------------
# Main import pipeline
# ---------------------------------------------------------------------------

def _prepare_pdb_target(
    pdb_id: str,
    chain: str,
    difficulty: str,
    predict_fn: PredictFn,
) -> tuple[str, str, str, list[int], int, int, int, float]:
    """Fetch sequence, predict native, detect breakable helix positions.

    Returns ``(native_seq, protein_desc, target_pdb, breakable_positions,
    min_breaks, max_breaks, budget, solved_per_aa)``. The breakable list
    has duplicates removed and excludes P/G native residues (so 'breaking'
    a position is never a no-op). Raises :class:`PdbImportError` for any
    user-facing failure (bad PDB id, sequence out of range, not enough
    helical content).
    """
    if difficulty not in DIFFICULTY_PRESETS:
        raise PdbImportError(f"Unknown difficulty: {difficulty!r}")
    min_breaks, max_breaks, budget, solved_per_aa = DIFFICULTY_PRESETS[difficulty]

    try:
        native_seq, protein_desc = fetch_sequence_from_rcsb(pdb_id, chain)
    except ValueError as e:
        raise PdbImportError(str(e), status=404) from e
    native_seq = re.sub(r"[^ACDEFGHIKLMNPQRSTVWY]", "A", native_seq.upper())

    if len(native_seq) < MIN_AA:
        raise PdbImportError(
            f"Sequence too short ({len(native_seq)} aa; minimum is {MIN_AA})"
        )
    if len(native_seq) > MAX_AA:
        raise PdbImportError(
            f"Sequence too long ({len(native_seq)} aa; maximum is {MAX_AA} — "
            f"try a shorter chain or a different entry)"
        )

    try:
        target_pdb, _ = predict_fn(native_seq)
    except ESMFoldError as e:
        raise PdbImportError(
            f"ESMFold could not fold the native sequence ({e}). "
            f"This often clears on a retry — ESM Atlas can be flaky on cold cache.",
            status=502,
        ) from e

    ca = ca_coords_from_pdb(target_pdb)
    helix_positions = detect_helix_residues(ca)
    interior = _interior_helix_positions(helix_positions)

    if len(interior) < min_breaks:
        raise PdbImportError(
            f"Not enough helical content in {pdb_id} chain {chain} — "
            f"only {len(interior)} interior helix positions detected "
            f"(need at least {min_breaks} for {difficulty!r} difficulty). "
            f"Try a more helical protein or a lower difficulty."
        )

    breakable = [p for p in interior if native_seq[p] not in "PG"]
    if len(breakable) < min_breaks:
        raise PdbImportError(
            f"Not enough breakable helix positions in {pdb_id} chain {chain} "
            f"(only {len(breakable)} interior helix positions where the native "
            f"residue is not already P or G; need at least {min_breaks})."
        )

    return (
        native_seq,
        protein_desc,
        target_pdb,
        breakable,
        min_breaks,
        max_breaks,
        budget,
        solved_per_aa,
    )


def _build_pdb_candidate(
    *,
    pdb_id: str,
    chain: str,
    difficulty: str,
    seed: int,
    native_seq: str,
    protein_desc: str,
    target_pdb: str,
    breakable: list[int],
    min_breaks: int,
    max_breaks: int,
    budget: int,
    solved_per_aa: float,
    predict_fn: PredictFn,
) -> tuple[Puzzle, float | None]:
    """Apply a seeded set of breakers and predict the broken starter.

    Returns ``(puzzle, starter_plddt_mean)``. Reuses the already-fetched
    target so retries only pay for the breaker placement + one ESMFold
    call.
    """
    n_breaks = min(max_breaks, max(min_breaks, len(breakable) // 4))
    rng = random.Random(seed)
    break_positions = _pick_break_positions(breakable, n_breaks, rng)
    native_at_breaks = sorted({native_seq[p] for p in break_positions})

    starter = list(native_seq)
    for pos in break_positions:
        starter[pos] = rng.choice("PG")
    starter_seq = "".join(starter)

    try:
        broken_pdb, _ = predict_fn(starter_seq)
    except ESMFoldError as e:
        raise PdbImportError(
            f"ESMFold could not fold the broken starter ({e}). "
            f"Try again — ESM Atlas occasionally times out on cold sequences.",
            status=502,
        ) from e

    target_ca = ca_coords_from_pdb(target_pdb)
    broken_ca = ca_coords_from_pdb(broken_pdb)
    baseline_rmsd = round(kabsch_rmsd(broken_ca, target_ca), 2)
    solved_rmsd = round(len(native_seq) * solved_per_aa, 2)

    pid = f"pdb-{pdb_id.lower()}{chain.lower()}-{difficulty}-{seed}"
    short_desc = protein_desc if len(protein_desc) <= 36 else protein_desc[:33].rstrip() + "…"
    title = f"{pdb_id.upper()} · {short_desc}"
    description = (
        f"Real protein from RCSB PDB ({pdb_id.upper()} chain {chain.upper()}): "
        f"{protein_desc}. {n_breaks} helix-breaking substitutions (P or G) "
        f"have been introduced. Restore the native fold."
    )

    puzzle = Puzzle(
        id=pid,
        title=title,
        description=description,
        starting_sequence=starter_seq,
        target_pdb=target_pdb,
        mutation_budget=budget,
        baseline_rmsd=baseline_rmsd,
        expected_solved_rmsd=solved_rmsd,
        hint=(
            f"P/G mutations replaced native residues "
            f"({', '.join(native_at_breaks)}) inside helices. "
            f"Pick something that helps a helix re-form."
        ),
        difficulty=difficulty,
    )
    return puzzle, mean_plddt_from_pdb(broken_pdb)


def import_pdb_puzzle(
    pdb_id: str,
    chain: str,
    difficulty: str,
    seed: int,
    predict_fn: PredictFn,
) -> Puzzle:
    """Fetch a real protein from RCSB, break its helix, and return a Puzzle.

    Unvalidated path — kept for callers that want a specific seed without
    validation (debugging, replaying a known-good puzzle). Most callers
    should use :func:`import_validated_pdb_puzzle` instead.
    """
    prep = _prepare_pdb_target(pdb_id, chain, difficulty, predict_fn)
    native_seq, protein_desc, target_pdb, breakable, min_breaks, max_breaks, budget, solved_per_aa = prep
    puzzle, _ = _build_pdb_candidate(
        pdb_id=pdb_id, chain=chain, difficulty=difficulty, seed=seed,
        native_seq=native_seq, protein_desc=protein_desc, target_pdb=target_pdb,
        breakable=breakable, min_breaks=min_breaks, max_breaks=max_breaks,
        budget=budget, solved_per_aa=solved_per_aa, predict_fn=predict_fn,
    )
    return puzzle


def import_validated_pdb_puzzle(
    pdb_id: str,
    chain: str,
    difficulty: str,
    predict_fn: PredictFn,
    *,
    seed: int | None = None,
    rng: random.Random | None = None,
    max_attempts: int = 4,
) -> tuple[Puzzle, ValidationResult]:
    """Like :func:`import_pdb_puzzle`, but loops over seeds until validation passes.

    The FASTA fetch + native prediction happens once (cached afterwards);
    only the breaker placement + broken-starter prediction repeats on each
    seed. With cache warm, each retry costs ~N+2 ESMFold calls.

    If ``seed`` is provided, that exact seed is tried once. Otherwise
    seeds are sampled from ``rng`` (defaults to a fresh SystemRandom).
    """
    prep = _prepare_pdb_target(pdb_id, chain, difficulty, predict_fn)
    native_seq, protein_desc, target_pdb, breakable, min_breaks, max_breaks, budget, solved_per_aa = prep

    def _attempt(s: int) -> tuple[Puzzle, ValidationResult]:
        puzzle, plddt = _build_pdb_candidate(
            pdb_id=pdb_id, chain=chain, difficulty=difficulty, seed=s,
            native_seq=native_seq, protein_desc=protein_desc, target_pdb=target_pdb,
            breakable=breakable, min_breaks=min_breaks, max_breaks=max_breaks,
            budget=budget, solved_per_aa=solved_per_aa, predict_fn=predict_fn,
        )
        result = validate_puzzle(
            starter_seq=puzzle.starting_sequence,
            original_seq=native_seq,
            target_pdb=target_pdb,
            mutation_budget=puzzle.mutation_budget,
            expected_solved_rmsd=puzzle.expected_solved_rmsd,
            baseline_rmsd=puzzle.baseline_rmsd,
            starter_plddt=plddt,
            predict_fn=predict_fn,
        )
        return puzzle, result

    if seed is not None:
        puzzle, result = _attempt(seed)
        log.info("pdb %s/%s seed=%d %s: %s", pdb_id, chain, seed, difficulty, result.summary())
        if not result.passes:
            raise PdbImportError(
                f"Imported puzzle for {pdb_id} chain {chain} at seed {seed} did not validate: {result.reason}",
                status=422,
            )
        return puzzle, result

    rng = rng or random.SystemRandom()
    last_reason = "no attempts run"
    for attempt in range(1, max_attempts + 1):
        candidate_seed = rng.randint(1, 1_000_000)
        try:
            puzzle, result = _attempt(candidate_seed)
        except PdbImportError:
            raise
        log.info(
            "pdb %s/%s attempt %d/%d seed=%d %s: %s",
            pdb_id, chain, attempt, max_attempts, candidate_seed, difficulty, result.summary(),
        )
        if result.passes:
            return puzzle, result
        last_reason = result.reason

    raise PdbImportError(
        f"No valid puzzle for {pdb_id} chain {chain} at {difficulty!r} "
        f"after {max_attempts} attempts: {last_reason}",
        status=422,
    )
