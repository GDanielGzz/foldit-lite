"""SQLite-backed sequence -> PDB cache.

Sequence is the cache key. ESM Atlas appears deterministic per sequence
(verified by spike/check_determinism.py); this is safe to assume because
ESMFold runs deterministically from a single forward pass — no MSA, no
sampling. If that ever stops being true we'll see it as RMSD jitter on
identical sequences and can revisit.
"""

import logging
import sqlite3
from pathlib import Path

log = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS predictions (
    sequence    TEXT PRIMARY KEY,
    pdb         TEXT NOT NULL,
    plddt_mean  REAL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


class StructureCache:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(_SCHEMA)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def get(self, sequence: str) -> tuple[str, float | None] | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT pdb, plddt_mean FROM predictions WHERE sequence = ?",
                (sequence,),
            ).fetchone()
        if row is None:
            return None
        return row["pdb"], row["plddt_mean"]

    def put(self, sequence: str, pdb: str, plddt_mean: float | None) -> None:
        with self._conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO predictions (sequence, pdb, plddt_mean) VALUES (?, ?, ?)",
                (sequence, pdb, plddt_mean),
            )

    def size(self) -> int:
        with self._conn() as c:
            return c.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]


def per_residue_plddt_from_pdb(pdb: str) -> list[float]:
    """ESMFold writes per-residue pLDDT into the B-factor column of CA atoms.

    Scale: ESM Atlas returns pLDDT on a 0-1 scale (NOT the AlphaFold 0-100
    convention). 0.7+ ~ confident, 0.5-0.7 ~ low confidence, <0.5 ~ disordered
    or model unsure. Verified against poly-Ala (0.22), poly-Gly (0.46),
    Trp-cage (0.91), Marqusee helix (0.98).
    """
    vals: list[float] = []
    for line in pdb.splitlines():
        if line.startswith("ATOM") and line[12:16].strip() == "CA":
            try:
                vals.append(float(line[60:66]))
            except ValueError:
                continue
    return vals


def mean_plddt_from_pdb(pdb: str) -> float | None:
    vals = per_residue_plddt_from_pdb(pdb)
    if not vals:
        return None
    return sum(vals) / len(vals)
