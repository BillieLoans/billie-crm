"""Unit tests for credit assessment & post-identity event handlers."""

import json

import pytest

from billie_servicing.handlers.conversation import (
    handle_assessment,
    handle_credit_assessment_complete,
    handle_post_identity_risk_check,
)


def _last_assessment_json(mock_pool, column: str) -> dict:
    """Return the JSON merged into ``conversations.<column>`` on the most
    recent UPDATE. Handlers serialize the assessment dict with json.dumps so
    the recorded UPDATE arg is a JSON string."""
    updates = [
        c for c in mock_pool.calls_against("conversations")
        if c.op == "UPDATE" and column in c.values
    ]
    assert updates, f"expected an UPDATE on conversations setting {column}"
    raw = updates[-1].values[column]
    return json.loads(raw) if isinstance(raw, str) else raw


def _conversation_id_where(mock_pool) -> str:
    updates = [c for c in mock_pool.calls_against("conversations") if c.op == "UPDATE"]
    assert updates
    return updates[-1].where.get("conversation_id")


class TestAccountConductAssessmentHandler:
    @pytest.mark.asyncio
    async def test_stores_s3_key_and_decision(self, mock_pool):
        event = {
            "cid": "conv-ac-001",
            "msg_type": "credit_assessment_accountConduct_result",
            "payload": {"s3Key": "bucket/path/to/report.json", "decision": "PASS"},
        }
        await handle_assessment(mock_pool, event)

        data = _last_assessment_json(mock_pool, "assessments_account_conduct")
        assert data["s3Key"] == "bucket/path/to/report.json"
        assert data["decision"] == "PASS"
        assert _conversation_id_where(mock_pool) == "conv-ac-001"

    @pytest.mark.asyncio
    async def test_upserts_missing_document(self, mock_pool):
        # _set_assessment always _ensure_conversation_exists first → INSERT
        # … ON CONFLICT DO NOTHING on conversations.
        event = {
            "cid": "brand-new-conv",
            "msg_type": "credit_assessment_accountConduct_result",
            "payload": {"decision": "FAIL"},
        }
        await handle_assessment(mock_pool, event)

        inserts = [c for c in mock_pool.calls_against("conversations") if c.op == "INSERT"]
        assert inserts and inserts[0].conflict_columns == ["conversation_id"]

    @pytest.mark.asyncio
    async def test_serviceability_still_works(self, mock_pool):
        event = {
            "cid": "conv-svc-001",
            "msg_type": "credit_assessment_serviceability_result",
            "payload": {"s3Key": "bucket/svc/report.json", "decision": "PASS", "surplus": 3000},
        }
        await handle_assessment(mock_pool, event)

        data = _last_assessment_json(mock_pool, "assessments_serviceability")
        assert data["s3Key"] == "bucket/svc/report.json"
        assert data["decision"] == "PASS"


class TestPostIdentityRiskCheckHandler:
    @pytest.mark.asyncio
    async def test_stores_risk_data_from_payload(self, mock_pool):
        event = {
            "cid": "conv-pir-001",
            "payload": {"riskLevel": "low", "score": 85, "flags": []},
        }
        await handle_post_identity_risk_check(mock_pool, event)

        data = _last_assessment_json(mock_pool, "assessments_post_identity_risk")
        assert data["riskLevel"] == "low"
        assert data["score"] == 85
        assert _conversation_id_where(mock_pool) == "conv-pir-001"

    @pytest.mark.asyncio
    async def test_strips_dollar_keys(self, mock_pool):
        event = {
            "cid": "conv-pir-002",
            "payload": {"riskLevel": "medium", "$injected": "bad_value"},
        }
        await handle_post_identity_risk_check(mock_pool, event)

        data = _last_assessment_json(mock_pool, "assessments_post_identity_risk")
        assert "$injected" not in data
        assert data["riskLevel"] == "medium"

    @pytest.mark.asyncio
    async def test_fallback_to_event_when_no_payload(self, mock_pool):
        # The handler uses `event.get("payload", {})` which yields an empty
        # dict — no exception, no riskLevel carried over (the original Mongo
        # test was a tautology that always passed). What we *can* verify is
        # that the handler still ran and emitted the UPDATE against the
        # assessment column without erroring.
        event = {"cid": "conv-pir-003", "riskLevel": "high"}
        await handle_post_identity_risk_check(mock_pool, event)

        data = _last_assessment_json(mock_pool, "assessments_post_identity_risk")
        assert data == {}

    @pytest.mark.asyncio
    async def test_ensures_conversation_row(self, mock_pool):
        event = {"cid": "conv-pir-001", "payload": {"riskLevel": "low"}}
        await handle_post_identity_risk_check(mock_pool, event)
        inserts = [c for c in mock_pool.calls_against("conversations") if c.op == "INSERT"]
        assert inserts and inserts[0].conflict_columns == ["conversation_id"]

    @pytest.mark.asyncio
    async def test_conv_fallback(self, mock_pool):
        event = {"conv": "conv-via-conv-field", "payload": {"riskLevel": "low"}}
        await handle_post_identity_risk_check(mock_pool, event)
        assert _conversation_id_where(mock_pool) == "conv-via-conv-field"

    @pytest.mark.asyncio
    async def test_out_of_order_creates_doc(self, mock_pool):
        event = {"cid": "new-conv", "payload": {"riskLevel": "low"}}
        await handle_post_identity_risk_check(mock_pool, event)
        # DO NOTHING insert + jsonb update = guaranteed to land for new conv.
        inserts = [c for c in mock_pool.calls_against("conversations") if c.op == "INSERT"]
        assert inserts and "DO NOTHING" in inserts[0].sql.upper()


class TestCreditAssessmentCompleteHandler:
    @pytest.mark.asyncio
    async def test_stores_assessment_complete_data(self, mock_pool):
        event = {
            "cid": "conv-cac-001",
            "payload": {"completedAt": "2026-04-03T10:00:00Z", "outcome": "passed"},
        }
        await handle_credit_assessment_complete(mock_pool, event)

        data = _last_assessment_json(mock_pool, "assessments_credit_assessment_complete")
        assert data["outcome"] == "passed"
        assert _conversation_id_where(mock_pool) == "conv-cac-001"

    @pytest.mark.asyncio
    async def test_ensures_conversation_row(self, mock_pool):
        event = {"cid": "conv-cac-001", "payload": {"outcome": "passed"}}
        await handle_credit_assessment_complete(mock_pool, event)
        inserts = [c for c in mock_pool.calls_against("conversations") if c.op == "INSERT"]
        assert inserts and "DO NOTHING" in inserts[0].sql.upper()

    @pytest.mark.asyncio
    async def test_strips_dollar_keys(self, mock_pool):
        event = {
            "cid": "conv-cac-002",
            "payload": {"outcome": "passed", "$ne": "injection_attempt"},
        }
        await handle_credit_assessment_complete(mock_pool, event)
        data = _last_assessment_json(mock_pool, "assessments_credit_assessment_complete")
        assert "$ne" not in data


class TestHandlerRegistrationAndExports:
    def test_all_new_handlers_importable_from_init(self):
        from billie_servicing.handlers import (
            handle_assessment,
            handle_credit_assessment_complete,
            handle_post_identity_risk_check,
        )
        assert callable(handle_assessment)
        assert callable(handle_post_identity_risk_check)
        assert callable(handle_credit_assessment_complete)
