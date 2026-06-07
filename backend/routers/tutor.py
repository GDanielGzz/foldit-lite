import logging

from anthropic import APIError
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from backend.config import settings
from backend.services.tutor import MutationContext, explain_mutation

log = logging.getLogger(__name__)
router = APIRouter()


class ExplainRequest(BaseModel):
    puzzle_id: str
    position: int = Field(..., ge=0, description="0-indexed sequence position that was mutated.")
    prev_aa: str = Field(..., min_length=1, max_length=1)
    new_aa: str = Field(..., min_length=1, max_length=1)
    prev_rmsd: float | None = None
    new_rmsd: float | None = None
    prev_plddt_mean: float | None = None
    new_plddt_mean: float | None = None
    prev_pos_plddt: float | None = None
    new_pos_plddt: float | None = None


class ExplainResponse(BaseModel):
    explanation: str
    model: str
    input_tokens: int
    output_tokens: int
    cached_tokens: int


@router.get("/tutor/status")
def status():
    """Lets the frontend know whether the tutor is available before showing the button."""
    return {"available": bool(settings.anthropic_api_key), "model": settings.tutor_model}


@router.post("/tutor/explain", response_model=ExplainResponse)
def explain(req: ExplainRequest, request: Request) -> ExplainResponse:
    if not settings.anthropic_api_key:
        raise HTTPException(503, "Tutor unavailable: ANTHROPIC_API_KEY not set on the server.")

    static = request.app.state.puzzles
    generated = request.app.state.generated_puzzles
    puzzle = static.get(req.puzzle_id) or generated.get(req.puzzle_id)
    if puzzle is None:
        raise HTTPException(404, f"Unknown puzzle id: {req.puzzle_id}")

    ctx = MutationContext(
        puzzle_title=puzzle.title,
        puzzle_description=puzzle.description,
        puzzle_hint=puzzle.hint,
        position=req.position,
        prev_aa=req.prev_aa.upper(),
        new_aa=req.new_aa.upper(),
        prev_rmsd=req.prev_rmsd,
        new_rmsd=req.new_rmsd,
        prev_plddt_mean=req.prev_plddt_mean,
        new_plddt_mean=req.new_plddt_mean,
        prev_pos_plddt=req.prev_pos_plddt,
        new_pos_plddt=req.new_pos_plddt,
    )

    try:
        result = explain_mutation(ctx)
    except APIError as e:
        raise HTTPException(502, f"Anthropic API error: {e}")
    except RuntimeError as e:
        raise HTTPException(503, str(e))

    return ExplainResponse(
        explanation=result.explanation,
        model=result.model,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        cached_tokens=result.cached_tokens,
    )
