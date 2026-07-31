"""Tests for the account.updated.v1 ordering/staleness guard (BTB-256 crm half).

Investigation summary (see task-40-report.md for full evidence): account.updated.v1
carries NO reliable monotonic ordering field as it reaches the crm event-processor:

- ``triggered_by_transaction_id`` is an opaque ``str`` -- usually the ledger's
  globally-incrementing ``TXN-YYYY-NNNNNNNN`` id, but on the disbursement path
  (accountsService.event_handlers._publish_account_updated_event_from_disbursement)
  it falls back to a ``conversation_id`` (a completely different, non-sortable ID
  shape) when ``disbursement_transaction_id`` is absent from the payload.
- The chatLedger envelope's ``seq`` field is hardcoded to ``1`` for every domain
  event (``ChatLedgerPublisher.publish_event``'s ``"seq": 1, # Always 1 for
  domain events``) -- accountsService never passes an explicit ``seq`` when
  publishing ``account.updated.v1``, so it is useless for ordering.

Given no reliable ordering field, the guard is LOG-ONLY: it compares the
payload's own (wall-clock, non-authoritative) ``timestamp`` against the stored
projection's ``updated_at`` and logs a staleness warning when the incoming
event looks older -- but ALWAYS still applies the write. This mirrors the DLQ
``extra_original_event_timestamp`` staleness-triage convention established by
Task 39/BTB-256 (platform half): timestamp is informational only, never
authoritative for ordering or skip decisions.
"""

from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
from billie_servicing.handlers.account import handle_account_updated
from structlog.testing import capture_logs


def _make_event(
    account_id: str = "ACC-ORDER-001",
    current_balance=Decimal("100.00"),
    status=None,
    timestamp=None,
):
    event = MagicMock()
    event.payload = MagicMock(
        spec=[
            "account_id",
            "current_balance",
            "status",
            "last_payment_date",
            "last_payment_amount",
            "timestamp",
        ]
    )
    event.payload.account_id = account_id
    event.payload.current_balance = current_balance
    event.payload.status = status
    event.payload.last_payment_date = None
    event.payload.last_payment_amount = None
    event.payload.timestamp = timestamp
    return event


class TestAccountUpdatedStalenessWarning:
    @pytest.mark.asyncio
    async def test_logs_warning_when_incoming_timestamp_older_than_stored(self, mock_pool):
        stored_updated_at = datetime(2026, 7, 30, 12, 0, 0, tzinfo=UTC)
        mock_pool.set_fetchrow(
            {
                "account_status": "active",
                "loan_terms_disbursed_date": None,
                "balances_total_outstanding": 50.0,
                "updated_at": stored_updated_at,
            }
        )
        incoming_timestamp = datetime(2026, 7, 30, 10, 0, 0, tzinfo=UTC)  # older
        event = _make_event(
            current_balance=Decimal("50.00"),  # unchanged -- isolate the staleness path
            timestamp=incoming_timestamp,
        )

        with capture_logs() as captured:
            await handle_account_updated(mock_pool, event)

        warnings = [e for e in captured if e.get("log_level") == "warning"]
        assert warnings, f"expected a staleness warning to be logged, got: {captured}"
        warning = warnings[0]
        assert warning["incoming_event_timestamp"] == incoming_timestamp.isoformat()
        assert warning["stored_updated_at"] == stored_updated_at.isoformat()

    @pytest.mark.asyncio
    async def test_still_applies_write_when_incoming_timestamp_older_than_stored(self, mock_pool):
        """Log-only means log-only -- the projection write must still happen."""
        stored_updated_at = datetime(2026, 7, 30, 12, 0, 0, tzinfo=UTC)
        mock_pool.set_fetchrow(
            {
                "account_status": "active",
                "loan_terms_disbursed_date": None,
                "balances_total_outstanding": 50.0,
                "updated_at": stored_updated_at,
            }
        )
        incoming_timestamp = datetime(2026, 7, 30, 10, 0, 0, tzinfo=UTC)  # older
        event = _make_event(
            current_balance=Decimal("42.00"),
            timestamp=incoming_timestamp,
        )

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update is not None
        assert update["balances_current_balance"] == 42.00

    @pytest.mark.asyncio
    async def test_no_warning_when_incoming_timestamp_newer_than_stored(self, mock_pool):
        stored_updated_at = datetime(2026, 7, 30, 10, 0, 0, tzinfo=UTC)
        mock_pool.set_fetchrow(
            {
                "account_status": "active",
                "loan_terms_disbursed_date": None,
                "balances_total_outstanding": 50.0,
                "updated_at": stored_updated_at,
            }
        )
        incoming_timestamp = datetime(2026, 7, 30, 12, 0, 0, tzinfo=UTC)  # newer
        event = _make_event(
            current_balance=Decimal("50.00"),
            timestamp=incoming_timestamp,
        )

        with capture_logs() as captured:
            await handle_account_updated(mock_pool, event)

        warnings = [e for e in captured if e.get("log_level") == "warning"]
        assert not warnings, f"unexpected staleness warning for a newer event: {warnings}"

    @pytest.mark.asyncio
    async def test_no_warning_when_no_existing_row(self, mock_pool):
        """New account (no prior projection row) -- nothing to compare against."""
        mock_pool.set_fetchrow(None)
        event = _make_event(
            current_balance=Decimal("50.00"),
            timestamp=datetime(2026, 7, 30, 10, 0, 0, tzinfo=UTC),
        )

        with capture_logs() as captured:
            await handle_account_updated(mock_pool, event)

        warnings = [e for e in captured if e.get("log_level") == "warning"]
        assert not warnings

    @pytest.mark.asyncio
    async def test_no_crash_when_payload_has_no_timestamp_field(self, mock_pool):
        """Older SDK payloads without `timestamp` must not break the handler."""
        mock_pool.set_fetchrow(
            {
                "account_status": "active",
                "loan_terms_disbursed_date": None,
                "balances_total_outstanding": 50.0,
                "updated_at": datetime(2026, 7, 30, 12, 0, 0, tzinfo=UTC),
            }
        )
        event = MagicMock()
        event.payload = MagicMock(
            spec=[
                "account_id",
                "current_balance",
                "status",
                "last_payment_date",
                "last_payment_amount",
            ]
        )
        event.payload.account_id = "ACC-NO-TS"
        event.payload.current_balance = Decimal("50.00")
        event.payload.status = None
        event.payload.last_payment_date = None
        event.payload.last_payment_amount = None

        with capture_logs() as captured:
            await handle_account_updated(mock_pool, event)

        warnings = [e for e in captured if e.get("log_level") == "warning"]
        assert not warnings
        assert mock_pool.last_update("loan_accounts") is not None

    @pytest.mark.asyncio
    async def test_no_crash_when_stored_updated_at_missing_from_row(self, mock_pool):
        """Existing rows selected before this guard shipped may lack the column
        in test doubles / older query shapes -- must degrade gracefully."""
        mock_pool.set_fetchrow(
            {
                "account_status": "active",
                "loan_terms_disbursed_date": None,
                "balances_total_outstanding": 50.0,
                # no "updated_at" key
            }
        )
        event = _make_event(
            current_balance=Decimal("50.00"),
            timestamp=datetime(2026, 7, 30, 10, 0, 0, tzinfo=UTC),
        )

        with capture_logs() as captured:
            await handle_account_updated(mock_pool, event)

        warnings = [e for e in captured if e.get("log_level") == "warning"]
        assert not warnings
        assert mock_pool.last_update("loan_accounts") is not None
