"""Unit tests for statement-capture flow handlers."""

import pytest

from billie_servicing.handlers.conversation import (
    handle_affordability_report_downloaded,
    handle_basiq_job_created,
    handle_statement_checks_complete,
    handle_statement_consent_cancelled,
    handle_statement_consent_complete,
    handle_statement_consent_initiated,
    handle_statement_retrieval_complete,
)


def _patch_for(mock_pool):
    """Return the last JSON patch merged into conversations.statement_capture."""
    return mock_pool.last_jsonb_merge("conversations", "statement_capture")


def _conversation_id_where(mock_pool):
    """Return the conversation_id used in the most recent UPDATE on conversations."""
    updates = [c for c in mock_pool.calls_against("conversations") if c.op == "UPDATE"]
    assert updates, "expected an UPDATE on conversations"
    return updates[-1].where.get("conversation_id")


def _ensures_conversation_row(mock_pool, conversation_id):
    """Assert the handler ran an INSERT … ON CONFLICT (conversation_id) DO NOTHING
    against conversations to guarantee the parent row exists."""
    inserts = [c for c in mock_pool.calls_against("conversations") if c.op == "INSERT"]
    assert inserts, "expected an INSERT to ensure conversation row exists"
    insert = inserts[0]
    assert insert.conflict_columns == ["conversation_id"]
    assert insert.values.get("conversation_id") == conversation_id
    assert "DO NOTHING" in insert.sql.upper()


class TestHandleStatementConsentInitiated:
    @pytest.mark.asyncio
    async def test_sets_consent_status_initiated(self, mock_pool):
        await handle_statement_consent_initiated(mock_pool, {"cid": "conv-123"})
        assert _patch_for(mock_pool) == {"consentStatus": "initiated"}
        assert _conversation_id_where(mock_pool) == "conv-123"

    @pytest.mark.asyncio
    async def test_uses_cid_field(self, mock_pool):
        await handle_statement_consent_initiated(mock_pool, {"cid": "conv-cid"})
        assert _conversation_id_where(mock_pool) == "conv-cid"

    @pytest.mark.asyncio
    async def test_uses_conv_fallback(self, mock_pool):
        await handle_statement_consent_initiated(mock_pool, {"conv": "conv-from-conv"})
        assert _conversation_id_where(mock_pool) == "conv-from-conv"

    @pytest.mark.asyncio
    async def test_uses_conversation_id_fallback(self, mock_pool):
        await handle_statement_consent_initiated(
            mock_pool, {"conversation_id": "conv-from-conversation-id"}
        )
        assert _conversation_id_where(mock_pool) == "conv-from-conversation-id"

    @pytest.mark.asyncio
    async def test_ensures_parent_row_via_do_nothing(self, mock_pool):
        await handle_statement_consent_initiated(mock_pool, {"cid": "conv-123"})
        _ensures_conversation_row(mock_pool, "conv-123")

    @pytest.mark.asyncio
    async def test_updates_updated_at(self, mock_pool):
        await handle_statement_consent_initiated(mock_pool, {"cid": "conv-123"})
        update_sql = [
            c.sql for c in mock_pool.calls_against("conversations") if c.op == "UPDATE"
        ][0]
        # merge_jsonb always sets updated_at = NOW() in its SQL template.
        assert "updated_at = NOW()" in update_sql


class TestHandleStatementConsentComplete:
    @pytest.mark.asyncio
    async def test_sets_consent_status_complete(self, mock_pool):
        await handle_statement_consent_complete(mock_pool, {"cid": "conv-123"})
        assert _patch_for(mock_pool) == {"consentStatus": "complete"}
        assert _conversation_id_where(mock_pool) == "conv-123"

    @pytest.mark.asyncio
    async def test_ensures_parent_row(self, mock_pool):
        await handle_statement_consent_complete(mock_pool, {"cid": "conv-123"})
        _ensures_conversation_row(mock_pool, "conv-123")


class TestHandleStatementConsentCancelled:
    @pytest.mark.asyncio
    async def test_sets_consent_status_cancelled(self, mock_pool):
        await handle_statement_consent_cancelled(mock_pool, {"cid": "conv-456"})
        assert _patch_for(mock_pool) == {"consentStatus": "cancelled"}
        assert _conversation_id_where(mock_pool) == "conv-456"

    @pytest.mark.asyncio
    async def test_ensures_parent_row(self, mock_pool):
        await handle_statement_consent_cancelled(mock_pool, {"cid": "conv-456"})
        _ensures_conversation_row(mock_pool, "conv-456")


class TestHandleBasiqJobCreated:
    @pytest.mark.asyncio
    async def test_stores_basiq_job_id_from_payload(self, mock_pool):
        await handle_basiq_job_created(
            mock_pool, {"cid": "conv-789", "payload": {"jobId": "job-abc-123"}}
        )
        assert _patch_for(mock_pool) == {"basiqJobId": "job-abc-123"}
        assert _conversation_id_where(mock_pool) == "conv-789"

    @pytest.mark.asyncio
    async def test_stores_basiq_job_id_from_top_level(self, mock_pool):
        await handle_basiq_job_created(mock_pool, {"cid": "conv-789", "jobId": "job-top-level"})
        assert _patch_for(mock_pool) == {"basiqJobId": "job-top-level"}

    @pytest.mark.asyncio
    async def test_stores_basiq_job_id_snake_case(self, mock_pool):
        await handle_basiq_job_created(mock_pool, {"cid": "conv-789", "job_id": "job-snake"})
        assert _patch_for(mock_pool) == {"basiqJobId": "job-snake"}

    @pytest.mark.asyncio
    async def test_ensures_parent_row(self, mock_pool):
        await handle_basiq_job_created(mock_pool, {"cid": "conv-789", "payload": {"jobId": "j"}})
        _ensures_conversation_row(mock_pool, "conv-789")


class TestHandleStatementRetrievalComplete:
    @pytest.mark.asyncio
    async def test_sets_retrieval_complete_true(self, mock_pool):
        await handle_statement_retrieval_complete(mock_pool, {"cid": "conv-001"})
        assert _patch_for(mock_pool) == {"retrievalComplete": True}
        assert _conversation_id_where(mock_pool) == "conv-001"

    @pytest.mark.asyncio
    async def test_ensures_parent_row(self, mock_pool):
        await handle_statement_retrieval_complete(mock_pool, {"cid": "conv-001"})
        _ensures_conversation_row(mock_pool, "conv-001")

    @pytest.mark.asyncio
    async def test_out_of_order_event_creates_doc(self, mock_pool):
        # When the handler runs against a brand-new conversation, the
        # ensure step still INSERTs a stub row with DO NOTHING semantics —
        # the merge_jsonb that follows then patches the just-created row.
        await handle_statement_retrieval_complete(mock_pool, {"cid": "brand-new-conv"})
        _ensures_conversation_row(mock_pool, "brand-new-conv")
        assert _patch_for(mock_pool) == {"retrievalComplete": True}

    @pytest.mark.asyncio
    async def test_extracts_file_locations_from_steps(self, mock_pool):
        await handle_statement_retrieval_complete(
            mock_pool,
            {
                "cid": "conv-files",
                "payload": {
                    "steps": {
                        "statement-data": {
                            "file_locations": ["s3://bucket/A/statements/data.json"]
                        },
                        "categorized-transactions": {
                            "file_locations": ["s3://bucket/A/AffordabilityReports/cat.csv"]
                        },
                        "affordability-report": {
                            "file_locations": ["s3://bucket/A/AffordabilityReports/aff.json"]
                        },
                        "retrieve-accounts": {
                            "file_locations": ["s3://bucket/A/AffordabilityReports/accs.json"]
                        },
                    }
                },
            },
        )
        patch = _patch_for(mock_pool)
        assert patch["retrievalComplete"] is True
        assert patch["fileLocations"] == {
            "statementData": "s3://bucket/A/statements/data.json",
            "categorizedTransactions": "s3://bucket/A/AffordabilityReports/cat.csv",
            "affordabilityReport": "s3://bucket/A/AffordabilityReports/aff.json",
            "accounts": "s3://bucket/A/AffordabilityReports/accs.json",
        }

    @pytest.mark.asyncio
    async def test_omits_file_locations_when_steps_missing(self, mock_pool):
        await handle_statement_retrieval_complete(
            mock_pool, {"cid": "conv-no-files", "payload": {"application_number": "A"}}
        )
        patch = _patch_for(mock_pool)
        assert patch == {"retrievalComplete": True}

    @pytest.mark.asyncio
    async def test_skips_step_with_empty_file_locations(self, mock_pool):
        await handle_statement_retrieval_complete(
            mock_pool,
            {
                "cid": "conv-partial",
                "payload": {
                    "steps": {
                        "statement-data": {"file_locations": []},
                        "affordability-report": {
                            "file_locations": ["s3://bucket/x/aff.json"]
                        },
                    }
                },
            },
        )
        patch = _patch_for(mock_pool)
        assert patch["fileLocations"] == {
            "affordabilityReport": "s3://bucket/x/aff.json",
        }


class TestHandleAffordabilityReportDownloaded:
    @pytest.mark.asyncio
    async def test_stores_payload_as_affordability_report(self, mock_pool):
        # Real shape from the chatLedger affordability_report_downloaded event.
        await handle_affordability_report_downloaded(
            mock_pool,
            {
                "cid": "conv-002",
                "payload": {
                    "application_number": "A7A73A13-659",
                    "statement_provider": "BSDC",
                    "affordability_report": {
                        "file_location": "s3://bucket/x/aff.json"
                    },
                    "summary": {"data": {"metrics": [{"id": "ME012", "result": {"value": 788.19}}]}},
                },
            },
        )
        patch = _patch_for(mock_pool)
        assert patch is not None
        report = patch["affordabilityReport"]
        assert report["application_number"] == "A7A73A13-659"
        assert report["affordability_report"]["file_location"] == "s3://bucket/x/aff.json"
        assert report["summary"]["data"]["metrics"][0]["id"] == "ME012"

    @pytest.mark.asyncio
    async def test_strips_dollar_keys_from_report(self, mock_pool):
        await handle_affordability_report_downloaded(
            mock_pool,
            {
                "cid": "conv-002",
                "payload": {"income": 5000, "$operator": "should-be-stripped", "expenses": 2000},
            },
        )
        report = _patch_for(mock_pool)["affordabilityReport"]
        assert "$operator" not in report
        assert report["income"] == 5000

    @pytest.mark.asyncio
    async def test_ensures_parent_row(self, mock_pool):
        await handle_affordability_report_downloaded(
            mock_pool, {"cid": "conv-002", "payload": {"income": 5000}}
        )
        _ensures_conversation_row(mock_pool, "conv-002")


class TestHandleStatementChecksComplete:
    @pytest.mark.asyncio
    async def test_sets_checks_complete_true(self, mock_pool):
        await handle_statement_checks_complete(mock_pool, {"cid": "conv-003"})
        assert _patch_for(mock_pool) == {"checksComplete": True}
        assert _conversation_id_where(mock_pool) == "conv-003"

    @pytest.mark.asyncio
    async def test_ensures_parent_row(self, mock_pool):
        await handle_statement_checks_complete(mock_pool, {"cid": "conv-003"})
        _ensures_conversation_row(mock_pool, "conv-003")


class TestExistingHandlersUnaffected:
    def test_existing_handlers_still_importable(self):
        from billie_servicing.handlers.conversation import (
            handle_application_detail_changed,
            handle_assessment,
            handle_conversation_started,
            handle_conversation_summary,
            handle_final_decision,
            handle_noticeboard_updated,
            handle_utterance,
        )
        for fn in (
            handle_conversation_started,
            handle_utterance,
            handle_final_decision,
            handle_conversation_summary,
            handle_application_detail_changed,
            handle_assessment,
            handle_noticeboard_updated,
        ):
            assert callable(fn)

    def test_new_handlers_are_callable(self):
        for fn in (
            handle_statement_consent_initiated,
            handle_statement_consent_complete,
            handle_statement_consent_cancelled,
            handle_basiq_job_created,
            handle_statement_retrieval_complete,
            handle_affordability_report_downloaded,
            handle_statement_checks_complete,
        ):
            assert callable(fn)
