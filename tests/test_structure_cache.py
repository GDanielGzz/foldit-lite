import gc

import pytest

from backend.services.structure_cache import (
    StructureCache,
    mean_plddt_from_pdb,
    per_residue_plddt_from_pdb,
)
from tests.helpers import helix_ca, to_pdb


def test_cache_roundtrip_and_size(tmp_path):
    cache = StructureCache(tmp_path / "nested" / "cache.db")
    assert cache.size() == 0
    assert cache.get("ACDE") is None

    cache.put("ACDE", "PDB-1", 0.81)
    assert cache.get("ACDE") == ("PDB-1", pytest.approx(0.81))
    assert cache.size() == 1


def test_cache_put_replaces_existing_entry(tmp_path):
    cache = StructureCache(tmp_path / "cache.db")
    cache.put("ACDE", "old", 0.5)
    cache.put("ACDE", "new", None)
    assert cache.get("ACDE") == ("new", None)
    assert cache.size() == 1


def test_cache_persists_across_instances(tmp_path):
    path = tmp_path / "cache.db"
    StructureCache(path).put("MKV", "PDB", 0.9)
    assert StructureCache(path).get("MKV") == ("PDB", pytest.approx(0.9))


@pytest.mark.filterwarnings("error")
def test_cache_closes_connections(tmp_path):
    # sqlite3's own context manager only commits; a connection that is never
    # closed surfaces as an "unclosed database" ResourceWarning on collection.
    cache = StructureCache(tmp_path / "cache.db")
    cache.put("AAA", "PDB", None)
    cache.get("AAA")
    cache.size()
    del cache
    gc.collect()


def test_plddt_parsed_from_ca_bfactor_only():
    pdb = to_pdb(helix_ca(3), [0.5, 0.75, 1.0])
    assert per_residue_plddt_from_pdb(pdb) == pytest.approx([0.5, 0.75, 1.0])
    assert mean_plddt_from_pdb(pdb) == pytest.approx(0.75)


def test_mean_plddt_is_none_without_atoms():
    assert mean_plddt_from_pdb("HEADER nothing here\nEND\n") is None
