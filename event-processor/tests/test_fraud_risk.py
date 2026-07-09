"""Tests for the fraud_risk.* handlers."""
import pytest

from billie_servicing.handlers.fraud import (
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

HALT_PAYLOAD = dict(ASSESSMENT_PAYLOAD)


class TestFraudRiskAssessment:
    @pytest.mark.asyncio
    async def test_medium_plus_writes_fraud_check(self, mock_pool):
        event = {"typ": "fraud_risk.assessment.v1", "usr": "CUST1", "conv": CONV,
                 "payload": dict(ASSESSMENT_PAYLOAD)}
        await handle_fraud_risk_assessment(mock_pool, event)
        updates = [c for c in mock_pool.calls_against("conversations")
                   if c.op == "UPDATE" and "assessments_fraud_check" in c.values]
        assert updates, "expected an assessments_fraud_check UPDATE"

    @pytest.mark.asyncio
    async def test_low_is_skipped(self, mock_pool):
        low = dict(ASSESSMENT_PAYLOAD, severity="LOW", final_score=5)
        event = {"typ": "fraud_risk.assessment.v1", "usr": "CUST1", "conv": CONV,
                 "payload": low}
        await handle_fraud_risk_assessment(mock_pool, event)
        updates = [c for c in mock_pool.calls_against("conversations")
                   if "assessments_fraud_check" in (c.values or {})]
        assert not updates, "LOW severity must not be persisted"


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
