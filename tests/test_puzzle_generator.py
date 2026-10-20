import asyncio
import random

import pytest

from backend.services.puzzle_generator import (
    PuzzleGenerationError,
    generate_marqusee_puzzle,
    generate_puzzle,
    generate_validated_puzzle,
)
from backend.services.puzzle_queue import PuzzleQueue
from backend.services.puzzle_templates import TEMPLATES, all_target_lengths, get_template
from tests.helpers import FakeFolder

ALL_PRESETS = [
    (tpl_id, diff) for tpl_id, tpl in TEMPLATES.items() for diff in tpl.difficulty_presets
]


def _targets() -> dict[tuple[str, int], str]:
    return {
        (tpl_id, n): FakeFolder(TEMPLATES[tpl_id].target_sequence_for_length(n)).target_pdb
        for tpl_id, n in all_target_lengths()
    }


def _breakers(puzzle, native: str) -> list[int]:
    return [i for i, (a, b) in enumerate(zip(puzzle.starting_sequence, native)) if a != b]


def test_get_template_rejects_unknown_id():
    with pytest.raises(ValueError, match="Unknown template"):
        get_template("nope")


@pytest.mark.parametrize("tpl_id, difficulty", ALL_PRESETS)
def test_generated_puzzle_respects_preset(tpl_id, difficulty):
    tpl = TEMPLATES[tpl_id]
    length, n_breaks, budget, solved_per_aa = tpl.difficulty_presets[difficulty]
    native = tpl.target_sequence_for_length(length)

    seed = 0
    p = generate_puzzle(tpl_id, difficulty, seed, _targets())

    assert p.id == f"gen-{tpl_id}-{difficulty}-{seed}"
    assert len(p.starting_sequence) == length
    assert p.mutation_budget == budget >= n_breaks
    assert p.expected_solved_rmsd == round(length * solved_per_aa, 2)
    assert p.baseline_rmsd == 0.0  # filled lazily by /predict
    positions = _breakers(p, native)
    assert len(positions) == n_breaks
    if tpl_id != "gcn4-coil":  # GCN4 targets fixed Leucines, adjacency allowed
        assert all(b - a >= 2 for a, b in zip(positions, positions[1:]))


def test_generation_is_deterministic_per_seed():
    a = generate_puzzle("marqusee", "medium", 1234, _targets())
    b = generate_puzzle("marqusee", "medium", 1234, _targets())
    c = generate_puzzle("marqusee", "medium", 4321, _targets())
    assert a == b
    assert a.starting_sequence != c.starting_sequence


def test_marqusee_breakers_are_interior_pro_or_gly():
    native = TEMPLATES["marqusee"].target_sequence_for_length(56)
    for seed in range(25):
        p = generate_puzzle("marqusee", "hard", seed, _targets())
        for pos in _breakers(p, native):
            assert 2 <= pos <= len(native) - 3
            assert p.starting_sequence[pos] in "PG"


def test_gb1_breakers_hit_core_and_spare_turn():
    native = TEMPLATES["gb1-hairpin"].target_sequence_for_length(16)
    for seed in range(25):
        p = generate_puzzle("gb1-hairpin", "medium", seed, _targets())
        positions = _breakers(p, native)
        assert not set(positions) & {5, 6, 7}
        assert set(positions) & {2, 4, 11, 13}
        assert all(p.starting_sequence[i] in "ALKE" for i in positions)


def test_gb1_hard_every_seed_places_breakers_deterministically():
    # Regression: a greedy placement used to strand ~17% of hard seeds
    # (e.g. picking T3 blocks both W2 and Y4), so explicit seeds 400'd.
    native = TEMPLATES["gb1-hairpin"].target_sequence_for_length(16)
    targets = _targets()
    for seed in range(500):
        p = generate_puzzle("gb1-hairpin", "hard", seed, targets)
        assert p == generate_puzzle("gb1-hairpin", "hard", seed, targets)
        positions = _breakers(p, native)
        assert len(positions) == 5
        assert all(b - a >= 2 for a, b in zip(positions, positions[1:]))
        assert not set(positions) & {5, 6, 7}
        assert set(positions) & {2, 4, 11, 13}


def test_gcn4_breakers_swap_core_leucines_for_glu():
    native = TEMPLATES["gcn4-coil"].target_sequence_for_length(33)
    p = generate_puzzle("gcn4-coil", "hard", 7, _targets())
    positions = _breakers(p, native)
    assert {4, 11, 18, 25} <= set(positions)
    assert all(native[i] == "L" and p.starting_sequence[i] == "E" for i in positions)


def test_unprewarmed_target_and_bad_difficulty_raise():
    with pytest.raises(ValueError, match="not pre-warmed"):
        generate_puzzle("marqusee", "easy", 1, {})
    with pytest.raises(ValueError, match="doesn't support difficulty"):
        generate_puzzle("marqusee", "extreme", 1, _targets())


def test_legacy_marqusee_entry_point_accepts_length_keyed_targets():
    native = TEMPLATES["marqusee"].target_sequence_for_length(28)
    p = generate_marqusee_puzzle("easy", 5, {28: FakeFolder(native).target_pdb})
    assert p.id == "gen-marqusee-easy-5"


def test_validated_generation_fills_baseline_and_passes():
    native = TEMPLATES["marqusee"].target_sequence_for_length(28)
    folder = FakeFolder(native)
    puzzle, result = generate_validated_puzzle(
        "marqusee", "easy", {("marqusee", 28): folder.target_pdb}, folder,
        rng=random.Random(0),
    )
    assert result.passes, result.reason
    assert puzzle.baseline_rmsd == round(result.baseline_rmsd, 2) > 0
    assert puzzle.baseline_rmsd >= 2.5 * puzzle.expected_solved_rmsd


def test_validated_generation_with_failing_seed_raises():
    native = TEMPLATES["marqusee"].target_sequence_for_length(28)
    folder = FakeFolder(native, kink=0.5)  # too shallow to pass
    with pytest.raises(PuzzleGenerationError, match="did not validate"):
        generate_validated_puzzle(
            "marqusee", "easy", {("marqusee", 28): folder.target_pdb}, folder, seed=3,
        )


def test_queue_refills_and_pops():
    def predict(seq: str) -> tuple[str, float]:
        # Route each sequence to the folder for whichever template it came from.
        for tpl in TEMPLATES.values():
            for n in tpl.target_lengths():
                native = tpl.target_sequence_for_length(n)
                if len(seq) == len(native) and sum(a != b for a, b in zip(seq, native)) <= 9:
                    return FakeFolder(native)(seq)
        raise AssertionError(f"unexpected sequence {seq}")

    queue = PuzzleQueue(_targets(), predict, refill_max_attempts=2)
    assert queue.try_pop("marqusee", "easy") is None
    assert queue.depth_map()["marqusee"] == {"easy": 0, "medium": 0, "hard": 0}

    asyncio.run(queue.refill_one("marqusee", "easy"))
    assert queue.depth_map()["marqusee"]["easy"] == 1
    puzzle = queue.try_pop("marqusee", "easy")
    assert puzzle is not None and puzzle.id.startswith("gen-marqusee-easy-")
    assert queue.try_pop("marqusee", "easy") is None


def test_queue_refill_failure_leaves_slot_empty():
    def broken(seq: str) -> tuple[str, float]:
        raise RuntimeError("ESM Atlas down")

    queue = PuzzleQueue(_targets(), broken, refill_max_attempts=1)
    asyncio.run(queue.refill_one("gcn4-coil", "easy"))
    assert queue.depth_map()["gcn4-coil"]["easy"] == 0


def test_scheduled_refill_is_kept_alive_and_logs_crashes(caplog):
    queue = PuzzleQueue(_targets(), lambda seq: ("", 0.0))

    async def boom(template_id: str, difficulty: str) -> None:
        await asyncio.sleep(0)
        raise RuntimeError("lock exploded")

    queue.refill_one = boom  # type: ignore[method-assign]

    async def run() -> None:
        task = queue.schedule_refill("marqusee", "easy")
        assert task in queue._background_tasks  # strong ref while in flight
        await asyncio.gather(task, return_exceptions=True)
        await asyncio.sleep(0)  # let the done-callback run
        assert not queue._background_tasks

    with caplog.at_level("ERROR", logger="backend.services.puzzle_queue"):
        asyncio.run(run())
    assert "background refill crashed" in caplog.text
