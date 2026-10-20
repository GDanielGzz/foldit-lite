import pytest

from backend.config import settings


@pytest.fixture(autouse=True)
def _no_api_key(monkeypatch):
    """Keep tests independent of a developer's local .env."""
    monkeypatch.setattr(settings, "anthropic_api_key", "")
