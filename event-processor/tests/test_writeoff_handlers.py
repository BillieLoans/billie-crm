"""Unit tests for Write-Off event handlers.

Tests cover writeoff.{requested,approved,rejected,cancelled}.v1 — the
CRM-originated events processed by the event-processor.
"""

import json

import pytest

from billie_servicing.handlers.writeoff import (
    _generate_request_number,
    _parse_payload,
    handle_writeoff_approved,
    handle_writeoff_cancelled,
    handle_writeoff_rejected,
    handle_writeoff_requested,
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
        assert result.startswith("WO-")
        parts = result.split("-")
        assert len(parts) == 3
        assert len(parts[1]) == 14
        assert len(parts[2]) == 4

    def test_generate_unique_request_numbers(self):
        numbers = {_generate_request_number() for _ in range(100)}
        assert len(numbers) >= 90


class TestWriteoffRequestedHandler:
    @pytest.mark.asyncio
    async def test_handle_writeoff_requested_creates_document(self, mock_pool):
        event = {
            "conv": "req-123",
            "cause": "evt-456",
            "typ": "writeoff.requested.v1",
            "payload": {
                "loanAccountId": "acc-001",
                "customerId": "cust-001",
                "customerName": "John Smith",
                "accountNumber": "1234567890",
                "amount": 1500.0,
                "originalBalance": 1500.0,
                "reason": "hardship",
                "notes": "Customer hardship case",
                "priority": "high",
                "requestedBy": "user-001",
                "requestedByName": "Jane Doe",
            },
        }

        await handle_writeoff_requested(mock_pool, event)

        inserts = mock_pool.inserts_into("write_off_requests")
        assert len(inserts) == 1
        doc = inserts[0]

        # IDs
        assert doc["request_id"] == "req-123"
        assert doc["event_id"] == "evt-456"
        assert doc["request_number"].startswith("WO-")

        # Account / customer info
        assert doc["loan_account_id"] == "acc-001"
        assert doc["customer_id"] == "cust-001"
        assert doc["customer_name"] == "John Smith"
        assert doc["account_number"] == "1234567890"

        # Request details
        assert doc["amount"] == 1500.0
        assert doc["original_balance"] == 1500.0
        assert doc["reason"] == "hardship"
        assert doc["notes"] == "Customer hardship case"
        assert doc["priority"] == "high"
        assert doc["status"] == "pending"

        # Audit
        assert doc["requested_by_name"] == "Jane Doe"
        assert "requested_at" in doc
        assert "created_at" in doc
        assert "updated_at" in doc

        # Confirm the upsert targets request_id (the natural-key conflict).
        call = mock_pool.calls_against("write_off_requests")[0]
        assert call.conflict_columns == ["request_id"]

    @pytest.mark.asyncio
    async def test_handle_writeoff_requested_with_json_string_payload(self, mock_pool):
        payload = {
            "loanAccountId": "acc-002",
            "customerId": "cust-002",
            "amount": 500.0,
            "reason": "bankruptcy",
            "requestedBy": "user-002",
        }
        event = {
            "conv": "req-789",
            "cause": "evt-789",
            "typ": "writeoff.requested.v1",
            "payload": json.dumps(payload),
        }

        await handle_writeoff_requested(mock_pool, event)

        doc = mock_pool.last_insert("write_off_requests")
        assert doc is not None
        assert doc["loan_account_id"] == "acc-002"
        assert doc["amount"] == 500.0
        assert doc["reason"] == "bankruptcy"


class TestWriteoffApprovedHandler:
    @pytest.mark.asyncio
    async def test_handle_writeoff_approved_updates_status(self, mock_pool):
        event = {
            "conv": "req-123",
            "cause": "evt-approve-456",
            "typ": "writeoff.approved.v1",
            "payload": {
                "requestId": "req-123",
                "requestNumber": "WO-20241211-ABCD",
                "comment": "Approved after review",
                "approvedBy": "supervisor-001",
                "approvedByName": "Supervisor Name",
            },
        }

        await handle_writeoff_approved(mock_pool, event)

        updates = mock_pool.updates_to("write_off_requests")
        assert len(updates) == 1
        update = updates[0]

        # WHERE clause keyed on request_id
        call = mock_pool.calls_against("write_off_requests")[0]
        assert call.where == {"request_id": "req-123"}

        assert update["status"] == "approved"
        assert update["approval_details_approved_by"] == "supervisor-001"
        assert update["approval_details_approved_by_name"] == "Supervisor Name"
        assert update["approval_details_comment"] == "Approved after review"
        assert "approval_details_approved_at" in update
        assert "updated_at" in update


class TestWriteoffRejectedHandler:
    @pytest.mark.asyncio
    async def test_handle_writeoff_rejected_updates_status(self, mock_pool):
        event = {
            "conv": "req-456",
            "cause": "evt-reject-789",
            "typ": "writeoff.rejected.v1",
            "payload": {
                "requestId": "req-456",
                "requestNumber": "WO-20241211-EFGH",
                "reason": "Insufficient documentation provided",
                "rejectedBy": "supervisor-002",
                "rejectedByName": "Another Supervisor",
            },
        }

        await handle_writeoff_rejected(mock_pool, event)

        update = mock_pool.last_update("write_off_requests")
        call = mock_pool.calls_against("write_off_requests")[0]
        assert call.where == {"request_id": "req-456"}

        assert update["status"] == "rejected"
        assert update["approval_details_rejected_by"] == "supervisor-002"
        assert update["approval_details_rejected_by_name"] == "Another Supervisor"
        assert update["approval_details_reason"] == "Insufficient documentation provided"
        assert "approval_details_rejected_at" in update


class TestWriteoffCancelledHandler:
    @pytest.mark.asyncio
    async def test_handle_writeoff_cancelled_updates_status(self, mock_pool):
        event = {
            "conv": "req-789",
            "cause": "evt-cancel-123",
            "typ": "writeoff.cancelled.v1",
            "payload": {
                "requestId": "req-789",
                "requestNumber": "WO-20241211-IJKL",
                "cancelledBy": "user-001",
                "cancelledByName": "Original Requester",
            },
        }

        await handle_writeoff_cancelled(mock_pool, event)

        update = mock_pool.last_update("write_off_requests")
        call = mock_pool.calls_against("write_off_requests")[0]
        assert call.where == {"request_id": "req-789"}

        assert update["status"] == "cancelled"
        assert update["cancellation_details_cancelled_by"] == "user-001"
        assert update["cancellation_details_cancelled_by_name"] == "Original Requester"
        assert "cancellation_details_cancelled_at" in update


class TestWriteoffEventLifecycle:
    @pytest.mark.asyncio
    async def test_writeoff_request_to_approval_lifecycle(self, mock_pool):
        request_event = {
            "conv": "req-lifecycle-001",
            "cause": "evt-create-001",
            "typ": "writeoff.requested.v1",
            "payload": {
                "loanAccountId": "acc-lifecycle",
                "customerId": "cust-lifecycle",
                "amount": 2000.0,
                "reason": "hardship",
                "requestedBy": "user-requester",
                "requestedByName": "Requester Name",
            },
        }
        await handle_writeoff_requested(mock_pool, request_event)
        assert mock_pool.inserts_into("write_off_requests")

        approve_event = {
            "conv": "req-lifecycle-001",
            "cause": "evt-approve-001",
            "typ": "writeoff.approved.v1",
            "payload": {
                "requestId": "req-lifecycle-001",
                "requestNumber": "WO-TEST-001",
                "comment": "Approved after verification",
                "approvedBy": "user-approver",
                "approvedByName": "Approver Name",
            },
        }
        await handle_writeoff_approved(mock_pool, approve_event)

        updates = mock_pool.updates_to("write_off_requests")
        assert updates  # at least one update happened
        # find the update for the approval (the one with status approved)
        approved_updates = [u for u in updates if u.get("status") == "approved"]
        assert approved_updates
        approval_call = next(
            c for c in mock_pool.calls_against("write_off_requests")
            if c.op == "UPDATE" and c.values.get("status") == "approved"
        )
        assert approval_call.where == {"request_id": "req-lifecycle-001"}

    @pytest.mark.asyncio
    async def test_writeoff_request_to_rejection_lifecycle(self, mock_pool):
        request_event = {
            "conv": "req-reject-001",
            "cause": "evt-create-002",
            "payload": {
                "loanAccountId": "acc-reject",
                "customerId": "cust-reject",
                "amount": 3000.0,
                "reason": "aged_debt",
                "requestedBy": "user-001",
            },
        }
        await handle_writeoff_requested(mock_pool, request_event)

        reject_event = {
            "conv": "req-reject-001",
            "cause": "evt-reject-002",
            "payload": {
                "requestId": "req-reject-001",
                "requestNumber": "WO-TEST-002",
                "reason": "Account still has payment history",
                "rejectedBy": "supervisor-001",
                "rejectedByName": "Supervisor",
            },
        }
        await handle_writeoff_rejected(mock_pool, reject_event)

        rejection = next(
            u for u in mock_pool.updates_to("write_off_requests") if u.get("status") == "rejected"
        )
        assert rejection["status"] == "rejected"

    @pytest.mark.asyncio
    async def test_writeoff_request_to_cancellation_lifecycle(self, mock_pool):
        request_event = {
            "conv": "req-cancel-001",
            "cause": "evt-create-003",
            "payload": {
                "loanAccountId": "acc-cancel",
                "customerId": "cust-cancel",
                "amount": 500.0,
                "reason": "other",
                "requestedBy": "user-001",
            },
        }
        await handle_writeoff_requested(mock_pool, request_event)

        cancel_event = {
            "conv": "req-cancel-001",
            "cause": "evt-cancel-003",
            "payload": {
                "requestId": "req-cancel-001",
                "requestNumber": "WO-TEST-003",
                "cancelledBy": "user-001",
                "cancelledByName": "Original User",
            },
        }
        await handle_writeoff_cancelled(mock_pool, cancel_event)

        cancellation = next(
            u for u in mock_pool.updates_to("write_off_requests") if u.get("status") == "cancelled"
        )
        assert cancellation["status"] == "cancelled"
