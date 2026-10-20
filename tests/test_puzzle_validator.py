import pytest

from backend.services.puzzle_validator import validate_puzzle
from tests.helpers import FakeFolder

NATIVE = "AEAAAKA" * 4  # 28 aa


def _break(seq: str, positions: list[int]) -> str:
    s = list(seq)
    for p in positions:
        s[p] = "P"
    return "".join(s)


def _baseline(folder: FakeFolder, starter: str) -> float:
    from backend.services.scoring import score_pdb_against_target

    pdb, _ = folder(starter)
    folder.calls.clear()
    return score_pdb_against_target(pdb, folder.target_pdb)


def _run(folder: FakeFolder, starter: str, **overrides):
    kwargs = dict(
        starter_seq=starter,
        original_seq=NATIVE,
        target_pdb=folder.target_pdb,
        mutation_budget=6,
        expected_solved_rmsd=1.4,
        baseline_rmsd=_baseline(folder, starter),
        predict_fn=folder,
    )
    kwargs.update(overrides)
    return validate_puzzle(**kwargs)


def test_good_puzzle_passes_and_stops_early():
    folder = FakeFolder(NATIVE)
    starter = _break(NATIVE, [4, 10, 16, 22])
    result = _run(folder, starter)

    assert result.passes, result.reason
    assert result.endpoint_rmsd == pytest.approx(0.0, abs=1e-3)
    assert result.helpful_reverts == 2
    # One endpoint prediction + early exit after two helpful reverts.
    assert folder.calls[0] == NATIVE
    assert len(folder.calls) == 3
    assert all(p.helpful and p.delta_rmsd < 0 and p.from_aa == "P" for p in result.probes)
    assert result.summary().startswith("PASS")


@pytest.mark.parametrize(
    "starter, overrides, reason",
    [
        (NATIVE[:-1], {"baseline_rmsd": 5.0}, "length mismatch"),
        (NATIVE, {"baseline_rmsd": 5.0}, "no breakers"),
        (_break(NATIVE, [4, 10, 16, 22]), {"mutation_budget": 3}, "budget too tight"),
        (_break(NATIVE, [4, 10, 16, 22]), {"baseline_rmsd": 0.0}, "caller must compute"),
        (_break(NATIVE, [4, 10, 16, 22]), {"baseline_rmsd": 2.0}, "too close to target"),
    ],
)
def test_cheap_checks_reject_without_predicting(starter, overrides, reason):
    folder = FakeFolder(NATIVE)
    result = _run(folder, starter, **overrides)
    assert not result.passes
    assert reason in result.reason
    assert result.summary().startswith("REJECT")
    assert folder.calls == []


def test_unreachable_endpoint_is_rejected():
    folder = FakeFolder(NATIVE)
    starter = _break(NATIVE, [4, 10, 16, 22])
    # Score against a target the native sequence doesn't fold into.
    other = FakeFolder("G" * len(NATIVE))
    target_pdb, _ = other(_break("G" * len(NATIVE), [3, 9, 15]))
    result = _run(folder, starter, target_pdb=target_pdb)
    assert not result.passes
    assert "endpoint not winnable" in result.reason
    assert len(folder.calls) == 1


def test_low_confidence_endpoint_is_rejected():
    folder = FakeFolder(NATIVE, plddt=0.4)
    result = _run(folder, _break(NATIVE, [4, 10, 16, 22]))
    assert not result.passes
    assert "low confidence" in result.reason
    assert result.endpoint_plddt == pytest.approx(0.4)


def test_flat_gradient_is_rejected():
    # Tiny kinks: reverting a single breaker barely moves RMSD.
    folder = FakeFolder(NATIVE, kink=1.0)
    starter = _break(NATIVE, [4, 10, 16, 22])
    result = _run(folder, starter, expected_solved_rmsd=0.1)
    assert not result.passes
    assert "flat gradient" in result.reason
    assert result.total_reverts_tried == 4
    assert result.helpful_reverts == 0
