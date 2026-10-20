from types import SimpleNamespace

import pytest

from backend.config import settings
from backend.services import tutor
from backend.services.tutor import MutationContext, _format_user_prompt, explain_mutation

CTX = MutationContext(
    puzzle_title="Rescue the Helix",
    puzzle_description="Restore the helix.",
    puzzle_hint=None,
    position=4,
    prev_aa="P",
    new_aa="A",
    prev_rmsd=6.5,
    new_rmsd=4.25,
    prev_plddt_mean=0.61,
    new_plddt_mean=None,
    prev_pos_plddt=0.4,
    new_pos_plddt=0.8,
)


def test_prompt_uses_one_indexed_position_and_signed_delta():
    prompt = _format_user_prompt(CTX)
    assert "Position 5: **P → A**" in prompt
    assert "RMSD: 6.500 Å → 4.250 Å (-2.25 Å)" in prompt
    assert "Mean pLDDT: 0.610 → n/a" in prompt
    assert "(none)" in prompt


def test_explain_requires_api_key():
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        explain_mutation(CTX)


def test_explain_parses_response_without_network(monkeypatch):
    sent = {}

    class FakeAnthropic:
        def __init__(self, api_key):
            sent["api_key"] = api_key
            self.messages = SimpleNamespace(create=self._create)

        def _create(self, **kwargs):
            sent.update(kwargs)
            return SimpleNamespace(
                model="claude-test",
                content=[
                    SimpleNamespace(type="text", text=" Reverting the Pro "),
                    SimpleNamespace(type="tool_use"),
                    SimpleNamespace(type="text", text="restored the helix."),
                ],
                usage=SimpleNamespace(
                    input_tokens=100, output_tokens=20,
                    cache_read_input_tokens=900, cache_creation_input_tokens=None,
                ),
            )

    monkeypatch.setattr(settings, "anthropic_api_key", "sk-test")
    monkeypatch.setattr(tutor, "Anthropic", FakeAnthropic)
    out = explain_mutation(CTX)

    assert sent["api_key"] == "sk-test"
    assert sent["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert sent["messages"][0]["content"] == _format_user_prompt(CTX)
    assert out.explanation == "Reverting the Pro restored the helix."
    assert (out.model, out.input_tokens, out.output_tokens, out.cached_tokens) == (
        "claude-test", 100, 20, 900,
    )
