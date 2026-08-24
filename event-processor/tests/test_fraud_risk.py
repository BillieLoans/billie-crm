"""Tests for the fraud_risk.* handlers."""
import json

import pytest

from billie_servicing.handlers.fraud import (
    _SEVERITY_RANK,
    handle_fraud_risk_assessment,
    handle_fraud_risk_halt,
)

CONV = "7d5ee9c2-dd6b-4091-8a3a-6c148a4c4142"

ASSESSMENT_PAYLOAD = {
    "conversation_id": CONV,
    "application_number": "",
    "final_score": 70,
    "severity": "HIGH",
    "categories": ["PROMPT_INJECTION"],
    "rationale": "asked to ignore instructions",
    "signals": ["ignore all previous"],
    "would_halt": True,
    "mode": "shadow",
}

LOW_PAYLOAD = dict(ASSESSMENT_PAYLOAD, severity="LOW", final_score=5, would_halt=False)

HALT_PAYLOAD = dict(ASSESSMENT_PAYLOAD)

# Positional args of the atomic fold statement (see fraud._FOLD_SQL).
ARG_LATEST, ARG_SEVERITY, ARG_RANK, ARG_SCORE, ARG_FLAGGED, ARG_AT, ARG_CONV = range(7)


def _event(payload: dict) -> dict:
    return {
        "typ": "fraud_risk.assessment.v1",
        "usr": "CUST1",
        "conv": CONV,
        "payload": dict(payload),
    }


def _fold_calls(mock_pool):
    return [
        c
        for c in mock_pool.calls_against("conversations")
        if c.op == "UPDATE" and "assessments_fraud_check" in c.values
    ]


class TestFraudRiskAssessment:
    @pytest.mark.asyncio
    async def test_medium_plus_writes_fraud_check(self, mock_pool):
        await handle_fraud_risk_assessment(mock_pool, _event(ASSESSMENT_PAYLOAD))
        assert _fold_calls(mock_pool), "expected an assessments_fraud_check UPDATE"

    @pytest.mark.asyncio
    async def test_low_is_persisted(self, mock_pool):
        await handle_fraud_risk_assessment(mock_pool, _event(LOW_PAYLOAD))
        calls = _fold_calls(mock_pool)
        assert calls, "LOW assessments must be persisted"
        call = calls[0]
        assert call.args[ARG_SEVERITY] == "LOW"
        assert call.args[ARG_FLAGGED] == 0, "LOW must not increment flagged_count"

    @pytest.mark.asyncio
    async def test_medium_increments_flagged_count(self, mock_pool):
        medium = dict(ASSESSMENT_PAYLOAD, severity="MEDIUM", final_score=30)
        await handle_fraud_risk_assessment(mock_pool, _event(medium))
        call = _fold_calls(mock_pool)[0]
        assert call.args[ARG_FLAGGED] == 1
        assert "'flagged_count'" in call.sql
        assert "+ $5::int" in call.sql, "flagged_count must be incremented in SQL, not Python"

    @pytest.mark.asyncio
    async def test_turns_assessed_increments_in_sql(self, mock_pool):
        await handle_fraud_risk_assessment(mock_pool, _event(LOW_PAYLOAD))
        call = _fold_calls(mock_pool)[0]
        assert "'turns_assessed'" in call.sql
        assert "+ 1" in call.sql, "turns_assessed must be incremented in SQL, not Python"

    @pytest.mark.asyncio
    async def test_low_after_medium_cannot_downgrade_peak(self, mock_pool):
        """Peak arithmetic lives in SQL: rank-guarded severity + GREATEST score."""
        medium = dict(ASSESSMENT_PAYLOAD, severity="MEDIUM", final_score=30)
        await handle_fraud_risk_assessment(mock_pool, _event(medium))
        await handle_fraud_risk_assessment(mock_pool, _event(LOW_PAYLOAD))
        medium_call, low_call = _fold_calls(mock_pool)
        # The stored peak only changes when the incoming rank beats the stored one …
        assert "'peak_severity', CASE WHEN $3::int >=" in low_call.sql
        assert "GREATEST($4::int" in low_call.sql
        # … and LOW ranks strictly below MEDIUM, so it can never win.
        assert low_call.args[ARG_RANK] < medium_call.args[ARG_RANK]
        ranks = [_SEVERITY_RANK[s] for s in ("LOW", "MEDIUM", "HIGH", "CRITICAL")]
        assert ranks == sorted(ranks) and len(set(ranks)) == 4

    @pytest.mark.asyncio
    async def test_legacy_flat_row_folds_as_single_flagged_turn(self, mock_pool):
        await handle_fraud_risk_assessment(mock_pool, _event(LOW_PAYLOAD))
        call = _fold_calls(mock_pool)[0]
        # Rows without peak_severity (legacy flat FraudRiskDecision) are
        # normalised in SQL to {latest, peak_severity, peak_score, 1 turn, 1 flagged}.
        assert "? 'peak_severity'" in call.sql
        assert "'latest', assessments_fraud_check" in call.sql
        assert "'peak_severity', assessments_fraud_check->>'severity'" in call.sql
        assert "'turns_assessed', 1" in call.sql
        assert "'flagged_count', 1" in call.sql

    @pytest.mark.asyncio
    async def test_latest_payload_is_dollar_stripped_json(self, mock_pool):
        dirty = dict(LOW_PAYLOAD)
        dirty["$inject"] = "nope"
        await handle_fraud_risk_assessment(mock_pool, _event(dirty))
        call = _fold_calls(mock_pool)[0]
        latest = json.loads(call.args[ARG_LATEST])
        assert "$inject" not in latest
        assert latest["severity"] == "LOW"
        assert latest["final_score"] == 5

    @pytest.mark.asyncio
    async def test_missing_conversation_id_skips(self, mock_pool):
        payload = dict(LOW_PAYLOAD)
        payload.pop("conversation_id")
        event = {"typ": "fraud_risk.assessment.v1", "usr": "CUST1", "payload": payload}
        await handle_fraud_risk_assessment(mock_pool, event)
        assert not mock_pool.calls

    @pytest.mark.asyncio
    async def test_update_only_single_atomic_statement(self, mock_pool):
        """No conversation INSERT and no SELECT-then-UPDATE — one atomic UPDATE."""
        await handle_fraud_risk_assessment(mock_pool, _event(LOW_PAYLOAD))
        assert len(mock_pool.calls) == 1
        call = mock_pool.calls[0]
        assert call.op == "UPDATE"
        assert call.table == "conversations"
        assert call.where.get("conversation_id") == CONV

    @pytest.mark.asyncio
    async def test_bumps_version_and_updated_at(self, mock_pool):
        await handle_fraud_risk_assessment(mock_pool, _event(LOW_PAYLOAD))
        call = _fold_calls(mock_pool)[0]
        assert "version = COALESCE(version, 1) + 1" in call.sql
        assert "updated_at" in call.values


class TestFraudRiskHalt:
    @pytest.mark.asyncio
    async def test_sets_customer_fraud_risk_active(self, mock_pool):
        event = {"typ": "fraud_risk.halt.v1", "usr": "CUST1", "conv": CONV,
                 "payload": dict(HALT_PAYLOAD)}
        await handle_fraud_risk_halt(mock_pool, event)
        doc = mock_pool.last_upsert("customers")
        assert doc is not None
        assert doc["customer_id"] == "CUST1"
        assert doc["fraud_risk_active"] is True
        assert doc["fraud_risk_severity"] == "HIGH"

    @pytest.mark.asyncio
    async def test_halt_writes_score_categories_and_flagged_at(self, mock_pool):
        event = {"typ": "fraud_risk.halt.v1", "usr": "CUST1", "conv": CONV,
                 "payload": dict(HALT_PAYLOAD)}
        await handle_fraud_risk_halt(mock_pool, event)
        doc = mock_pool.last_upsert("customers")
        assert doc["fraud_risk_score"] == 70
        assert "PROMPT_INJECTION" in str(doc["fraud_risk_categories"])
        assert doc["fraud_risk_flagged_at"] is not None

    @pytest.mark.asyncio
    async def test_halt_without_customer_id_makes_no_mirror(self, mock_pool):
        # No usr and no customer_id → no resolvable customer → no junk row.
        event = {"typ": "fraud_risk.halt.v1", "conv": CONV, "payload": dict(HALT_PAYLOAD)}
        await handle_fraud_risk_halt(mock_pool, event)
        assert mock_pool.last_upsert("customers") is None
