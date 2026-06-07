"""Puzzle catalog loader. Reads puzzles.json + corresponding target PDBs once at startup."""

import json
from dataclasses import dataclass
from pathlib import Path

from backend.config import settings


@dataclass(frozen=True)
class Puzzle:
    id: str
    title: str
    description: str
    starting_sequence: str
    target_pdb: str
    mutation_budget: int
    baseline_rmsd: float
    expected_solved_rmsd: float
    hint: str | None
    difficulty: str


def load_puzzles() -> dict[str, Puzzle]:
    catalog_path = settings.data_dir / "puzzles.json"
    targets_dir = settings.data_dir / "targets"

    raw = json.loads(catalog_path.read_text(encoding="utf-8"))
    out: dict[str, Puzzle] = {}
    for pid, entry in raw.items():
        target_path = targets_dir / entry["target_pdb_file"]
        if not target_path.exists():
            raise FileNotFoundError(f"Puzzle {pid!r} references missing target PDB: {target_path}")
        out[pid] = Puzzle(
            id=entry["id"],
            title=entry["title"],
            description=entry["description"],
            starting_sequence=entry["starting_sequence"].upper(),
            target_pdb=target_path.read_text(encoding="utf-8"),
            mutation_budget=int(entry["mutation_budget"]),
            baseline_rmsd=float(entry["baseline_rmsd"]),
            expected_solved_rmsd=float(entry["expected_solved_rmsd"]),
            hint=entry.get("hint"),
            difficulty=entry.get("difficulty", "medium"),
        )
    return out
