"""Synthetic structures and a fake ESMFold for offline tests."""

import numpy as np


def helix_ca(n: int) -> np.ndarray:
    """Ideal α-helix Cα trace: radius 2.3 Å, 100° and 1.5 Å rise per residue."""
    t = np.radians(100.0) * np.arange(n)
    return np.column_stack([2.3 * np.cos(t), 2.3 * np.sin(t), 1.5 * np.arange(n)])


def strand_ca(n: int) -> np.ndarray:
    """Extended chain: 3.8 Å Cα spacing along x with a slight zig-zag."""
    return np.column_stack([3.3 * np.arange(n), 1.0 * (np.arange(n) % 2), np.zeros(n)])


def to_pdb(coords: np.ndarray, plddt: float | list[float] = 0.9) -> str:
    """Render Cα coords as fixed-column PDB ATOM records (pLDDT in B-factor)."""
    n = len(coords)
    bs = [plddt] * n if isinstance(plddt, (int, float)) else list(plddt)
    lines = ["HEADER    SYNTHETIC TEST STRUCTURE"]
    for i, ((x, y, z), b) in enumerate(zip(coords, bs), start=1):
        # A backbone N before each CA so parsers must filter on atom name.
        lines.append(
            f"ATOM  {2 * i - 1:5d}  N   ALA A{i:4d}    "
            f"{x - 1.0:8.3f}{y:8.3f}{z:8.3f}{1.0:6.2f}{b:6.2f}           N"
        )
        lines.append(
            f"ATOM  {2 * i:5d}  CA  ALA A{i:4d}    "
            f"{x:8.3f}{y:8.3f}{z:8.3f}{1.0:6.2f}{b:6.2f}           C"
        )
    lines.append("END")
    return "\n".join(lines) + "\n"


class FakeFolder:
    """Deterministic stand-in for the cache-first ESMFold predict_fn.

    The native sequence folds onto an ideal helix. Each residue that differs
    from native is displaced ``kink`` Å (alternating ±x), so RMSD grows with
    the number of breakers and reverting any one of them lowers it.
    """

    def __init__(self, native: str, *, kink: float = 15.0, plddt: float = 0.9) -> None:
        self.native = native
        self.kink = kink
        self.plddt = plddt
        self.calls: list[str] = []
        self.target = helix_ca(len(native))
        self.target_pdb = to_pdb(self.target, plddt)

    def __call__(self, seq: str) -> tuple[str, float]:
        self.calls.append(seq)
        coords = self.target.copy()
        for i, (a, b) in enumerate(zip(seq, self.native)):
            if a != b:
                coords[i, 0] += self.kink if i % 2 else -self.kink
        return to_pdb(coords, self.plddt), 0.0
