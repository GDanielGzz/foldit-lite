import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import settings
from backend.routers import predict, puzzles, tutor
from backend.services.esmfold_client import predict_pdb
from backend.services.puzzle_generator import prewarm_targets
from backend.services.puzzle_queue import PuzzleQueue
from backend.services.puzzles import load_puzzles
from backend.services.structure_cache import StructureCache, mean_plddt_from_pdb

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("foldit")


def _cached_predict(cache: StructureCache):
    """Predict-with-cache for the prewarm path. Returns (pdb, elapsed_s)."""
    def fn(seq: str) -> tuple[str, float]:
        cached = cache.get(seq)
        if cached is not None:
            return cached[0], 0.0
        pdb, elapsed = predict_pdb(seq)
        cache.put(seq, pdb, mean_plddt_from_pdb(pdb))
        return pdb, elapsed
    return fn


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.cache = StructureCache(settings.cache_db_path)
    app.state.puzzles = load_puzzles()
    # In-memory store for procedurally generated puzzles. IDs collide-safe
    # because they include template + difficulty + seed.
    app.state.generated_puzzles = {}
    # Store the cache-first predict wrapper so routers can use it without
    # importing from main (which would be a circular import).
    app.state.predict_fn = _cached_predict(app.state.cache)
    # Pre-warm every (template, length) target so generated puzzles don't pay
    # cold-start latency on first /generate call. Skipped on failure — the
    # generator surfaces a clear error on demand.
    try:
        app.state.template_targets = prewarm_targets(app.state.predict_fn)
        log.info(
            "prewarmed template targets: %s",
            sorted(app.state.template_targets.keys()),
        )
    except Exception as e:
        log.warning("prewarm failed: %s — generator will be unavailable", e)
        app.state.template_targets = {}

    # Background-warmed FIFO of pre-validated puzzles. Refill kicks off
    # concurrently so the server starts serving immediately even before the
    # queue is full; a /puzzles/generate call will fall through to
    # synchronous generation while the queue is empty.
    app.state.puzzle_queue = PuzzleQueue(
        app.state.template_targets, app.state.predict_fn,
    )
    if app.state.template_targets:
        app.state.queue_warm_task = asyncio.create_task(
            app.state.puzzle_queue.refill_all()
        )
    else:
        app.state.queue_warm_task = None

    log.info("startup: cache=%s (%d entries) puzzles=%d",
             settings.cache_db_path, app.state.cache.size(), len(app.state.puzzles))
    yield
    log.info("shutdown")
    # Cancel any in-flight queue refill so uvicorn shuts down promptly.
    if app.state.queue_warm_task is not None:
        app.state.queue_warm_task.cancel()


app = FastAPI(title="Foldit-lite backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(predict.router)
app.include_router(puzzles.router)
app.include_router(tutor.router)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "cache_entries": app.state.cache.size(),
        "esm_atlas_url": settings.esm_atlas_url,
        "puzzles": len(app.state.puzzles),
        "generated": len(app.state.generated_puzzles),
        "templates_prewarmed": [
            {"template": tpl, "length": n}
            for (tpl, n) in sorted(app.state.template_targets.keys())
        ],
        "queue_depth": app.state.puzzle_queue.depth_map(),
    }
