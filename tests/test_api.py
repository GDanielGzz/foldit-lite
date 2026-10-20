"""Smoke tests for the FastAPI app with ESMFold and the LLM stubbed out."""

import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.config import settings
from backend.routers import predict as predict_router
from backend.routers import tutor as tutor_router
from backend.services.puzzles import load_puzzles
from backend.services.tutor import TutorResponse

PUZZLE1 = load_puzzles()["puzzle1"]


@pytest.fixture
def esm_calls(monkeypatch):
    """Every ESMFold call returns puzzle1's target; any call is recorded."""
    calls: list[str] = []

    def fake_predict_pdb(seq: str) -> tuple[str, float]:
        calls.append(seq)
        return PUZZLE1.target_pdb, 0.25

    monkeypatch.setattr(main, "predict_pdb", fake_predict_pdb)
    monkeypatch.setattr(predict_router, "predict_pdb", fake_predict_pdb)
    return calls


@pytest.fixture
def client(tmp_path, monkeypatch, esm_calls):
    monkeypatch.setattr(settings, "cache_db_path", tmp_path / "cache.db")

    # Simulate ESM Atlas being unreachable at startup: no template targets,
    # so no background queue refill fires during the tests.
    def no_prewarm(predict_fn):
        raise RuntimeError("offline")

    monkeypatch.setattr(main, "prewarm_targets", no_prewarm)
    with TestClient(main.app) as c:
        yield c


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["puzzles"] == 7
    assert body["cache_entries"] == 0
    assert body["templates_prewarmed"] == []
    assert body["queue_depth"]["marqusee"] == {"easy": 0, "medium": 0, "hard": 0}


def test_list_and_get_puzzles(client):
    puzzles = client.get("/puzzles").json()
    assert {p["id"] for p in puzzles} == {f"puzzle{i}" for i in range(1, 8)}
    assert all("target_pdb" not in p for p in puzzles)

    p1 = client.get("/puzzles/puzzle1").json()
    assert p1["starting_sequence"] == PUZZLE1.starting_sequence
    assert p1["generated"] is False and p1["seed"] is None

    assert client.get("/puzzles/nope").status_code == 404


def test_templates_route_is_not_shadowed_by_puzzle_id(client):
    templates = client.get("/puzzles/templates").json()
    assert {t["id"] for t in templates} == {"marqusee", "gb1-hairpin", "gcn4-coil"}
    marqusee = next(t for t in templates if t["id"] == "marqusee")
    assert marqusee["target_lengths"] == [28, 42, 56]


def test_generate_without_prewarmed_targets_is_503(client):
    resp = client.post("/puzzles/generate", json={"template": "marqusee"})
    assert resp.status_code == 503


@pytest.mark.parametrize(
    "payload, status",
    [
        ({"template": "nope"}, 400),
        ({"template": "marqusee", "difficulty": "extreme"}, 400),
    ],
)
def test_generate_rejects_bad_requests(client, payload, status):
    assert client.post("/puzzles/generate", json=payload).status_code == status


def test_from_pdb_rejects_unknown_difficulty(client):
    resp = client.post("/puzzles/from-pdb", json={"pdb_id": "1ENH", "difficulty": "extreme"})
    assert resp.status_code == 400


@pytest.mark.parametrize("seq", ["ACDXZ" * 3, "ACDE", "A" * 401])
def test_predict_validates_sequence(client, esm_calls, seq):
    assert client.post("/predict", json={"sequence": seq}).status_code == 422
    assert esm_calls == []


def test_predict_scores_and_caches(client, esm_calls):
    seq = PUZZLE1.starting_sequence
    payload = {"sequence": f" {seq.lower()} ", "score_against": "puzzle1"}

    first = client.post("/predict", json=payload).json()
    assert first["sequence"] == seq and first["length"] == len(seq)
    assert first["source"] == "esm_atlas" and first["elapsed_ms"] == 250
    assert len(first["plddt_per_residue"]) == len(seq)
    score = first["score"]
    assert score["rmsd"] == pytest.approx(0.0, abs=1e-2)
    assert score["baseline_rmsd"] == PUZZLE1.baseline_rmsd
    assert score["normalized"] == pytest.approx(100.0, abs=0.1)
    assert score["solved"] is True

    second = client.post("/predict", json=payload).json()
    assert second["source"] == "cache" and second["elapsed_ms"] == 0
    assert esm_calls == [seq]
    assert client.get("/health").json()["cache_entries"] == 1


def test_predict_against_unknown_or_mismatched_puzzle(client):
    seq = PUZZLE1.starting_sequence
    assert client.post("/predict", json={"sequence": seq, "score_against": "nope"}).status_code == 404
    # puzzle3's target has 20 residues; puzzle1's 42-residue prediction can't be scored.
    resp = client.post("/predict", json={"sequence": seq, "score_against": "puzzle3"})
    assert resp.status_code == 400
    assert "shape mismatch" in resp.json()["detail"]


def test_tutor_disabled_without_key(client):
    assert client.get("/tutor/status").json()["available"] is False
    resp = client.post("/tutor/explain", json={
        "puzzle_id": "puzzle1", "position": 3, "prev_aa": "P", "new_aa": "A",
    })
    assert resp.status_code == 503


def test_tutor_explain_with_stubbed_llm(client, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-test")
    seen = {}

    def fake_explain(ctx):
        seen["ctx"] = ctx
        return TutorResponse("Nice revert.", "claude-test", 10, 5, 0)

    monkeypatch.setattr(tutor_router, "explain_mutation", fake_explain)
    resp = client.post("/tutor/explain", json={
        "puzzle_id": "puzzle1", "position": 3, "prev_aa": "p", "new_aa": "a", "new_rmsd": 1.2,
    })
    assert resp.status_code == 200
    assert resp.json()["explanation"] == "Nice revert."
    assert seen["ctx"].puzzle_title == PUZZLE1.title
    assert (seen["ctx"].prev_aa, seen["ctx"].new_aa) == ("P", "A")

    resp = client.post("/tutor/explain", json={
        "puzzle_id": "nope", "position": 0, "prev_aa": "A", "new_aa": "G",
    })
    assert resp.status_code == 404
