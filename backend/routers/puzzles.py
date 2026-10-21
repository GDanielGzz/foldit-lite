import asyncio

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from backend.services.pdb_importer import (
    PdbImportError,
    import_validated_pdb_puzzle,
)
from backend.services.puzzle_generator import (
    PuzzleGenerationError,
    generate_validated_puzzle,
)
from backend.services.puzzle_templates import TEMPLATES, get_template
from backend.services.puzzles import Puzzle

router = APIRouter()


class PuzzleResponse(BaseModel):
    id: str
    title: str
    description: str
    starting_sequence: str
    mutation_budget: int
    baseline_rmsd: float
    expected_solved_rmsd: float
    hint: str | None
    difficulty: str
    generated: bool = False
    seed: int | None = None


class GenerateRequest(BaseModel):
    template: str = Field(
        "marqusee",
        description=f"Puzzle template id. One of: {', '.join(sorted(TEMPLATES))}.",
    )
    difficulty: str = Field("easy", description="One of: easy, medium, hard.")
    seed: int | None = Field(None, description="RNG seed; omit for a random puzzle.")


class TemplateInfo(BaseModel):
    id: str
    label: str
    difficulties: list[str]
    target_lengths: list[int]
    hint: str


@router.get("/puzzles", response_model=list[PuzzleResponse])
def list_puzzles(request: Request) -> list[PuzzleResponse]:
    return [_to_response(p) for p in request.app.state.puzzles.values()]


# Register fixed sub-paths BEFORE the {puzzle_id} catch-all so FastAPI
# doesn't route /puzzles/templates into get_puzzle.
@router.get("/puzzles/templates", response_model=list[TemplateInfo])
def list_templates() -> list[TemplateInfo]:
    """What template / difficulty combinations the generator can produce."""
    return [
        TemplateInfo(
            id=tpl.id,
            label=tpl.label,
            difficulties=list(tpl.difficulty_presets.keys()),
            target_lengths=list(tpl.target_lengths()),
            hint=tpl.hint,
        )
        for tpl in TEMPLATES.values()
    ]


@router.get("/puzzles/{puzzle_id}", response_model=PuzzleResponse)
def get_puzzle(puzzle_id: str, request: Request) -> PuzzleResponse:
    p = _find(request, puzzle_id)
    if p is None:
        raise HTTPException(404, f"Unknown puzzle id: {puzzle_id}")
    return _to_response(
        p,
        generated=puzzle_id.startswith(("gen-", "pdb-")),
    )


@router.post("/puzzles/generate", response_model=PuzzleResponse)
async def generate_puzzle(req: GenerateRequest, request: Request) -> PuzzleResponse:
    try:
        tpl = get_template(req.template)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if req.difficulty not in tpl.difficulty_presets:
        raise HTTPException(
            400,
            f"Template {tpl.id!r} doesn't support difficulty {req.difficulty!r}. "
            f"Available: {sorted(tpl.difficulty_presets)}",
        )

    targets = request.app.state.template_targets
    if not targets:
        raise HTTPException(
            503,
            "Template targets not pre-warmed (ESM Atlas was unreachable at startup).",
        )

    # Fast path: if no specific seed was requested, try the queue first.
    # The pop is non-blocking; if the slot is empty we fall through to
    # synchronous generation. Either way, schedule a refill so subsequent
    # requests stay fast.
    queue = request.app.state.puzzle_queue
    if req.seed is None:
        queued = queue.try_pop(req.template, req.difficulty)
        if queued is not None:
            request.app.state.generated_puzzles[queued.id] = queued
            queue.schedule_refill(req.template, req.difficulty)
            try:
                seed = int(queued.id.rsplit("-", 1)[1])
            except (ValueError, IndexError):
                seed = None
            return _to_response(queued, generated=True, seed=seed)

    # Slow path: queue empty (or specific seed requested) → generate
    # synchronously. We run in a threadpool because the underlying
    # ESMFold client is blocking; doing it inline would freeze the event
    # loop and starve other requests.
    predict_fn = request.app.state.predict_fn
    try:
        loop = asyncio.get_running_loop()
        puzzle, _result = await loop.run_in_executor(
            None,
            lambda: generate_validated_puzzle(
                req.template, req.difficulty, targets, predict_fn, seed=req.seed,
            ),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except PuzzleGenerationError as e:
        raise HTTPException(422, str(e))

    # Pull seed back out of the deterministic id format.
    try:
        seed = int(puzzle.id.rsplit("-", 1)[1])
    except (ValueError, IndexError):
        seed = req.seed

    request.app.state.generated_puzzles[puzzle.id] = puzzle
    # Schedule a background refill so the next request of the same kind hits the queue.
    if req.seed is None:
        queue.schedule_refill(req.template, req.difficulty)
    return _to_response(puzzle, generated=True, seed=seed)


class ImportPdbRequest(BaseModel):
    pdb_id: str = Field(..., description="4-letter RCSB PDB entry ID (e.g. '1ENH').")
    chain: str = Field("A", description="Auth chain letter.")
    difficulty: str = Field("easy", description="One of: easy, medium, hard.")
    seed: int | None = Field(None, description="RNG seed; omit for a random puzzle.")


@router.post("/puzzles/from-pdb", response_model=PuzzleResponse)
def import_from_pdb(req: ImportPdbRequest, request: Request) -> PuzzleResponse:
    if req.difficulty not in ("easy", "medium", "hard"):
        raise HTTPException(400, f"Unknown difficulty: {req.difficulty!r}")

    predict_fn = request.app.state.predict_fn

    try:
        puzzle, _result = import_validated_pdb_puzzle(
            pdb_id=req.pdb_id.strip().upper(),
            chain=req.chain.strip().upper(),
            difficulty=req.difficulty,
            predict_fn=predict_fn,
            seed=req.seed,
        )
    except PdbImportError as e:
        raise HTTPException(e.status, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Pull seed back out of the deterministic id format.
    try:
        seed = int(puzzle.id.rsplit("-", 1)[1])
    except (ValueError, IndexError):
        seed = req.seed

    request.app.state.generated_puzzles[puzzle.id] = puzzle
    return _to_response(puzzle, generated=True, seed=seed)


def _find(request: Request, puzzle_id: str) -> Puzzle | None:
    static = request.app.state.puzzles
    if puzzle_id in static:
        return static[puzzle_id]
    return request.app.state.generated_puzzles.get(puzzle_id)


def _to_response(p: Puzzle, *, generated: bool = False, seed: int | None = None) -> PuzzleResponse:
    if seed is None and generated and p.id.startswith("gen-"):
        # Recover seed from id format "gen-<template>-<difficulty>-<seed>"
        try:
            seed = int(p.id.rsplit("-", 1)[1])
        except (ValueError, IndexError):
            seed = None
    return PuzzleResponse(
        id=p.id,
        title=p.title,
        description=p.description,
        starting_sequence=p.starting_sequence,
        mutation_budget=p.mutation_budget,
        baseline_rmsd=p.baseline_rmsd,
        expected_solved_rmsd=p.expected_solved_rmsd,
        hint=p.hint,
        difficulty=p.difficulty,
        generated=generated,
        seed=seed,
    )
