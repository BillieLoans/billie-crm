"""Unit tests for block_clear_approval event handlers.

Tests cover block_clear_approval.{requested,approved,rejected,cancelled}.v1 —
the CRM-originated events processed by the event-processor.
"""

import json

import pytest

from billie_servicing.handlers.block_clear_approval import (
    _generate_request_number,
    _parse_payload,
    handle_block_clear_approval_approved,
    handle_block_clear_approval_cancelled,
    handle_block_clear_approval_rejected,
    handle_block_clear_approval_requested,
)


class TestPayloadParsing:
    def test_parse_dict_payload(self):
        assert _parse_payload({"payload": {"key": "value"}}) == {"key": "value"}

    def test_parse_json_string_payload(self):
        assert _parse_payload({"payload": '{"key": "value"}'}) == {"key": "value"}

    def test_parse_empty_payload(self):
        assert _parse_payload({}) == {}

    def test_parse_invalid_json_payload(self):
        assert _parse_payload({"payload": "not valid json"}) == {}


class TestRequestNumberGeneration:
    def test_generate_request_number_format(self):
        result = _generate_request_number()
        assert result.startswith("RBC-")
        parts = result.split("-")
        assert len(parts) == 3
        assert len(parts[1]) == 14
        assert len(parts[2]) == 4

    def test_generate_unique_request_numbers(self):
        numbers = {_generate_request_number() for _ in range(100)}
        assert len(numbers) >= 90


class TestBlockClearApprovalRequestedHandler:
    @pytest.mark.asyncio
    async def test_requested_creates_pending_row(self, mock_pool):
        event = {
            "conv": "req-1",
            "cause": "evt-1",
            "typ": "block_clear_approval.requested.v1",
            "payload": {
                "canonicalCustomerId": "c1",
                "conversationId": "conv-1",
                "customerName": "Jane Customer",
                "reasons": ["PRIOR_DEFAULT"],
                "justification": "manual assessment",
                "requestedByName": "Jane Ops",
            },
        }
        await handle_block_clear_approval_requested(mock_pool, event)
        doc = mock_pool.last_insert("reapplication_block_clear_requests")
        assert doc["request_id"] == "req-1"
        assert doc["event_id"] == "evt-1"
        assert doc["canonical_customer_id"] == "c1"
        assert doc["conversation_id"] == "conv-1"
        assert doc["customer_name"] == "Jane Customer"
        assert doc["status"] == "pending"
        assert doc["request_number"].startswith("RBC-")
        assert doc["requested_by_name"] == "Jane Ops"
        assert "requested_at" in doc
        assert "created_at" in doc
        assert "updated_at" in doc

    @pytest.mark.asyncio
    async def test_requested_reasons_json_encoded(self, mock_pool):
        """reasons list must be json.dumps'd for the jsonb column."""
        event = {
            "conv": "req-2",
            "cause": "evt-2",
            "typ": "block_clear_approval.requested.v1",
            "payload": {
                "canonicalCustomerId": "c2",
                "conversationId": "conv-2",
                "reasons": ["PRIOR_DEFAULT", "ACTIVE_LOAN"],
                "justification": "two reasons",
                "requestedByName": "Ops User",
            },
        }
        await handle_block_clear_approval_requested(mock_pool, event)
        doc = mock_pool.last_insert("reapplication_block_clear_requests")
        # The value stored must be the JSON-encoded string, not the raw list.
        assert doc["reasons"] == json.dumps(["PRIOR_DEFAULT", "ACTIVE_LOAN"])

    @pytest.mark.asyncio
    async def test_requested_conflict_on_request_id(self, mock_pool):
        event = {
            "conv": "req-3",
            "cause": "evt-3",
            "typ": "block_clear_approval.requested.v1",
            "payload": {
                "canonicalCustomerId": "c3",
                "conversationId": "conv-3",
                "reasons": ["PRIOR_DEFAULT"],
                "justification": "test",
                "requestedByName": "Ops",
            },
        }
        await handle_block_clear_approval_requested(mock_pool, event)
        call = mock_pool.calls_against("reapplication_block_clear_requests")[0]
        assert call.conflict_columns == ["request_id"]

    @pytest.mark.asyncio
    async def test_requested_defaults_for_optional_fields(self, mock_pool):
        """customer_name and requested_by_name default to empty string."""
        event = {
            "conv": "req-4",
            "cause": "evt-4",
            "typ": "block_clear_approval.requested.v1",
            "payload": {
                "canonicalCustomerId": "c4",
                "conversationId": "conv-4",
                "reasons": [],
                "justification": "minimal",
            },
        }
        await handle_block_clear_approval_requested(mock_pool, event)
        doc = mock_pool.last_insert("reapplication_block_clear_requests")
        assert doc["customer_name"] == ""
        assert doc["requested_by_name"] == ""

    @pytest.mark.asyncio
    async def test_requested_with_json_string_payload(self, mock_pool):
        payload = {
            "canonicalCustomerId": "c5",
            "conversationId": "conv-5",
            "reasons": ["PRIOR_DEFAULT"],
            "justification": "json string payload",
            "requestedByName": "Ops",
        }
        event = {
            "conv": "req-5",
            "cause": "evt-5",
            "typ": "block_clear_approval.requested.v1",
            "payload": json.dumps(payload),
        }
        await handle_block_clear_approval_requested(mock_pool, event)
        doc = mock_pool.last_insert("reapplication_block_clear_requests")
        assert doc["canonical_customer_id"] == "c5"


class TestBlockClearApprovalApprovedHandler:
    @pytest.mark.asyncio
    async def test_approved_flips_status(self, mock_pool):
        event = {
            "conv": "req-1",
            "cause": "evt-2",
            "typ": "block_clear_approval.approved.v1",
            "payload": {"approvedBy": "boss-1", "approvedByName": "Sam Sup", "comment": "ok"},
        }
        await handle_block_clear_approval_approved(mock_pool, event)
        doc = mock_pool.last_update("reapplication_block_clear_requests")
        assert doc["status"] == "approved"
        assert doc["approval_details_approved_by"] == "boss-1"
        assert doc["approval_details_approved_by_name"] == "Sam Sup"
        assert doc["approval_details_comment"] == "ok"
        assert "approval_details_approved_at" in doc
        assert "updated_at" in doc

    @pytest.mark.asyncio
    async def test_approved_keys_on_request_id(self, mock_pool):
        event = {
            "conv": "req-10",
            "cause": "evt-20",
            "typ": "block_clear_approval.approved.v1",
            "payload": {"approvedBy": "boss-2", "approvedByName": "Boss", "comment": ""},
        }
        await handle_block_clear_approval_approved(mock_pool, event)
        call = mock_pool.calls_against("reapplication_block_clear_requests")[0]
        assert call.where == {"request_id": "req-10"}


class TestBlockClearApprovalRejectedHandler:
    @pytest.mark.asyncio
    async def test_rejected_flips_status(self, mock_pool):
        event = {
            "conv": "req-20",
            "cause": "evt-30",
            "typ": "block_clear_approval.rejected.v1",
            "payload": {
                "rejectedBy": "boss-3",
                "rejectedByName": "Rejector",
                "reason": "not enough evidence",
            },
        }
        await handle_block_clear_approval_rejected(mock_pool, event)
        doc = mock_pool.last_update("reapplication_block_clear_requests")
        assert doc["status"] == "rejected"
        assert doc["approval_details_rejected_by"] == "boss-3"
        assert doc["approval_details_rejected_by_name"] == "Rejector"
        assert doc["approval_details_reason"] == "not enough evidence"
        assert "approval_details_rejected_at" in doc
        assert "updated_at" in doc

    @pytest.mark.asyncio
    async def test_rejected_keys_on_request_id(self, mock_pool):
        event = {
            "conv": "req-21",
            "cause": "evt-31",
            "typ": "block_clear_approval.rejected.v1",
            "payload": {"rejectedBy": "b", "rejectedByName": "B", "reason": "x"},
        }
        await handle_block_clear_approval_rejected(mock_pool, event)
        call = mock_pool.calls_against("reapplication_block_clear_requests")[0]
        assert call.where == {"request_id": "req-21"}


class TestBlockClearApprovalCancelledHandler:
    @pytest.mark.asyncio
    async def test_cancelled_flips_status(self, mock_pool):
        event = {
            "conv": "req-30",
            "cause": "evt-40",
            "typ": "block_clear_approval.cancelled.v1",
            "payload": {
                "cancelledBy": "user-1",
                "cancelledByName": "Original Requester",
            },
        }
        await handle_block_clear_approval_cancelled(mock_pool, event)
        doc = mock_pool.last_update("reapplication_block_clear_requests")
        assert doc["status"] == "cancelled"
        assert doc["cancellation_details_cancelled_by"] == "user-1"
        assert doc["cancellation_details_cancelled_by_name"] == "Original Requester"
        assert "cancellation_details_cancelled_at" in doc
        assert "updated_at" in doc

    @pytest.mark.asyncio
    async def test_cancelled_keys_on_request_id(self, mock_pool):
        event = {
            "conv": "req-31",
            "cause": "evt-41",
            "typ": "block_clear_approval.cancelled.v1",
            "payload": {"cancelledBy": "u", "cancelledByName": "U"},
        }
        await handle_block_clear_approval_cancelled(mock_pool, event)
        call = mock_pool.calls_against("reapplication_block_clear_requests")[0]
        assert call.where == {"request_id": "req-31"}
