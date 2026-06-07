"""Cα RMSD via Kabsch alignment.

Pure numpy. Requires both structures to have the same number of CA atoms;
puzzles assume length-preserving mutations only.
"""

import numpy as np


def ca_coords_from_pdb(pdb: str) -> np.ndarray:
    """Extract Cα xyz as an (N, 3) float32 array, in residue order."""
    coords: list[tuple[float, float, float]] = []
    for line in pdb.splitlines():
        if not line.startswith("ATOM"):
            continue
        if line[12:16].strip() != "CA":
            continue
        try:
            x = float(line[30:38])
            y = float(line[38:46])
            z = float(line[46:54])
        except ValueError:
            continue
        coords.append((x, y, z))
    return np.asarray(coords, dtype=np.float32)


def kabsch_rmsd(a: np.ndarray, b: np.ndarray) -> float:
    """Cα RMSD between two (N, 3) arrays after optimal rigid alignment."""
    if a.shape != b.shape:
        raise ValueError(f"shape mismatch: {a.shape} vs {b.shape}")
    if a.shape[0] < 3:
        raise ValueError(f"need at least 3 atoms, got {a.shape[0]}")

    a_c = a - a.mean(axis=0)
    b_c = b - b.mean(axis=0)

    h = a_c.T @ b_c
    u, _, vt = np.linalg.svd(h)
    # Correct for improper rotation (reflection).
    d = np.sign(np.linalg.det(vt.T @ u.T))
    correction = np.diag([1.0, 1.0, d])
    rotation = vt.T @ correction @ u.T

    a_rot = a_c @ rotation.T
    diff = a_rot - b_c
    return float(np.sqrt(np.mean(np.sum(diff * diff, axis=1))))


def score_pdb_against_target(prediction_pdb: str, target_pdb: str) -> float:
    """Top-level: returns Cα RMSD in Å."""
    a = ca_coords_from_pdb(prediction_pdb)
    b = ca_coords_from_pdb(target_pdb)
    return kabsch_rmsd(a, b)
