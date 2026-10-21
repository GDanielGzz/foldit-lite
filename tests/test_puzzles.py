import json

import pytest

from backend.config import settings
from backend.services.puzzles import load_puzzles
from backend.services.scoring import ca_coords_from_pdb, kabsch_rmsd
from backend.services.structure_cache import mean_plddt_from_pdb

VALID_AA = set("ACDEFGHIKLMNPQRSTVWY")
PUZZLES = load_puzzles()


def test_catalog_loads_every_entry():
    raw = json.loads((settings.data_dir / "puzzles.json").read_text(encoding="utf-8"))
    assert set(PUZZLES) == set(raw)
    assert len(PUZZLES) == 7


@pytest.mark.parametrize("pid", sorted(PUZZLES))
def test_puzzle_is_consistent(pid):
    p = PUZZLES[pid]
    assert p.id == pid
    assert set(p.starting_sequence) <= VALID_AA
    assert p.difficulty in {"easy", "medium", "hard"}
    assert p.mutation_budget > 0
    # Descent room: the starter must be worse than the solved threshold.
    assert p.baseline_rmsd > p.expected_solved_rmsd > 0


@pytest.mark.parametrize("pid", sorted(PUZZLES))
def test_target_backbone_matches_sequence_length(pid):
    # Scoring requires one Cα per residue — mutations are length-preserving,
    # so a target with a different residue count could never be scored.
    p = PUZZLES[pid]
    ca = ca_coords_from_pdb(p.target_pdb)
    assert ca.shape == (len(p.starting_sequence), 3)
    assert kabsch_rmsd(ca, ca) == pytest.approx(0.0, abs=1e-5)
    plddt = mean_plddt_from_pdb(p.target_pdb)
    assert plddt is not None and 0.0 < plddt <= 1.0


def test_missing_target_pdb_is_reported(tmp_path, monkeypatch):
    (tmp_path / "targets").mkdir()
    (tmp_path / "puzzles.json").write_text(json.dumps({
        "p": {
            "id": "p", "title": "t", "description": "d",
            "starting_sequence": "acdefghikl", "target_pdb_file": "nope.pdb",
            "mutation_budget": 3, "baseline_rmsd": 5, "expected_solved_rmsd": 1,
        }
    }), encoding="utf-8")
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    with pytest.raises(FileNotFoundError, match="nope.pdb"):
        load_puzzles()


def test_optional_fields_default_and_sequence_is_uppercased(tmp_path, monkeypatch):
    (tmp_path / "targets").mkdir()
    (tmp_path / "targets" / "t.pdb").write_text("END\n", encoding="utf-8")
    (tmp_path / "puzzles.json").write_text(json.dumps({
        "p": {
            "id": "p", "title": "t", "description": "d",
            "starting_sequence": "acdefghikl", "target_pdb_file": "t.pdb",
            "mutation_budget": "3", "baseline_rmsd": "5.5", "expected_solved_rmsd": 1,
        }
    }), encoding="utf-8")
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    p = load_puzzles()["p"]
    assert p.starting_sequence == "ACDEFGHIKL"
    assert p.mutation_budget == 3 and p.baseline_rmsd == 5.5
    assert p.hint is None and p.difficulty == "medium"
