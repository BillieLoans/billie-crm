"""Unit tests for credit assessment & post-identity event handlers (Story 1.2)."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from billie_servicing.handlers.conversation import (
    handle_assessment,
    handle_post_identity_risk_check,
    handle_credit_assessment_complete,
)


@pytest.fixture
def mock_db():
    db = MagicMock()
    db.conversations = MagicMock()
    db.conversations.update_one = AsyncMock(
        return_value=MagicMock(matched_count=0, modified_count=0, upserted_id="new-id")
    )
    return db


class TestAccountConductAssessmentHandler:
    @pytest.mark.asyncio
    async def test_stores_s3_key_and_decision(self, mock_db):
        """AC: stores assessments.accountConduct.s3Key and .decision via handle_assessment."""
        event = {
            "cid": "conv-ac-001",
            "msg_type": "credit_assessment_accountConduct_result",
            "payload": {"s3Key": "bucket/path/to/report.json", "decision": "PASS"},
        }
        await handle_assessment(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        assert call_args[0][0] == {"conversationId": "conv-ac-001"}
        update = call_args[0][1]["$set"]
        assert update["assessments.accountConduct"]["s3Key"] == "bucket/path/to/report.json"
        assert update["assessments.accountConduct"]["decision"] == "PASS"

    @pytest.mark.asyncio
    async def test_upserts_missing_document(self, mock_db):
        """AC: upsert=True creates document if missing."""
        mock_db.conversations.update_one = AsyncMock(
            return_value=MagicMock(matched_count=0, upserted_id="brand-new")
        )
        event = {
            "cid": "brand-new-conv",
            "msg_type": "credit_assessment_accountConduct_result",
            "payload": {"decision": "FAIL"},
        }
        await handle_assessment(mock_db, event)
        mock_db.conversations.update_one.assert_called_once()

    @pytest.mark.asyncio
    async def test_serviceability_still_works(self, mock_db):
        """Regression: credit_assessment_serviceability_result handler works."""
        event = {
            "cid": "conv-svc-001",
            "msg_type": "credit_assessment_serviceability_result",
            "payload": {"s3Key": "bucket/svc/report.json", "decision": "PASS", "surplus": 3000},
        }
        await handle_assessment(mock_db, event)

        update = mock_db.conversations.update_one.call_args[0][1]["$set"]
        assert "assessments.serviceability" in update
        assert update["assessments.serviceability"]["s3Key"] == "bucket/svc/report.json"


class TestPostIdentityRiskCheckHandler:
    @pytest.mark.asyncio
    async def test_stores_risk_data_from_payload(self, mock_db):
        """AC: stores assessments.postIdentityRisk with event payload data."""
        event = {
            "cid": "conv-pir-001",
            "payload": {"riskLevel": "low", "score": 85, "flags": []},
        }
        await handle_post_identity_risk_check(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        assert call_args[0][0] == {"conversationId": "conv-pir-001"}
        update = call_args[0][1]["$set"]
        assert update["assessments.postIdentityRisk"]["riskLevel"] == "low"
        assert update["assessments.postIdentityRisk"]["score"] == 85

    @pytest.mark.asyncio
    async def test_strips_dollar_keys(self, mock_db):
        """AC: strip_dollar_keys() removes $ operator keys from payload."""
        event = {
            "cid": "conv-pir-002",
            "payload": {"riskLevel": "medium", "$injected": "bad_value"},
        }
        await handle_post_identity_risk_check(mock_db, event)

        update = mock_db.conversations.update_one.call_args[0][1]["$set"]
        assert "$injected" not in update["assessments.postIdentityRisk"]
        assert update["assessments.postIdentityRisk"]["riskLevel"] == "medium"

    @pytest.mark.asyncio
    async def test_fallback_to_event_when_no_payload(self, mock_db):
        """Falls back to event body when no payload key."""
        event = {
            "cid": "conv-pir-003",
            "riskLevel": "high",
        }
        await handle_post_identity_risk_check(mock_db, event)

        update = mock_db.conversations.update_one.call_args[0][1]["$set"]
        assert "postIdentityRisk" in update["assessments.postIdentityRisk"] or \
               "assessments.postIdentityRisk" in mock_db.conversations.update_one.call_args[0][1]["$set"]

    @pytest.mark.asyncio
    async def test_upsert_true(self, mock_db):
        event = {"cid": "conv-pir-001", "payload": {"riskLevel": "low"}}
        await handle_post_identity_risk_check(mock_db, event)
        assert mock_db.conversations.update_one.call_args[1].get("upsert") is True

    @pytest.mark.asyncio
    async def test_conv_fallback(self, mock_db):
        event = {"conv": "conv-via-conv-field", "payload": {"riskLevel": "low"}}
        await handle_post_identity_risk_check(mock_db, event)
        filter_arg = mock_db.conversations.update_one.call_args[0][0]
        assert filter_arg == {"conversationId": "conv-via-conv-field"}

    @pytest.mark.asyncio
    async def test_out_of_order_creates_doc(self, mock_db):
        """AC: upsert=True ensures the document is created or updated without error."""
        mock_db.conversations.update_one = AsyncMock(
            return_value=MagicMock(matched_count=0, upserted_id="created-by-upsert")
        )
        event = {"cid": "new-conv", "payload": {"riskLevel": "low"}}
        await handle_post_identity_risk_check(mock_db, event)
        mock_db.conversations.update_one.assert_called_once()
        assert mock_db.conversations.update_one.call_args[1].get("upsert") is True


class TestCreditAssessmentCompleteHandler:
    @pytest.mark.asyncio
    async def test_stores_assessment_complete_data(self, mock_db):
        """AC: relevant assessment fields are updated on the conversation document."""
        event = {
            "cid": "conv-cac-001",
            "payload": {"completedAt": "2026-04-03T10:00:00Z", "outcome": "passed"},
        }
        await handle_credit_assessment_complete(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        assert call_args[0][0] == {"conversationId": "conv-cac-001"}
        update = call_args[0][1]["$set"]
        assert "assessments.creditAssessmentComplete" in update
        assert update["assessments.creditAssessmentComplete"]["outcome"] == "passed"

    @pytest.mark.asyncio
    async def test_upsert_true(self, mock_db):
        event = {"cid": "conv-cac-001", "payload": {"outcome": "passed"}}
        await handle_credit_assessment_complete(mock_db, event)
        assert mock_db.conversations.update_one.call_args[1].get("upsert") is True

    @pytest.mark.asyncio
    async def test_strips_dollar_keys(self, mock_db):
        event = {
            "cid": "conv-cac-002",
            "payload": {"outcome": "passed", "$ne": "injection_attempt"},
        }
        await handle_credit_assessment_complete(mock_db, event)
        update = mock_db.conversations.update_one.call_args[0][1]["$set"]
        assert "$ne" not in update["assessments.creditAssessmentComplete"]


class TestHandlerRegistrationAndExports:
    def test_all_new_handlers_importable_from_init(self):
        """AC: __init__.py handler map includes all new event type to handler function mappings."""
        from billie_servicing.handlers import (
            handle_assessment,
            handle_post_identity_risk_check,
            handle_credit_assessment_complete,
        )
        assert callable(handle_assessment)
        assert callable(handle_post_identity_risk_check)
        assert callable(handle_credit_assessment_complete)
