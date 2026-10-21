import random

import numpy as np
import pytest
import requests

from backend.services import pdb_importer
from backend.services.esmfold_client import ESMFoldError
from backend.services.pdb_importer import (
    PdbImportError,
    _extract_auth_chains,
    _interior_helix_positions,
    _parse_fasta_for_chain,
    _pick_break_positions,
    detect_helix_residues,
    fetch_sequence_from_rcsb,
    import_pdb_puzzle,
    import_validated_pdb_puzzle,
)
from tests.helpers import FakeFolder, helix_ca, strand_ca

FASTA = """\
>1ENH_1|Chains A[auth A]|ENGRAILED HOMEODOMAIN|Drosophila melanogaster (7227)
RPRTAFSSEQLARLKREFNENRYLTERRRQQLS
SELGLNEAQKISRWPLQSVNATLKNH
>9XYZ_2|Chains B[auth C], D[auth E]|SOME PARTNER|Homo sapiens (9606)
MKVLAAGG
"""


@pytest.mark.parametrize(
    "header, chains",
    [
        ("1ENH_1|Chains A[auth A]|ENGRAILED|Fly", ["A"]),
        ("2ABC_1|Chains A, B|PROTEIN|Human", ["A", "B"]),
        ("3ABC_1|Chain A|PROTEIN|Human", ["A"]),
        ("4ABC_1|Chains A[auth B], C[auth D]|PROTEIN|Human", ["B", "D"]),
        ("5ABC_1|Chains A, B[auth C]|PROTEIN|Human", ["A", "C"]),
        ("6ABC_1|no chain field", []),
    ],
)
def test_extract_auth_chains(header, chains):
    assert _extract_auth_chains(header) == chains


def test_parse_fasta_joins_wrapped_sequence_lines():
    seq, desc = _parse_fasta_for_chain(FASTA, "A", "1ENH")
    assert seq == "RPRTAFSSEQLARLKREFNENRYLTERRRQQLSSELGLNEAQKISRWPLQSVNATLKNH"
    assert desc == "ENGRAILED HOMEODOMAIN"


def test_parse_fasta_finds_later_auth_chain_in_entity():
    assert _parse_fasta_for_chain(FASTA, "E", "9XYZ") == ("MKVLAAGG", "SOME PARTNER")


def test_parse_fasta_lists_available_chains_on_miss():
    with pytest.raises(ValueError, match="Available chains: A, C, E"):
        _parse_fasta_for_chain(FASTA, "Z", "1ENH")


class _Resp:
    def __init__(self, status: int, text: str = "") -> None:
        self.status_code = status
        self.text = text
        self.ok = 200 <= status < 300


def test_fetch_sequence_normalizes_ids(monkeypatch):
    seen = {}

    def fake_get(url, timeout):
        seen["url"] = url
        return _Resp(200, FASTA)

    monkeypatch.setattr(pdb_importer.requests, "get", fake_get)
    seq, _ = fetch_sequence_from_rcsb(" 1enh ", "a")
    assert seen["url"].endswith("/1ENH/download")
    assert seq.startswith("RPRTAF")


@pytest.mark.parametrize(
    "response, match",
    [
        (_Resp(404), "not found in RCSB"),
        (_Resp(500), "HTTP 500"),
        (requests.ConnectionError("offline"), "Could not reach RCSB"),
    ],
)
def test_fetch_sequence_errors_are_user_facing(monkeypatch, response, match):
    def fake_get(url, timeout):
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(pdb_importer.requests, "get", fake_get)
    with pytest.raises(ValueError, match=match):
        fetch_sequence_from_rcsb("1ENH")


def test_detect_helix_on_ideal_helix_and_strand():
    assert detect_helix_residues(helix_ca(20)) == list(range(20))
    assert detect_helix_residues(strand_ca(20)) == []


def test_detect_helix_finds_helix_flanked_by_strands():
    coords = np.vstack([strand_ca(8), helix_ca(12) + [40.0, 0, 0], strand_ca(8) + [80.0, 0, 0]])
    assert detect_helix_residues(coords) == list(range(8, 20))


def test_interior_positions_drop_two_residue_caps():
    assert _interior_helix_positions(list(range(5, 15))) == list(range(7, 13))
    assert _interior_helix_positions([1, 2, 3]) == []


def test_pick_break_positions_non_adjacent_and_seeded():
    interior = list(range(2, 30))
    a = _pick_break_positions(interior, 6, random.Random(9))
    assert a == _pick_break_positions(interior, 6, random.Random(9))
    assert len(a) == 6 and set(a) <= set(interior)
    assert all(y - x >= 2 for x, y in zip(a, a[1:]))
    with pytest.raises(ValueError, match="non-adjacent"):
        _pick_break_positions([4, 5, 6], 3, random.Random(0))


NATIVE = "MAEELLKKAEELLKKAEELLKKAEELLKKA"  # 30 aa, helical in the fake folder


@pytest.fixture
def fake_rcsb(monkeypatch):
    def install(seq: str = NATIVE, desc: str = "TEST HELIX PROTEIN") -> None:
        monkeypatch.setattr(pdb_importer, "fetch_sequence_from_rcsb", lambda pid, chain: (seq, desc))
    install()
    return install


def test_import_pdb_puzzle_builds_broken_helix(fake_rcsb):
    folder = FakeFolder(NATIVE)
    p = import_pdb_puzzle("1abc", "a", "medium", 42, folder)

    assert p.id == "pdb-1abca-medium-42"
    assert p.title == "1ABC · TEST HELIX PROTEIN"
    assert p.target_pdb == folder.target_pdb
    assert p.mutation_budget == 8
    assert p.expected_solved_rmsd == round(len(NATIVE) * 0.05, 2)
    breaks = [i for i, (a, b) in enumerate(zip(p.starting_sequence, NATIVE)) if a != b]
    assert 3 <= len(breaks) <= 6
    assert all(p.starting_sequence[i] in "PG" for i in breaks)
    assert all(2 <= i <= len(NATIVE) - 3 for i in breaks)  # helix caps untouched
    assert p.baseline_rmsd > 0


def test_import_replaces_nonstandard_residues(fake_rcsb):
    fake_rcsb(NATIVE[:-1] + "X")
    folder = FakeFolder(NATIVE[:-1] + "A")
    import_pdb_puzzle("1ABC", "A", "easy", 1, folder)
    assert folder.calls[0] == NATIVE[:-1] + "A"


@pytest.mark.parametrize(
    "seq, difficulty, status, match",
    [
        ("A" * 10, "easy", 400, "too short"),
        ("A" * 90, "easy", 400, "too long"),
        (NATIVE, "impossible", 400, "Unknown difficulty"),
    ],
)
def test_import_rejects_bad_input(fake_rcsb, seq, difficulty, status, match):
    fake_rcsb(seq)
    with pytest.raises(PdbImportError, match=match) as exc:
        import_pdb_puzzle("1ABC", "A", difficulty, 1, FakeFolder(seq))
    assert exc.value.status == status


def test_import_rejects_non_helical_protein(fake_rcsb):
    def strand_folder(seq):
        from tests.helpers import to_pdb
        return to_pdb(strand_ca(len(seq))), 0.0

    with pytest.raises(PdbImportError, match="Not enough helical content"):
        import_pdb_puzzle("1ABC", "A", "easy", 1, strand_folder)


def test_import_maps_fetch_and_fold_failures_to_status(monkeypatch):
    def not_found(pid, chain):
        raise ValueError("PDB entry '0000' not found in RCSB")

    monkeypatch.setattr(pdb_importer, "fetch_sequence_from_rcsb", not_found)
    with pytest.raises(PdbImportError) as exc:
        import_pdb_puzzle("0000", "A", "easy", 1, FakeFolder(NATIVE))
    assert exc.value.status == 404

    monkeypatch.setattr(pdb_importer, "fetch_sequence_from_rcsb", lambda p, c: (NATIVE, "X"))

    def flaky(seq):
        raise ESMFoldError("HTTP 503")

    with pytest.raises(PdbImportError, match="could not fold") as exc:
        import_pdb_puzzle("1ABC", "A", "easy", 1, flaky)
    assert exc.value.status == 502


def test_validated_import_passes_with_informative_gradient(fake_rcsb):
    folder = FakeFolder(NATIVE)
    puzzle, result = import_validated_pdb_puzzle(
        "1ABC", "A", "easy", folder, rng=random.Random(1),
    )
    assert result.passes, result.reason
    assert puzzle.id.startswith("pdb-1abca-easy-")


def test_validated_import_with_bad_seed_is_422(fake_rcsb):
    folder = FakeFolder(NATIVE, kink=0.5)
    with pytest.raises(PdbImportError, match="did not validate") as exc:
        import_validated_pdb_puzzle("1ABC", "A", "easy", folder, seed=7)
    assert exc.value.status == 422
