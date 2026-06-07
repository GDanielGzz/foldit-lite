import logging
import re

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from backend.config import settings
from backend.services.esmfold_client import ESMFoldError, predict_pdb
from backend.services.puzzle_generator import fill_baseline_rmsd
from backend.services.scoring import score_pdb_against_target
from backend.services.structure_cache import mean_plddt_from_pdb, per_residue_plddt_from_pdb

log = logging.getLogger(__name__)
router = APIRouter()

VALID_AA = set("ACDEFGHIKLMNPQRSTVWY")
_AA_RE = re.compile(r"^[ACDEFGHIKLMNPQRSTVWY]+$")


class PredictRequest(BaseModel):
    sequence: str = Field(..., min_length=1)
    score_against: str | None = Field(None, description="Puzzle id to score the prediction against.")

    @field_validator("sequence")
    @classmethod
    def normalize(cls, v: str) -> str:
        v = v.strip().upper().replace(" ", "").replace("\n", "")
        if not _AA_RE.match(v):
            invalid = sorted(set(v) - VALID_AA)
            raise ValueError(f"Invalid amino acid letter(s): {invalid}. Use the 20 standard one-letter codes.")
        if len(v) < settings.min_sequence_length:
            raise ValueError(f"Sequence shorter than {settings.min_sequence_length} aa.")
        if len(v) > settings.max_sequence_length:
            raise ValueError(f"Sequence longer than {settings.max_sequence_length} aa (ESM Atlas limit).")
        return v


class ScoreBlock(BaseModel):
    puzzle_id: str
    rmsd: float
    baseline_rmsd: float
    normalized: float  # 0-100, 100 = matches target, 0 = as bad as the puzzle starting structure
    solved: bool


class PredictResponse(BaseModel):
    sequence: str
    length: int
    pdb: str
    plddt_mean: float | None
    plddt_per_residue: list[float]
    source: str  # "cache" | "esm_atlas"
    elapsed_ms: int
    score: ScoreBlock | None = None


@router.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest, request: Request) -> PredictResponse:
    cache = request.app.state.cache
    seq = req.sequence

    cached = cache.get(seq)
    if cached is not None:
        pdb, plddt = cached
        log.info("cache HIT len=%d (cache size=%d)", len(seq), cache.size())
        source, elapsed_ms = "cache", 0
    else:
        log.info("cache MISS len=%d — calling ESM Atlas", len(seq))
        try:
            pdb, elapsed_s = predict_pdb(seq)
        except ESMFoldError as e:
            log.error("predict failed: %s", e)
            raise HTTPException(status_code=502, detail=f"Upstream prediction failed: {e}")
        plddt = mean_plddt_from_pdb(pdb)
        cache.put(seq, pdb, plddt)
        log.info("cache STORE len=%d plddt_mean=%.3f (cache size=%d)", len(seq), plddt or -1, cache.size())
        source, elapsed_ms = "esm_atlas", int(elapsed_s * 1000)

    score: ScoreBlock | None = None
    if req.score_against is not None:
        static = request.app.state.puzzles
        generated = request.app.state.generated_puzzles
        puzzle = static.get(req.score_against) or generated.get(req.score_against)
        if puzzle is None:
            raise HTTPException(404, f"Unknown puzzle id: {req.score_against}")
        try:
            rmsd = score_pdb_against_target(pdb, puzzle.target_pdb)
        except ValueError as e:
            raise HTTPException(400, f"Cannot score: {e}")
        # Generated puzzles ship with baseline_rmsd=0 and fill it on first
        # request that scores the starting sequence. After that it's stable.
        if puzzle.baseline_rmsd <= 0 and seq == puzzle.starting_sequence:
            puzzle = fill_baseline_rmsd(puzzle, pdb)
            generated[puzzle.id] = puzzle  # static puzzles never have 0 baseline
        baseline = puzzle.baseline_rmsd if puzzle.baseline_rmsd > 0 else max(rmsd, 0.01)
        # Normalize to 0-100 where 100 = perfect match, 0 = as bad as the broken starter.
        normalized = max(0.0, min(100.0, 100.0 * (1.0 - rmsd / baseline)))
        score = ScoreBlock(
            puzzle_id=puzzle.id,
            rmsd=rmsd,
            baseline_rmsd=baseline,
            normalized=normalized,
            solved=rmsd <= puzzle.expected_solved_rmsd,
        )

    return PredictResponse(
        sequence=seq,
        length=len(seq),
        pdb=pdb,
        plddt_mean=plddt,
        plddt_per_residue=per_residue_plddt_from_pdb(pdb),
        source=source,
        elapsed_ms=elapsed_ms,
        score=score,
    )
