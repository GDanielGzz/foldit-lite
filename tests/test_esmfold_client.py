import pytest
import requests

from backend.config import settings
from backend.services import esmfold_client
from backend.services.esmfold_client import ESMFoldError, predict_pdb


class _Resp:
    def __init__(self, status: int, text: str) -> None:
        self.status_code = status
        self.text = text


@pytest.fixture
def fake_post(monkeypatch):
    """Replace requests.post with a scripted sequence of responses; never hit the network."""
    sleeps: list[float] = []
    monkeypatch.setattr(esmfold_client.time, "sleep", sleeps.append)
    monkeypatch.setattr(settings, "max_retries", 3)
    monkeypatch.setattr(settings, "retry_base_delay_s", 1.0)

    def install(*responses):
        calls = []

        def post(url, data, headers, timeout):
            calls.append(data)
            r = responses[len(calls) - 1]
            if isinstance(r, Exception):
                raise r
            return r

        monkeypatch.setattr(esmfold_client.requests, "post", post)
        return calls, sleeps

    return install


def test_returns_pdb_text(fake_post):
    calls, sleeps = fake_post(_Resp(200, "HEADER x\nATOM ...\n"))
    pdb, elapsed = predict_pdb("ACDEFGHIKL")
    assert pdb.startswith("HEADER")
    assert elapsed >= 0
    assert calls == ["ACDEFGHIKL"]
    assert sleeps == []


def test_retries_transient_errors_with_backoff(fake_post):
    calls, sleeps = fake_post(
        _Resp(429, "slow down"),
        requests.ConnectionError("reset"),
        _Resp(200, "ATOM ok\n"),
    )
    pdb, _ = predict_pdb("ACDEFGHIKL")
    assert pdb == "ATOM ok\n"
    assert len(calls) == 3
    assert sleeps == [1.0, 2.0]


def test_gives_up_after_max_retries(fake_post):
    fake_post(*[_Resp(503, "busy")] * 3)
    with pytest.raises(ESMFoldError, match="All 3 attempts failed"):
        predict_pdb("ACDEFGHIKL")


@pytest.mark.parametrize(
    "resp, match",
    [
        (_Resp(400, "bad sequence"), "HTTP 400"),
        (_Resp(200, "<html>maintenance</html>"), "not a PDB"),
    ],
)
def test_non_retryable_failures_raise_immediately(fake_post, resp, match):
    calls, _ = fake_post(resp)
    with pytest.raises(ESMFoldError, match=match):
        predict_pdb("ACDEFGHIKL")
    assert len(calls) == 1
