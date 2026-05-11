"""Unit tests for notification event handlers.

Tests cover the three platform → CRM read-only projections:
- notification.sent.v1
- notification.delivery_failed.v1
- statement.generated.v1
"""

import pytest
from unittest.mock import MagicMock

from billie_servicing.handlers.notification import (
    handle_notification_sent,
    handle_notification_delivery_failed,
    handle_notification_suppression_changed,
    handle_statement_generated,
)


def _build_parsed_event(payload: MagicMock, cause: str = "") -> MagicMock:
    """Wrap a payload mock in a ParsedNotificationEvent-shaped wrapper."""
    parsed = MagicMock()
    parsed.payload = payload
    # The notification handlers read `parsed_event.cause` / `.conv` for the
    # inbox envelope id; default to empty so tests can opt in.
    parsed.cause = cause
    parsed.conv = ""
    return parsed


class TestNotificationSentHandler:
    """Tests for notification.sent.v1 projection."""

    @pytest.mark.asyncio
    async def test_sent_event_upserts_document(self, mock_db):
        payload = MagicMock()
        payload.notification_id = "ntn_001"
        payload.idempotency_key = "predue:acc_123:1:0"
        payload.request_id = "req_abc"
        payload.channel = "email"
        payload.template_name = "pre_due_email_first"
        payload.template_content_hash = "a4f3c21abcdef"
        payload.template_git_sha = "9b1d4e7"
        payload.sent_at = "2026-05-11T03:14:09Z"
        payload.provider = "resend"
        payload.provider_message_id = "abc@resend.com"
        payload.recipient_hash = "sha256hash"
        payload.customer_id = "cust_abc"
        payload.correlation_id = "corr_xyz"
        payload.tags = {"category": "servicing", "reason": "pre_due", "step": 0}

        await handle_notification_sent(mock_db, _build_parsed_event(payload))

        mock_db["notifications"].update_one.assert_called_once()
        call_args = mock_db["notifications"].update_one.call_args
        filter_arg = call_args[0][0]
        update_arg = call_args[0][1]
        kwargs = call_args[1]

        assert filter_arg == {"notificationId": "ntn_001"}
        assert kwargs.get("upsert") is True

        doc = update_arg["$set"]
        assert doc["status"] == "sent"
        assert doc["channel"] == "email"
        assert doc["templateName"] == "pre_due_email_first"
        assert doc["templateContentHash"] == "a4f3c21abcdef"
        assert doc["sentAt"] == "2026-05-11T03:14:09Z"
        assert doc["eventAt"] == "2026-05-11T03:14:09Z"
        assert doc["tags"]["category"] == "servicing"
        assert doc["tags"]["reason"] == "pre_due"
        assert doc["tags"]["step"] == 0
        assert "createdAt" in update_arg["$setOnInsert"]

    @pytest.mark.asyncio
    async def test_sent_event_resolves_customer_link(self, mock_db):
        mock_db.customers.find_one.return_value = {"_id": "mongo_customer_id"}

        payload = MagicMock()
        payload.notification_id = "ntn_002"
        payload.idempotency_key = "key"
        payload.request_id = "req"
        payload.channel = "sms"
        payload.template_name = "pre_due_sms_second"
        payload.template_content_hash = ""
        payload.template_git_sha = None
        payload.sent_at = "2026-05-11T03:14:09Z"
        payload.provider = "clicksend"
        payload.provider_message_id = "msg"
        payload.recipient_hash = "hash"
        payload.customer_id = "cust_abc"
        payload.correlation_id = None
        payload.tags = {}

        await handle_notification_sent(mock_db, _build_parsed_event(payload))

        doc = mock_db["notifications"].update_one.call_args[0][1]["$set"]
        assert doc["customerRef"] == "mongo_customer_id"
        assert doc["customerId"] == "cust_abc"


class TestNotificationDeliveryFailedHandler:
    """Tests for notification.delivery_failed.v1 projection."""

    @pytest.mark.asyncio
    async def test_failed_event_maps_to_failed_status(self, mock_db):
        payload = self._build_failed_payload(error_type="permanent")

        await handle_notification_delivery_failed(mock_db, _build_parsed_event(payload))

        doc = mock_db["notifications"].update_one.call_args[0][1]["$set"]
        assert doc["status"] == "failed"
        assert doc["failure"]["errorType"] == "permanent"
        assert doc["failure"]["errorMessage"] == "Recipient invalid"
        assert doc["failure"]["attempt"] == 3
        assert doc["failure"]["fallbackSuggested"] is None

    @pytest.mark.asyncio
    async def test_suppressed_error_maps_to_blocked_status(self, mock_db):
        """error_type='suppressed' must map to status='blocked' so the UI
        renders it with kill-switch styling, not generic failure styling."""
        payload = self._build_failed_payload(error_type="suppressed")

        await handle_notification_delivery_failed(mock_db, _build_parsed_event(payload))

        doc = mock_db["notifications"].update_one.call_args[0][1]["$set"]
        assert doc["status"] == "blocked"
        assert doc["failure"]["errorType"] == "suppressed"

    @pytest.mark.asyncio
    async def test_contact_missing_with_fallback(self, mock_db):
        payload = self._build_failed_payload(
            error_type="contact_missing", fallback_suggested="sms"
        )

        await handle_notification_delivery_failed(mock_db, _build_parsed_event(payload))

        doc = mock_db["notifications"].update_one.call_args[0][1]["$set"]
        assert doc["status"] == "failed"
        assert doc["failure"]["fallbackSuggested"] == "sms"

    @staticmethod
    def _build_failed_payload(
        error_type: str, fallback_suggested: str | None = None
    ) -> MagicMock:
        payload = MagicMock()
        payload.notification_id = "ntn_fail_001"
        payload.idempotency_key = "key"
        payload.request_id = "req"
        payload.channel = "email"
        payload.template_name = "overdue_email_v1"
        payload.template_content_hash = "hash"
        payload.template_git_sha = "sha"
        payload.failed_at = "2026-05-11T03:14:09Z"
        payload.provider = "resend"
        payload.recipient_hash = "rhash"
        payload.customer_id = "cust_xyz"
        payload.correlation_id = "corr"
        payload.tags = {"category": "servicing", "reason": "overdue", "step": 1}
        payload.error_type = error_type
        payload.error_message = "Recipient invalid"
        payload.attempt = 3
        payload.fallback_suggested = fallback_suggested
        return payload


class TestNotificationSuppressionChangedHandler:
    """Tests for notification.suppression.changed.v1 projection."""

    @pytest.mark.asyncio
    async def test_paused_event_keyed_on_envelope_cause(self, mock_db):
        payload = MagicMock()
        payload.customer_id = "cust_abc"
        payload.mode = "non_essential"
        payload.reason = "Hardship plan #4521"
        payload.set_by = "agent:rohan@billie.loans"
        payload.set_at = "2026-05-11T11:55:17Z"
        payload.expires_at = "2026-06-10T11:55:17Z"
        payload.correlation_id = "corr-1"

        await handle_notification_suppression_changed(
            mock_db, _build_parsed_event(payload, cause="1778500517032-0")
        )

        mock_db["notifications"].update_one.assert_called_once()
        call_args = mock_db["notifications"].update_one.call_args
        filter_arg = call_args[0][0]
        update_arg = call_args[0][1]

        assert filter_arg == {"notificationId": "suppression:1778500517032-0"}
        doc = update_arg["$set"]
        assert doc["status"] == "suppression_change"
        assert doc["customerId"] == "cust_abc"
        assert doc["eventAt"] == "2026-05-11T11:55:17Z"
        assert doc["suppression"]["mode"] == "non_essential"
        assert doc["suppression"]["reason"] == "Hardship plan #4521"
        assert doc["suppression"]["setBy"] == "agent:rohan@billie.loans"
        assert doc["suppression"]["expiresAt"] == "2026-06-10T11:55:17Z"

    @pytest.mark.asyncio
    async def test_clear_event_records_mode_off(self, mock_db):
        payload = MagicMock()
        payload.customer_id = "cust_abc"
        payload.mode = "off"
        payload.reason = ""
        payload.set_by = "agent:rohan@billie.loans"
        payload.set_at = "2026-05-11T12:00:00Z"
        payload.expires_at = None
        payload.correlation_id = None

        await handle_notification_suppression_changed(
            mock_db, _build_parsed_event(payload, cause="evt-clear")
        )

        doc = mock_db["notifications"].update_one.call_args[0][1]["$set"]
        assert doc["suppression"]["mode"] == "off"
        assert doc["suppression"]["expiresAt"] is None
        # Empty reason normalises to None so the UI can branch on it cleanly.
        assert doc["suppression"]["reason"] is None

    @pytest.mark.asyncio
    async def test_falls_back_to_synthetic_id_when_cause_missing(self, mock_db):
        payload = MagicMock()
        payload.customer_id = "cust_xyz"
        payload.mode = "all"
        payload.reason = "Legal hold"
        payload.set_by = "agent:legal@billie.loans"
        payload.set_at = "2026-05-11T13:00:00Z"
        payload.expires_at = None
        payload.correlation_id = None

        await handle_notification_suppression_changed(
            mock_db, _build_parsed_event(payload, cause="")
        )

        filter_arg = mock_db["notifications"].update_one.call_args[0][0]
        assert filter_arg == {
            "notificationId": "suppression:cust_xyz:2026-05-11T13:00:00Z",
        }


class TestStatementGeneratedHandler:
    """Tests for statement.generated.v1 projection."""

    @pytest.mark.asyncio
    async def test_statement_event_creates_statement_doc(self, mock_db):
        payload = MagicMock()
        payload.notification_id = "ntn_stmt_001"
        payload.account_id = "acc_123"
        payload.customer_id = "cust_abc"
        payload.period_start = "2026-04-01"
        payload.period_end = "2026-04-30"
        payload.dispatched_at = "2026-05-01T06:00:09Z"
        payload.correlation_id = "corr_stmt"

        await handle_statement_generated(mock_db, _build_parsed_event(payload))

        mock_db["notifications"].update_one.assert_called_once()
        doc = mock_db["notifications"].update_one.call_args[0][1]["$set"]
        assert doc["status"] == "statement"
        assert doc["notificationId"] == "ntn_stmt_001"
        assert doc["statement"]["accountId"] == "acc_123"
        assert doc["statement"]["periodStart"] == "2026-04-01"
        assert doc["statement"]["periodEnd"] == "2026-04-30"
        assert doc["statement"]["dispatchedAt"] == "2026-05-01T06:00:09Z"
        assert doc["eventAt"] == "2026-05-01T06:00:09Z"
