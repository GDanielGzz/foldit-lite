"""LLM tutor: explain a mutation's effect using the puzzle context.

Design:
- On-demand only (caller decides when to ask). Each call is one Messages API
  request to Anthropic. Costs are linear in player engagement, not in puzzle
  state changes.
- Prompt caching on the system block (large, static persona + biochemistry
  primer). Per-call user message contains the variable mutation context.
- Returns plain text (markdown ok) capped at ~3 sentences via the system
  prompt's instructions and `max_tokens`.
"""

import logging
from dataclasses import dataclass

from anthropic import Anthropic, APIError

from backend.config import settings

log = logging.getLogger(__name__)


# System prompt is intentionally long-ish so prompt caching has something to
# bite — Anthropic caches blocks with cache_control + a 1024-token minimum on
# Sonnet (smaller on Haiku). The biochemistry primer pulls double-duty: it's
# both the model's reference material and the cached prefix.
_SYSTEM_PROMPT = """\
You are a biochemistry tutor in **Foldit-lite**, a browser puzzle game where the
player mutates residues in a small protein and an ML model (ESMFold) predicts
the resulting 3D structure. You explain *what just happened* after each
mutation, using protein structure principles, in a friendly expert tone.

# Hard rules

1. **Be brief.** No more than 3 sentences. No bullet lists, no headers.
2. **Be specific.** Refer to the player's actual mutation (position, what
   changed) and their actual score change (RMSD, pLDDT). Don't recite generic
   textbook claims.
3. **Tie cause to effect.** If RMSD dropped, name the structural reason.
   If RMSD went up or barely moved, say what didn't change and why.
4. **Suggest a direction** when the mutation hurt or had no effect — point
   the player at a different position or AA they could try, but never spoil
   the full answer.
5. **Plain text or light markdown.** No code blocks. Use `**bold**` for
   one or two key terms at most.

# Reference: scales and definitions

- **pLDDT** is per-residue model confidence on a 0–1 scale (ESM Atlas
  convention; not the AlphaFold 0–100 convention). 0.7+ is confident,
  0.5–0.7 is shaky, <0.5 means the model can't decide / region is disordered.
- **RMSD** (Cα, Kabsch-aligned) is the distance between the predicted
  backbone and the target backbone, in Ångströms. Lower is better.
- **Helix-favoring residues**: Ala (A), Leu (L), Met (M), Glu (E), Lys (K),
  Gln (Q). High intrinsic helix propensity, smooth side chains, can
  H-bond at i,i+4 along the backbone.
- **Helix-breakers**: Pro (P) — its ring constrains backbone phi to ~−60°
  and removes the amide H, killing the i,i+4 hydrogen bond pattern; Gly (G)
  — no side chain means the backbone is too floppy to commit to helical
  geometry. Both are statistically over-represented at helix termini and
  loops, under-represented in helix interiors.
- **β-favoring residues**: Val (V), Ile (I), Thr (T), Phe (F), Tyr (Y) —
  branched or aromatic, prefer extended geometry.
- **Cooperative folding**: small proteins often fold or unfold all-at-once.
  You may see RMSD plateau or even rise after a "good" mutation, then crash
  once enough breakers are reverted to commit the model to the right basin.
  This is a real biophysical effect, not a bug — explain it when relevant.

# How to read a mutation

- "Reverted a P at position N to A inside a helix" → likely a big RMSD drop
  and pLDDT rise at and around N.
- "Introduced a P inside a helix" → likely RMSD rise.
- "Mutation outside any helical/structured region" → RMSD likely barely moves;
  the model is insensitive there; suggest a residue inside the kink they see.
- "Mutation respects the local residue context (e.g. A→L in a helix interior)"
  → small RMSD change, possibly pLDDT bump.
"""


@dataclass(frozen=True)
class MutationContext:
    puzzle_title: str
    puzzle_description: str
    puzzle_hint: str | None
    position: int  # 0-indexed
    prev_aa: str
    new_aa: str
    prev_rmsd: float | None
    new_rmsd: float | None
    prev_plddt_mean: float | None
    new_plddt_mean: float | None
    prev_pos_plddt: float | None  # pLDDT at the mutated position, before
    new_pos_plddt: float | None   # pLDDT at the mutated position, after


def _format_user_prompt(ctx: MutationContext) -> str:
    def fmt(v: float | None, suffix: str = "") -> str:
        return f"{v:.3f}{suffix}" if v is not None else "n/a"

    rmsd_arrow = ""
    if ctx.prev_rmsd is not None and ctx.new_rmsd is not None:
        delta = ctx.new_rmsd - ctx.prev_rmsd
        sign = "+" if delta >= 0 else ""
        rmsd_arrow = f" ({sign}{delta:.2f} Å)"

    return f"""\
Puzzle: {ctx.puzzle_title}
Goal: {ctx.puzzle_description}
Hint shown to player: {ctx.puzzle_hint or '(none)'}

Mutation just made:
- Position {ctx.position + 1}: **{ctx.prev_aa} → {ctx.new_aa}**
- Position pLDDT: {fmt(ctx.prev_pos_plddt)} → {fmt(ctx.new_pos_plddt)}

Whole-structure scores:
- RMSD: {fmt(ctx.prev_rmsd, ' Å')} → {fmt(ctx.new_rmsd, ' Å')}{rmsd_arrow}
- Mean pLDDT: {fmt(ctx.prev_plddt_mean)} → {fmt(ctx.new_plddt_mean)}

Explain in ≤3 sentences."""


@dataclass
class TutorResponse:
    explanation: str
    model: str
    input_tokens: int
    output_tokens: int
    cached_tokens: int


def explain_mutation(ctx: MutationContext) -> TutorResponse:
    """Call the LLM. Raises if no API key configured or API call fails."""
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    client = Anthropic(api_key=settings.anthropic_api_key)
    user_prompt = _format_user_prompt(ctx)

    log.info("tutor request: pos=%d %s->%s rmsd=%s->%s",
             ctx.position, ctx.prev_aa, ctx.new_aa, ctx.prev_rmsd, ctx.new_rmsd)

    try:
        msg = client.messages.create(
            model=settings.tutor_model,
            max_tokens=settings.tutor_max_tokens,
            system=[
                {
                    "type": "text",
                    "text": _SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_prompt}],
        )
    except APIError as e:
        log.error("tutor API error: %s", e)
        raise

    # Extract text (Messages API returns a list of content blocks)
    text_parts = [block.text for block in msg.content if block.type == "text"]
    explanation = "".join(text_parts).strip()

    usage = msg.usage
    cached = (
        getattr(usage, "cache_read_input_tokens", 0) or 0
    ) + (getattr(usage, "cache_creation_input_tokens", 0) or 0)

    log.info(
        "tutor ok: in=%d out=%d cached=%d model=%s",
        usage.input_tokens, usage.output_tokens, cached, msg.model,
    )

    return TutorResponse(
        explanation=explanation,
        model=msg.model,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cached_tokens=cached,
    )
