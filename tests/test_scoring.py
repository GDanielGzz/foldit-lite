import numpy as np
import pytest

from backend.services.scoring import ca_coords_from_pdb, kabsch_rmsd, score_pdb_against_target
from tests.helpers import helix_ca, to_pdb


def _rotation(axis: np.ndarray, angle: float) -> np.ndarray:
    axis = axis / np.linalg.norm(axis)
    k = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + np.sin(angle) * k + (1 - np.cos(angle)) * k @ k


def test_ca_coords_reads_only_ca_atom_records():
    coords = helix_ca(5)
    pdb = to_pdb(coords) + "HETATM 9999  CA  CA  A 999       1.000   2.000   3.000  1.00  0.00\n"
    out = ca_coords_from_pdb(pdb)
    assert out.shape == (5, 3)
    assert out.dtype == np.float32
    np.testing.assert_allclose(out, coords, atol=1e-3)


def test_ca_coords_skips_malformed_coordinates():
    good = to_pdb(helix_ca(3)).splitlines()
    bad = good[2][:30] + "   nan?? " + good[2][39:]
    out = ca_coords_from_pdb("\n".join([good[0], bad, *good[3:]]))
    assert out.shape == (2, 3)


def test_rmsd_is_zero_for_identical_structures():
    a = helix_ca(20)
    assert kabsch_rmsd(a, a) == pytest.approx(0.0, abs=1e-6)


def test_rmsd_is_invariant_to_rigid_motion():
    a = helix_ca(20)
    b = a @ _rotation(np.array([1.0, 2.0, 3.0]), 1.1).T + np.array([10.0, -4.0, 7.5])
    assert kabsch_rmsd(a, b) == pytest.approx(0.0, abs=1e-6)
    assert kabsch_rmsd(b, a) == pytest.approx(0.0, abs=1e-6)


def test_rmsd_does_not_allow_reflection():
    # A mirror image of a helix has the opposite handedness; a proper rotation
    # can't superimpose it, so RMSD must stay well above zero.
    a = helix_ca(20)
    mirrored = a * np.array([1.0, 1.0, -1.0])
    assert kabsch_rmsd(a, mirrored) > 1.0


def test_rmsd_matches_known_displacement():
    # Moving one of N atoms by d gives RMSD <= d / sqrt(N) after alignment;
    # with a large N the alignment barely helps, so it's close to that bound.
    n, d = 40, 10.0
    a = helix_ca(n)
    b = a.copy()
    b[n // 2, 0] += d
    rmsd = kabsch_rmsd(a, b)
    assert rmsd <= d / np.sqrt(n) + 1e-6
    assert rmsd > 0.9 * d * np.sqrt((n - 1) / n) / np.sqrt(n)


@pytest.mark.parametrize(
    "a, b, match",
    [
        (np.zeros((4, 3)), np.zeros((5, 3)), "shape mismatch"),
        (np.zeros((2, 3)), np.zeros((2, 3)), "at least 3"),
    ],
)
def test_rmsd_rejects_bad_input(a, b, match):
    with pytest.raises(ValueError, match=match):
        kabsch_rmsd(a, b)


def test_score_pdb_against_target_end_to_end():
    a = helix_ca(12)
    moved = a @ _rotation(np.array([0.0, 1.0, 0.0]), 0.7).T + 3.0
    assert score_pdb_against_target(to_pdb(moved), to_pdb(a)) == pytest.approx(0.0, abs=1e-2)
