"""Background-warmed FIFO of pre-validated puzzles.

The validator gate makes each generated puzzle cost roughly N+2 ESMFold
calls (where N is the breaker count) — 5–10 seconds at warm cache, 30+
seconds when cold. Players shouldn't wait for that when they click "+
New puzzle" or "Next puzzle →"; the answer should already be sitting in
memory.

Design:

* One slot per ``(template_id, difficulty)`` pair (configurable
  ``capacity``, default 1). Today that's 2 templates × 3 difficulties =
  6 slots.
* Startup kicks off a background fill via :meth:`refill_all` —
  non-blocking so the server starts serving immediately even if the
  queue is empty.
* :meth:`try_pop` is O(1) and never waits. The caller (the
  ``/puzzles/generate`` route) immediately schedules a
  :meth:`refill_one` to replace what it took.
* Refills are serialized via an :class:`asyncio.Lock` so a busy server
  doesn't fire N concurrent ESMFold calls and starve foreground
  ``/predict`` traffic.
* Generation happens in the default thread pool because
  ``generate_validated_puzzle`` is blocking (requests-based ESM Atlas
  client). The lock keeps the threadpool from being saturated.

Failure modes:

* Generator can't validate any seed in the attempt budget → we log,
  leave the slot empty, and don't retry until the next pop attempt
  triggers a refill. Prevents tight loops on a busted template.
* Server restart loses the queue. Acceptable: lifespan's
  :meth:`refill_all` rebuilds it in ~60s with warm cache.

Not implemented (yet):

* Frontend pre-fetch — the queue makes the server side instant; a small
  amount of client-side prefetching while the player is mid-puzzle
  would close the remaining gap. Reserved for a future iteration.
* Persistence (SQLite or pickle) — the queue is small enough that
  rebuilding at startup is cheap. If startup latency starts to matter,
  flush to a file on shutdown.
"""

import asyncio
import logging
from collections import deque
from functools import partial
from typing import Callable

from backend.services.puzzle_generator import (
    PuzzleGenerationError,
    generate_validated_puzzle,
)
from backend.services.puzzle_templates import TEMPLATES
from backend.services.puzzles import Puzzle

log = logging.getLogger(__name__)

PredictFn = Callable[[str], tuple[str, float]]

# Per (template, difficulty) capacity. Bumping to 2 doubles ESMFold
# spend without much player-visible benefit; 1 is plenty for solo play.
DEFAULT_CAPACITY = 1

# The queue refill path uses a HIGHER attempt budget than the user-facing
# /puzzles/generate sync path because the player isn't waiting on the
# result — burning a few extra ESMFold calls to fight through a streak of
# validator rejections is preferable to leaving a slot empty (which
# starves the next pop into the slow sync path).
DEFAULT_REFILL_MAX_ATTEMPTS = 8


class PuzzleQueue:
    """Per-(template, difficulty) FIFO of pre-validated puzzles."""

    def __init__(
        self,
        targets: dict[tuple[str, int], str],
        predict_fn: PredictFn,
        *,
        capacity: int = DEFAULT_CAPACITY,
        refill_max_attempts: int = DEFAULT_REFILL_MAX_ATTEMPTS,
    ) -> None:
        self.targets = targets
        self.predict_fn = predict_fn
        self.capacity = capacity
        self.refill_max_attempts = refill_max_attempts
        self.slots: dict[tuple[str, str], deque[Puzzle]] = {}
        # Lazily created — must construct on the running event loop, not
        # at __init__ time (which may run before the loop exists).
        self._refill_lock: asyncio.Lock | None = None
        for tpl_id, tpl in TEMPLATES.items():
            for difficulty in tpl.difficulty_presets:
                self.slots[(tpl_id, difficulty)] = deque(maxlen=capacity)

    # ------------------------------------------------------------------
    # Inspection
    # ------------------------------------------------------------------

    def depth_map(self) -> dict[str, dict[str, int]]:
        """Current queue depths, keyed by template then difficulty."""
        out: dict[str, dict[str, int]] = {}
        for (tpl, diff), dq in self.slots.items():
            out.setdefault(tpl, {})[diff] = len(dq)
        return out

    # ------------------------------------------------------------------
    # Pop (synchronous, never blocks)
    # ------------------------------------------------------------------

    def try_pop(self, template_id: str, difficulty: str) -> Puzzle | None:
        """Return a pre-baked puzzle if one is ready; ``None`` otherwise.

        The caller MUST follow up with :meth:`refill_one` (scheduled on
        the event loop) so the slot gets replenished.
        """
        dq = self.slots.get((template_id, difficulty))
        if not dq:
            return None
        puzzle = dq.popleft()
        log.info("queue: pop (%s, %s) → depth=%d", template_id, difficulty, len(dq))
        return puzzle

    # ------------------------------------------------------------------
    # Refill (async; runs the blocking generator in a thread)
    # ------------------------------------------------------------------

    def _lock(self) -> asyncio.Lock:
        if self._refill_lock is None:
            self._refill_lock = asyncio.Lock()
        return self._refill_lock

    async def _generate_one(self, template_id: str, difficulty: str) -> Puzzle | None:
        """Run ``generate_validated_puzzle`` in a thread; return the puzzle or None.

        Uses ``self.refill_max_attempts`` rather than the generator's default
        because the player isn't waiting on this — we'd rather burn extra
        ESMFold calls fighting through a streak of validator rejections
        than leave the slot empty.
        """
        loop = asyncio.get_running_loop()
        # run_in_executor takes positional args only — wrap with partial to
        # forward our refill-specific max_attempts override.
        thunk = partial(
            generate_validated_puzzle,
            template_id, difficulty, self.targets, self.predict_fn,
            max_attempts=self.refill_max_attempts,
        )
        try:
            puzzle, _result = await loop.run_in_executor(None, thunk)
            return puzzle
        except PuzzleGenerationError as e:
            log.warning("queue: refill failed (%s, %s): %s", template_id, difficulty, e)
            return None
        except Exception as e:  # noqa: BLE001 — never let a refill crash the lifespan task
            log.exception("queue: unexpected refill error (%s, %s): %s", template_id, difficulty, e)
            return None

    async def refill_one(self, template_id: str, difficulty: str) -> None:
        """Top up a single slot to capacity. Safe to schedule and forget."""
        key = (template_id, difficulty)
        if key not in self.slots:
            return
        async with self._lock():
            dq = self.slots[key]
            while len(dq) < self.capacity:
                puzzle = await self._generate_one(template_id, difficulty)
                if puzzle is None:
                    break
                dq.append(puzzle)
                log.info(
                    "queue: refilled (%s, %s) → depth=%d", template_id, difficulty, len(dq),
                )

    async def refill_all(self) -> None:
        """Top up every slot. Runs sequentially under the lock.

        Called once at startup by :func:`backend.main.lifespan`. Each
        slot is filled before moving to the next so we don't slam ESM
        Atlas with N concurrent cold sequences.
        """
        async with self._lock():
            for (tpl_id, difficulty), dq in self.slots.items():
                while len(dq) < self.capacity:
                    puzzle = await self._generate_one(tpl_id, difficulty)
                    if puzzle is None:
                        break
                    dq.append(puzzle)
                    log.info(
                        "queue: refilled (%s, %s) → depth=%d", tpl_id, difficulty, len(dq),
                    )
