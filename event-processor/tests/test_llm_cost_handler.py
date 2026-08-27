"""BTB-302 — llm_logs → CRM cost projection.

The consumer projects ONLY numeric fields and ids into the cost store —
``system_prompt``, ``non_system_context``, ``llm_response_text``,
``response_format`` and ``tools`` are dropped at ingest (no customer PII in
the CRM cost store). Cost is stored BOTH ways: the logged figure and a
recomputed figure from tokens × the versioned rate table, stamped with the
rate version in force — so history never silently restates when rates
change, and divergence between the two is cheap ongoing assurance.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from billie_servicing.handlers.llm_cost import handle_llm_log
from billie_servicing.llm_rates import RATE_VERSION, recompute_cost


# ── rate maths (ported from backend/tools/llm_cost/llm_cost_report.py) ───────


def test_standard_tier_cost_with_cached_netting() -> None:
    """prompt_tokens INCLUDES cached tokens: uncached = prompt - cached."""
    cost, priced = recompute_cost(
        "gpt-5.6-luna", "eligibilityAgent", 10_000, 500, 4_000
    )
    assert priced
    assert cost == pytest.approx(6_000 * 2e-07 + 4_000 * 2e-08 + 500 * 1.2e-06)


def test_priority_agent_uses_priority_rates() -> None:
    cost, priced = recompute_cost(
        "gpt-5.6-luna", "customerLiaisonAgent", 10_000, 500, 0
    )
    assert priced
    assert cost == pytest.approx(10_000 * 4e-07 + 500 * 2.4e-06)


def test_logged_service_tier_beats_agent_derivation() -> None:
    """service_tier on the row wins over the config-derived agent list."""
    cost, _ = recompute_cost(
        "gpt-5.6-luna", "customerLiaisonAgent", 10_000, 500, 0,
        service_tier="standard",
    )
    assert cost == pytest.approx(10_000 * 2e-07 + 500 * 1.2e-06)


def test_long_context_rates_above_threshold() -> None:
    cost, _ = recompute_cost("gpt-5.6-luna", "eligibilityAgent", 300_000, 100, 0)
    assert cost == pytest.approx(300_000 * 4e-07 + 100 * 1.8e-06)


def test_unknown_model_is_unpriced_never_zero_costed_silently() -> None:
    """A model missing from the table must surface as unpriced — never be
    silently costed at zero (the exact failure mode BTB-301 caught)."""
    cost, priced = recompute_cost("gpt-9-unknown", "eligibilityAgent", 1000, 100, 0)
    assert not priced
    assert cost == 0.0


def test_dated_model_snapshot_prefix_matches() -> None:
    _, priced = recompute_cost(
        "gpt-5.6-luna-2026-01-01", "eligibilityAgent", 1000, 100, 0
    )
    assert priced


def test_cached_tokens_clamped_to_prompt() -> None:
    cost, _ = recompute_cost("gpt-5.6-luna", "eligibilityAgent", 1_000, 0, 5_000)
    assert cost == pytest.approx(1_000 * 2e-08)


def test_rate_version_is_stamped() -> None:
    assert isinstance(RATE_VERSION, str) and RATE_VERSION


# ── handler: projection, PII strip, rollup, idempotency ──────────────────────

_PII_VALUES = {
    "system_prompt": "You are Billie… customer name Jane Citizen",
    "non_system_context": '[{"role":"user","content":"my TFN is 123"}]',
    "llm_response_text": "Sure Jane, your loan…",
    "response_format": "{...schema...}",
    "tools": "[{...}]",
}


def _fields(**over) -> dict:
    base = {
        "model": "gpt-5.6-luna",
        "provider": "litellm",
        "agent_name": "customerLiaisonAgent",
        "total_tokens": "10500",
        "prompt_tokens": "10000",
        "completion_tokens": "500",
        "cached_tokens": "4000",
        "reasoning_tokens": "0",
        "llm_cost": "0.00299",
        "response_time_ms": "1834",
        "conversation_id": "conv-llm-1",
        "seq": "12",
        **_PII_VALUES,
    }
    base.update(over)
    return base


def _cost_inserts(mock_pool):
    return [
        c for c in mock_pool.calls_against("llm_costs") if c.op == "INSERT"
    ]


class TestLlmCostProjection:
    @pytest.mark.asyncio
    async def test_projects_numeric_fields_keyed_by_stream_id(self, mock_pool):
        await handle_llm_log(mock_pool, "1756260000000-0", _fields())

        (ins,) = _cost_inserts(mock_pool)
        assert ins.conflict_columns == ["stream_id"]
        v = ins.values
        assert v["stream_id"] == "1756260000000-0"
        assert v["conversation_id"] == "conv-llm-1"
        assert v["model"] == "gpt-5.6-luna"
        assert v["agent_name"] == "customerLiaisonAgent"
        assert v["prompt_tokens"] == 10000
        assert v["completion_tokens"] == 500
        assert v["cached_tokens"] == 4000
        assert v["logged_cost_usd"] == pytest.approx(0.00299)
        # priority agent → recomputed at priority rates
        assert v["computed_cost_usd"] == pytest.approx(
            6_000 * 4e-07 + 4_000 * 4e-08 + 500 * 2.4e-06
        )
        assert v["priced"] is True
        assert v["rate_version"] == RATE_VERSION

    @pytest.mark.asyncio
    async def test_no_pii_reaches_the_cost_store(self, mock_pool):
        await handle_llm_log(mock_pool, "1756260000000-0", _fields())

        pii_texts = set(_PII_VALUES.values())
        for call in mock_pool.connection.calls:
            for col, val in call.values.items():
                assert col not in _PII_VALUES, f"PII column {col} projected"
                assert val not in pii_texts, f"PII text leaked via {col}"

    @pytest.mark.asyncio
    async def test_rolls_cost_up_onto_the_conversation(self, mock_pool):
        await handle_llm_log(mock_pool, "1756260000000-0", _fields())

        rollups = [
            c
            for c in mock_pool.calls_against("conversations")
            if c.op == "UPDATE" and "llm_cost_total_usd" in c.sql
        ]
        assert len(rollups) == 1
        assert "llm_call_count" in rollups[0].sql
        assert "conv-llm-1" in rollups[0].args

    @pytest.mark.asyncio
    async def test_duplicate_stream_id_does_not_double_count(self, mock_pool):
        """At-least-once redelivery: when the llm_costs insert hits the
        ON CONFLICT DO NOTHING path, the conversation rollup must not be
        incremented again."""
        orig = mock_pool.connection._record_execute

        async def _dup(sql: str, *args):
            await orig(sql, *args)
            return "INSERT 0 0"

        mock_pool.connection.execute = AsyncMock(side_effect=_dup)
        mock_pool.execute = mock_pool.connection.execute

        await handle_llm_log(mock_pool, "1756260000000-0", _fields())

        rollups = [
            c
            for c in mock_pool.calls_against("conversations")
            if c.op == "UPDATE" and "llm_cost_total_usd" in c.sql
        ]
        assert rollups == []

    @pytest.mark.asyncio
    async def test_unpriced_model_recorded_and_counted(self, mock_pool):
        await handle_llm_log(
            mock_pool, "1756260000000-0", _fields(model="gpt-9-unknown")
        )
        (ins,) = _cost_inserts(mock_pool)
        assert ins.values["priced"] is False
        assert ins.values["computed_cost_usd"] == 0.0
        rollups = [
            c
            for c in mock_pool.calls_against("conversations")
            if c.op == "UPDATE" and "llm_unpriced_count" in c.sql
        ]
        assert len(rollups) == 1

    @pytest.mark.asyncio
    async def test_row_without_conversation_id_still_projected(self, mock_pool):
        """Pre-context rows (prewarm etc.) carry no conversation_id — the
        cost row lands, no conversation rollup is attempted."""
        f = _fields()
        del f["conversation_id"]
        del f["seq"]
        await handle_llm_log(mock_pool, "1756260000000-0", f)

        (ins,) = _cost_inserts(mock_pool)
        assert ins.values["conversation_id"] is None
        assert mock_pool.calls_against("conversations") == []

    @pytest.mark.asyncio
    async def test_called_at_derives_from_stream_id_ms(self, mock_pool):
        from datetime import datetime, timezone

        await handle_llm_log(mock_pool, "1756260000000-0", _fields())
        (ins,) = _cost_inserts(mock_pool)
        called_at = ins.values["called_at"]
        assert called_at == datetime.fromtimestamp(
            1756260000, tz=timezone.utc
        )
