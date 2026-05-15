"""Unit tests for notification event handlers.

Covers the four platform → CRM read-only projections:
- notification.sent.v1
- notification.delivery_failed.v1
- notification.suppression.changed.v1
- statement.generated.v1
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from billie_servicing.handlers.notification import (
    handle_notification_delivery_failed,
    handle_notification_sent,
    handle_notification_suppression_changed,
    handle_statement_generated,
)


def _dt(iso: str) -> datetime:
    """Parse an ISO 8601 string the same way the handler's _coerce_dt does."""
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _build_parsed_event(payload: MagicMock, cause: str = "") -> MagicMock:
    parsed = MagicMock()
    parsed.payload = payload
    parsed.cause = cause
    parsed.conv = ""
    return parsed


class TestNotificationSentHandler:
    @pytest.mark.asyncio
    async def test_sent_event_upserts_document(self, mock_pool):
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

        await handle_notification_sent(mock_pool, _build_parsed_event(payload))

        inserts = mock_pool.inserts_into("notifications")
        assert len(inserts) == 1
        doc = inserts[0]

        # Upsert conflict target is notification_id (natural key).
        call = mock_pool.calls_against("notifications")[0]
        assert call.conflict_columns == ["notification_id"]

        assert doc["notification_id"] == "ntn_001"
        assert doc["status"] == "sent"
        assert doc["channel"] == "email"
        assert doc["template_name"] == "pre_due_email_first"
        assert doc["template_content_hash"] == "a4f3c21abcdef"
        assert doc["sent_at"] == _dt("2026-05-11T03:14:09Z")
        assert doc["event_at"] == _dt("2026-05-11T03:14:09Z")
        assert doc["tags_category"] == "servicing"
        assert doc["tags_reason"] == "pre_due"
        assert doc["tags_step"] == 0
        assert "created_at" in doc  # set on INSERT
        # ``created_at`` is insert-only — must not be in the DO UPDATE SET clause.
        assert "EXCLUDED.created_at" not in call.sql

    @pytest.mark.asyncio
    async def test_sent_event_resolves_customer_link(self, mock_pool):
        # The handler calls SELECT id FROM customers WHERE customer_id = $1
        # via _resolve_customer_link. Make that return a uuid.
        mock_pool.set_fetchval("pg-customer-uuid")

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

        await handle_notification_sent(mock_pool, _build_parsed_event(payload))

        doc = mock_pool.last_insert("notifications")
        assert doc["customer_ref_id"] == "pg-customer-uuid"
        assert doc["customer_id"] == "cust_abc"


class TestNotificationDeliveryFailedHandler:
    @staticmethod
    def _build_failed_payload(error_type: str, fallback_suggested: str | None = None) -> MagicMock:
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

    @pytest.mark.asyncio
    async def test_failed_event_maps_to_failed_status(self, mock_pool):
        payload = self._build_failed_payload(error_type="permanent")
        await handle_notification_delivery_failed(mock_pool, _build_parsed_event(payload))

        doc = mock_pool.last_insert("notifications")
        assert doc["status"] == "failed"
        assert doc["failure_error_type"] == "permanent"
        assert doc["failure_error_message"] == "Recipient invalid"
        assert doc["failure_attempt"] == 3
        assert doc["failure_fallback_suggested"] is None

    @pytest.mark.asyncio
    async def test_suppressed_error_maps_to_blocked_status(self, mock_pool):
        payload = self._build_failed_payload(error_type="suppressed")
        await handle_notification_delivery_failed(mock_pool, _build_parsed_event(payload))

        doc = mock_pool.last_insert("notifications")
        assert doc["status"] == "blocked"
        assert doc["failure_error_type"] == "suppressed"

    @pytest.mark.asyncio
    async def test_contact_missing_with_fallback(self, mock_pool):
        payload = self._build_failed_payload(error_type="contact_missing", fallback_suggested="sms")
        await handle_notification_delivery_failed(mock_pool, _build_parsed_event(payload))

        doc = mock_pool.last_insert("notifications")
        assert doc["status"] == "failed"
        assert doc["failure_fallback_suggested"] == "sms"


class TestNotificationSuppressionChangedHandler:
    @pytest.mark.asyncio
    async def test_paused_event_keyed_on_envelope_cause(self, mock_pool):
        payload = MagicMock()
        payload.customer_id = "cust_abc"
        payload.mode = "non_essential"
        payload.reason = "Hardship plan #4521"
        payload.set_by = "agent:rohan@billie.loans"
        payload.set_at = "2026-05-11T11:55:17Z"
        payload.expires_at = "2026-06-10T11:55:17Z"
        payload.correlation_id = "corr-1"

        await handle_notification_suppression_changed(
            mock_pool, _build_parsed_event(payload, cause="1778500517032-0")
        )

        doc = mock_pool.last_insert("notifications")
        assert doc["notification_id"] == "suppression:1778500517032-0"
        assert doc["status"] == "suppression_change"
        assert doc["customer_id"] == "cust_abc"
        assert doc["event_at"] == _dt("2026-05-11T11:55:17Z")
        assert doc["suppression_mode"] == "non_essential"
        assert doc["suppression_reason"] == "Hardship plan #4521"
        assert doc["suppression_set_by"] == "agent:rohan@billie.loans"
        assert doc["suppression_expires_at"] == _dt("2026-06-10T11:55:17Z")

    @pytest.mark.asyncio
    async def test_clear_event_records_mode_off(self, mock_pool):
        payload = MagicMock()
        payload.customer_id = "cust_abc"
        payload.mode = "off"
        payload.reason = ""
        payload.set_by = "agent:rohan@billie.loans"
        payload.set_at = "2026-05-11T12:00:00Z"
        payload.expires_at = None
        payload.correlation_id = None

        await handle_notification_suppression_changed(
            mock_pool, _build_parsed_event(payload, cause="evt-clear")
        )

        doc = mock_pool.last_insert("notifications")
        assert doc["suppression_mode"] == "off"
        assert doc["suppression_expires_at"] is None
        # Empty reason normalises to None so the UI can branch on it cleanly.
        assert doc["suppression_reason"] is None

    @pytest.mark.asyncio
    async def test_falls_back_to_synthetic_id_when_cause_missing(self, mock_pool):
        payload = MagicMock()
        payload.customer_id = "cust_xyz"
        payload.mode = "all"
        payload.reason = "Legal hold"
        payload.set_by = "agent:legal@billie.loans"
        payload.set_at = "2026-05-11T13:00:00Z"
        payload.expires_at = None
        payload.correlation_id = None

        await handle_notification_suppression_changed(
            mock_pool, _build_parsed_event(payload, cause="")
        )

        doc = mock_pool.last_insert("notifications")
        # The fallback uses the coerced datetime's ISO format, which keeps a
        # +00:00 offset rather than a trailing 'Z'.
        expected_iso = _dt("2026-05-11T13:00:00Z").isoformat()
        assert doc["notification_id"] == f"suppression:cust_xyz:{expected_iso}"


class TestStatementGeneratedHandler:
    @pytest.mark.asyncio
    async def test_statement_event_creates_statement_doc(self, mock_pool):
        payload = MagicMock()
        payload.notification_id = "ntn_stmt_001"
        payload.account_id = "acc_123"
        payload.customer_id = "cust_abc"
        payload.period_start = "2026-04-01"
        payload.period_end = "2026-04-30"
        payload.dispatched_at = "2026-05-01T06:00:09Z"
        payload.correlation_id = "corr_stmt"

        await handle_statement_generated(mock_pool, _build_parsed_event(payload))

        doc = mock_pool.last_insert("notifications")
        assert doc["status"] == "statement"
        assert doc["notification_id"] == "ntn_stmt_001"
        assert doc["statement_account_id"] == "acc_123"
        assert doc["statement_period_start"] == _dt("2026-04-01")
        assert doc["statement_period_end"] == _dt("2026-04-30")
        assert doc["statement_dispatched_at"] == _dt("2026-05-01T06:00:09Z")
        assert doc["event_at"] == _dt("2026-05-01T06:00:09Z")
