"""Unit tests for statement capture flow event handlers."""

import pytest
from unittest.mock import AsyncMock, MagicMock, call

from billie_servicing.handlers.conversation import (
    handle_statement_consent_initiated,
    handle_statement_consent_complete,
    handle_statement_consent_cancelled,
    handle_basiq_job_created,
    handle_statement_retrieval_complete,
    handle_affordability_report_complete,
    handle_statement_checks_complete,
)


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def mock_db():
    """Mock MongoDB database with conversations collection."""
    db = MagicMock()
    db.conversations = MagicMock()
    db.conversations.update_one = AsyncMock(
        return_value=MagicMock(matched_count=0, modified_count=0, upserted_id="new-id")
    )
    return db


# =============================================================================
# AC#1: handle_statement_consent_initiated
# =============================================================================


class TestHandleStatementConsentInitiated:
    @pytest.mark.asyncio
    async def test_sets_consent_status_initiated(self, mock_db):
        """AC#1: Sets statementCapture.consentStatus to 'initiated'."""
        event = {"cid": "conv-123"}
        await handle_statement_consent_initiated(mock_db, event)

        mock_db.conversations.update_one.assert_called_once()
        call_args = mock_db.conversations.update_one.call_args
        assert call_args[0][0] == {"conversationId": "conv-123"}
        assert call_args[0][1]["$set"]["statementCapture.consentStatus"] == "initiated"

    @pytest.mark.asyncio
    async def test_uses_cid_field(self, mock_db):
        """AC#10: Uses 'cid' field for conversation ID."""
        event = {"cid": "conv-cid"}
        await handle_statement_consent_initiated(mock_db, event)
        filter_arg = mock_db.conversations.update_one.call_args[0][0]
        assert filter_arg == {"conversationId": "conv-cid"}

    @pytest.mark.asyncio
    async def test_uses_conv_fallback(self, mock_db):
        """AC#10: Falls back to 'conv' if 'cid' absent."""
        event = {"conv": "conv-from-conv"}
        await handle_statement_consent_initiated(mock_db, event)
        filter_arg = mock_db.conversations.update_one.call_args[0][0]
        assert filter_arg == {"conversationId": "conv-from-conv"}

    @pytest.mark.asyncio
    async def test_uses_conversation_id_fallback(self, mock_db):
        """AC#10: Falls back to 'conversation_id' if 'cid' and 'conv' absent."""
        event = {"conversation_id": "conv-from-conversation-id"}
        await handle_statement_consent_initiated(mock_db, event)
        filter_arg = mock_db.conversations.update_one.call_args[0][0]
        assert filter_arg == {"conversationId": "conv-from-conversation-id"}

    @pytest.mark.asyncio
    async def test_upsert_true(self, mock_db):
        """AC#10: upsert=True so document is created if missing."""
        event = {"cid": "conv-123"}
        await handle_statement_consent_initiated(mock_db, event)
        call_kwargs = mock_db.conversations.update_one.call_args[1]
        assert call_kwargs.get("upsert") is True

    @pytest.mark.asyncio
    async def test_set_on_insert_created_at(self, mock_db):
        """Includes $setOnInsert for createdAt."""
        event = {"cid": "conv-123"}
        await handle_statement_consent_initiated(mock_db, event)
        update_doc = mock_db.conversations.update_one.call_args[0][1]
        assert "createdAt" in update_doc["$setOnInsert"]

    @pytest.mark.asyncio
    async def test_updates_updated_at(self, mock_db):
        """Always updates updatedAt."""
        event = {"cid": "conv-123"}
        await handle_statement_consent_initiated(mock_db, event)
        update_doc = mock_db.conversations.update_one.call_args[0][1]
        assert "updatedAt" in update_doc["$set"]


# =============================================================================
# AC#2: handle_statement_consent_complete
# =============================================================================


class TestHandleStatementConsentComplete:
    @pytest.mark.asyncio
    async def test_sets_consent_status_complete(self, mock_db):
        """AC#2: Sets statementCapture.consentStatus to 'complete'."""
        event = {"cid": "conv-123"}
        await handle_statement_consent_complete(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        assert call_args[0][0] == {"conversationId": "conv-123"}
        assert call_args[0][1]["$set"]["statementCapture.consentStatus"] == "complete"

    @pytest.mark.asyncio
    async def test_upsert_true(self, mock_db):
        event = {"cid": "conv-123"}
        await handle_statement_consent_complete(mock_db, event)
        assert mock_db.conversations.update_one.call_args[1].get("upsert") is True


# =============================================================================
# AC#3: handle_statement_consent_cancelled
# =============================================================================


class TestHandleStatementConsentCancelled:
    @pytest.mark.asyncio
    async def test_sets_consent_status_cancelled(self, mock_db):
        """AC#3: Sets statementCapture.consentStatus to 'cancelled'."""
        event = {"cid": "conv-456"}
        await handle_statement_consent_cancelled(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        assert call_args[0][0] == {"conversationId": "conv-456"}
        assert call_args[0][1]["$set"]["statementCapture.consentStatus"] == "cancelled"

    @pytest.mark.asyncio
    async def test_upsert_true(self, mock_db):
        event = {"cid": "conv-456"}
        await handle_statement_consent_cancelled(mock_db, event)
        assert mock_db.conversations.update_one.call_args[1].get("upsert") is True


# =============================================================================
# AC#4: handle_basiq_job_created
# =============================================================================


class TestHandleBasiqJobCreated:
    @pytest.mark.asyncio
    async def test_stores_basiq_job_id_from_payload(self, mock_db):
        """AC#4: Stores basiqJobId from event payload."""
        event = {"cid": "conv-789", "payload": {"jobId": "job-abc-123"}}
        await handle_basiq_job_created(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        assert call_args[0][0] == {"conversationId": "conv-789"}
        assert call_args[0][1]["$set"]["statementCapture.basiqJobId"] == "job-abc-123"

    @pytest.mark.asyncio
    async def test_stores_basiq_job_id_from_top_level(self, mock_db):
        """AC#4: Falls back to top-level jobId if no payload."""
        event = {"cid": "conv-789", "jobId": "job-top-level"}
        await handle_basiq_job_created(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        assert call_args[0][1]["$set"]["statementCapture.basiqJobId"] == "job-top-level"

    @pytest.mark.asyncio
    async def test_stores_basiq_job_id_snake_case(self, mock_db):
        """AC#4: Falls back to job_id if jobId absent."""
        event = {"cid": "conv-789", "job_id": "job-snake"}
        await handle_basiq_job_created(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        assert call_args[0][1]["$set"]["statementCapture.basiqJobId"] == "job-snake"

    @pytest.mark.asyncio
    async def test_upsert_true(self, mock_db):
        event = {"cid": "conv-789", "payload": {"jobId": "job-abc"}}
        await handle_basiq_job_created(mock_db, event)
        assert mock_db.conversations.update_one.call_args[1].get("upsert") is True


# =============================================================================
# AC#5: handle_statement_retrieval_complete
# =============================================================================


class TestHandleStatementRetrievalComplete:
    @pytest.mark.asyncio
    async def test_sets_retrieval_complete_true(self, mock_db):
        """AC#5: Sets statementCapture.retrievalComplete to True."""
        event = {"cid": "conv-001"}
        await handle_statement_retrieval_complete(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        assert call_args[0][0] == {"conversationId": "conv-001"}
        assert call_args[0][1]["$set"]["statementCapture.retrievalComplete"] is True

    @pytest.mark.asyncio
    async def test_upsert_true(self, mock_db):
        event = {"cid": "conv-001"}
        await handle_statement_retrieval_complete(mock_db, event)
        assert mock_db.conversations.update_one.call_args[1].get("upsert") is True

    @pytest.mark.asyncio
    async def test_out_of_order_event_creates_doc(self, mock_db):
        """AC#10: Out-of-order event (retrieval before consent) creates doc via upsert."""
        mock_db.conversations.update_one = AsyncMock(
            return_value=MagicMock(matched_count=0, upserted_id="new-doc-id")
        )
        event = {"cid": "brand-new-conv"}
        await handle_statement_retrieval_complete(mock_db, event)

        # update_one was called — if doc didn't exist, upsert creates it
        mock_db.conversations.update_one.assert_called_once()
        assert mock_db.conversations.update_one.call_args[1].get("upsert") is True


# =============================================================================
# AC#6: handle_affordability_report_complete
# =============================================================================


class TestHandleAffordabilityReportComplete:
    @pytest.mark.asyncio
    async def test_stores_payload_as_affordability_report(self, mock_db):
        """AC#6: Stores event payload as statementCapture.affordabilityReport."""
        event = {
            "cid": "conv-002",
            "payload": {"income": 5000, "expenses": 2000, "surplus": 3000},
        }
        await handle_affordability_report_complete(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        report = call_args[0][1]["$set"]["statementCapture.affordabilityReport"]
        assert report["income"] == 5000
        assert report["expenses"] == 2000

    @pytest.mark.asyncio
    async def test_strips_dollar_keys_from_report(self, mock_db):
        """AC#6: strip_dollar_keys() is applied to remove $ operator keys."""
        event = {
            "cid": "conv-002",
            "payload": {"income": 5000, "$operator": "should-be-stripped", "expenses": 2000},
        }
        await handle_affordability_report_complete(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        report = call_args[0][1]["$set"]["statementCapture.affordabilityReport"]
        assert "$operator" not in report
        assert report["income"] == 5000

    @pytest.mark.asyncio
    async def test_upsert_true(self, mock_db):
        event = {"cid": "conv-002", "payload": {"income": 5000}}
        await handle_affordability_report_complete(mock_db, event)
        assert mock_db.conversations.update_one.call_args[1].get("upsert") is True


# =============================================================================
# AC#7: handle_statement_checks_complete
# =============================================================================


class TestHandleStatementChecksComplete:
    @pytest.mark.asyncio
    async def test_sets_checks_complete_true(self, mock_db):
        """AC#7: Sets statementCapture.checksComplete to True."""
        event = {"cid": "conv-003"}
        await handle_statement_checks_complete(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        assert call_args[0][0] == {"conversationId": "conv-003"}
        assert call_args[0][1]["$set"]["statementCapture.checksComplete"] is True

    @pytest.mark.asyncio
    async def test_upsert_true(self, mock_db):
        event = {"cid": "conv-003"}
        await handle_statement_checks_complete(mock_db, event)
        assert mock_db.conversations.update_one.call_args[1].get("upsert") is True


# =============================================================================
# AC#9: Existing handlers unaffected
# =============================================================================


class TestExistingHandlersUnaffected:
    def test_existing_handlers_still_importable(self):
        """AC#9: Existing handlers can still be imported without error."""
        from billie_servicing.handlers.conversation import (
            handle_conversation_started,
            handle_utterance,
            handle_final_decision,
            handle_conversation_summary,
            handle_application_detail_changed,
            handle_assessment,
            handle_noticeboard_updated,
        )
        assert callable(handle_conversation_started)
        assert callable(handle_utterance)
        assert callable(handle_final_decision)
        assert callable(handle_conversation_summary)
        assert callable(handle_application_detail_changed)
        assert callable(handle_assessment)
        assert callable(handle_noticeboard_updated)

    def test_new_handlers_are_callable(self):
        """All 7 new handlers are callable."""
        assert callable(handle_statement_consent_initiated)
        assert callable(handle_statement_consent_complete)
        assert callable(handle_statement_consent_cancelled)
        assert callable(handle_basiq_job_created)
        assert callable(handle_statement_retrieval_complete)
        assert callable(handle_affordability_report_complete)
        assert callable(handle_statement_checks_complete)
