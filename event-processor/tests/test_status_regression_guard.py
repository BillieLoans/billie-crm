"""Tests for the one-way disbursement gate on account status writes.

Prod incident 2026-08-17 (account VNUR7Z4N8ZLJ): accountsService published
three account.updated.v1 events within ~170ms of disbursement — ACTIVE
(disbursement), PENDING_DISBURSEMENT (establishment fee, carrying a stale
pre-transition snapshot), ACTIVE (final). With two CRM machines consuming the
same Redis group there is no cross-consumer ordering, and the stale
PENDING_DISBURSEMENT event was applied last, reverting an already-disbursed
account and blocking repayments.

The BTB-256 analysis stands: there is no reliable ordering field, so a general
skip-stale guard is impossible. But the disbursement gate is strictly one-way
in the domain — once an account has left PENDING_DISBURSEMENT (money is out
the door), no legitimate transition ever returns it to PENDING or
PENDING_DISBURSEMENT. That narrow regression is therefore safe to block:
when the stored row shows the account is past disbursement (sdk_status
ACTIVE/SUSPENDED/CLOSED, or loan_terms_disbursed_date stamped), an incoming
pre-disbursement status is dropped (warning logged); all other fields in the
same event still apply.
"""

from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
from billie_servicing.handlers.account import (
    handle_account_created,
    handle_account_status_changed,
    handle_account_updated,
)
from structlog.testing import capture_logs

DISBURSED_AT = datetime(2026, 8, 17, 5, 30, 50, tzinfo=UTC)


def _updated_event(status, current_balance=Decimal("52.50")):
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
    event.payload.account_id = "ACC-GATE-001"
    event.payload.current_balance = current_balance
    event.payload.status = status
    event.payload.last_payment_date = None
    event.payload.last_payment_amount = None
    return event


def _status_changed_event(new_status):
    event = MagicMock()
    event.payload = MagicMock(spec=["account_id", "new_status"])
    event.payload.account_id = "ACC-GATE-001"
    event.payload.new_status = new_status
    return event


def _created_event(status):
    event = MagicMock()
    event.payload = MagicMock(
        spec=[
            "account_id",
            "customer_id",
            "account_number",
            "status",
            "loan_amount",
            "loan_fee",
            "loan_total_payable",
            "opened_date",
            "current_balance",
        ]
    )
    event.payload.account_id = "ACC-GATE-001"
    event.payload.customer_id = "CUST-1"
    event.payload.account_number = "VNUR7Z4N8ZLJ"
    event.payload.status = status
    event.payload.loan_amount = Decimal("50.00")
    event.payload.loan_fee = Decimal("2.50")
    event.payload.loan_total_payable = Decimal("52.50")
    event.payload.opened_date = "2026-08-16T23:25:51Z"
    event.payload.current_balance = Decimal("52.50")
    return event


def _disbursed_row(**overrides):
    row = {
        "account_status": "active",
        "sdk_status": "ACTIVE",
        "loan_terms_disbursed_date": DISBURSED_AT,
        "balances_total_outstanding": 52.5,
        "updated_at": DISBURSED_AT,
    }
    row.update(overrides)
    return row


class TestAccountUpdatedRegressionGuard:
    @pytest.mark.asyncio
    async def test_stale_pending_disbursement_does_not_revert_disbursed_account(
        self, mock_pool
    ):
        """The prod repro: fee event with a stale PENDING_DISBURSEMENT snapshot
        arrives after the account was already projected ACTIVE."""
        mock_pool.set_fetchrow(_disbursed_row())
        event = _updated_event(status="PENDING_DISBURSEMENT")

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update is not None
        assert "account_status" not in update
        assert "sdk_status" not in update

    @pytest.mark.asyncio
    async def test_other_fields_still_apply_when_status_regression_dropped(
        self, mock_pool
    ):
        mock_pool.set_fetchrow(_disbursed_row(balances_total_outstanding=52.5))
        event = _updated_event(
            status="PENDING_DISBURSEMENT", current_balance=Decimal("47.50")
        )

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["balances_current_balance"] == 47.50
        assert update["balances_total_outstanding"] == 47.50

    @pytest.mark.asyncio
    async def test_regression_drop_logs_warning(self, mock_pool):
        mock_pool.set_fetchrow(_disbursed_row())
        event = _updated_event(status="PENDING_DISBURSEMENT")

        with capture_logs() as captured:
            await handle_account_updated(mock_pool, event)

        warnings = [e for e in captured if e.get("log_level") == "warning"]
        assert any(
            "regression" in str(e.get("event", "")).lower() for e in warnings
        ), f"expected a status-regression warning, got: {captured}"

    @pytest.mark.asyncio
    async def test_pending_disbursement_applies_when_not_yet_disbursed(self, mock_pool):
        """Forward transition SDK PENDING -> PENDING_DISBURSEMENT must not be blocked."""
        mock_pool.set_fetchrow(
            _disbursed_row(
                account_status="active",
                sdk_status="PENDING",
                loan_terms_disbursed_date=None,
            )
        )
        event = _updated_event(status="PENDING_DISBURSEMENT")

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "pending_disbursement"
        assert update["sdk_status"] == "PENDING_DISBURSEMENT"

    @pytest.mark.asyncio
    async def test_regression_blocked_by_disbursed_date_when_sdk_status_missing(
        self, mock_pool
    ):
        """Legacy rows may predate the sdk_status column — the stamped
        disbursed_date alone is proof the account is past the gate."""
        mock_pool.set_fetchrow(_disbursed_row(sdk_status=None))
        event = _updated_event(status="PENDING_DISBURSEMENT")

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert "account_status" not in update
        assert "sdk_status" not in update

    @pytest.mark.asyncio
    async def test_active_status_still_applies_to_pending_disbursement_row(
        self, mock_pool
    ):
        """The normal disbursement transition is unaffected by the guard."""
        mock_pool.set_fetchrow(
            _disbursed_row(
                account_status="pending_disbursement",
                sdk_status="PENDING_DISBURSEMENT",
                loan_terms_disbursed_date=None,
            )
        )
        event = _updated_event(status="ACTIVE")

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "active"
        assert update["sdk_status"] == "ACTIVE"

    @pytest.mark.asyncio
    async def test_status_applies_when_no_existing_row(self, mock_pool):
        mock_pool.set_fetchrow(None)
        event = _updated_event(status="PENDING_DISBURSEMENT")

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "pending_disbursement"


class TestStatusChangedRegressionGuard:
    @pytest.mark.asyncio
    async def test_stale_pending_disbursement_status_change_is_ignored(self, mock_pool):
        mock_pool.set_fetchrow(_disbursed_row())
        event = _status_changed_event("PENDING_DISBURSEMENT")

        with capture_logs() as captured:
            await handle_account_status_changed(mock_pool, event)

        assert mock_pool.last_update("loan_accounts") is None
        warnings = [e for e in captured if e.get("log_level") == "warning"]
        assert warnings, "expected a status-regression warning"

    @pytest.mark.asyncio
    async def test_forward_status_change_still_applies(self, mock_pool):
        mock_pool.set_fetchrow(
            _disbursed_row(
                account_status="pending_disbursement",
                sdk_status="PENDING_DISBURSEMENT",
                loan_terms_disbursed_date=None,
            )
        )
        event = _status_changed_event("ACTIVE")

        await handle_account_status_changed(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "active"


class TestAccountCreatedRegressionGuard:
    @pytest.mark.asyncio
    async def test_replayed_created_event_does_not_revert_disbursed_account(
        self, mock_pool
    ):
        """account.created.v1 redelivered after disbursement (e.g. a stream
        replay/backfill) carries the original PENDING_DISBURSEMENT snapshot and
        must not regress the status either."""
        mock_pool.set_fetchrow(_disbursed_row())
        event = _created_event(status="PENDING_DISBURSEMENT")

        await handle_account_created(mock_pool, event)

        upsert = mock_pool.last_upsert("loan_accounts")
        assert upsert is not None
        assert "account_status" not in upsert
        assert "sdk_status" not in upsert

    @pytest.mark.asyncio
    async def test_created_event_for_new_account_keeps_status(self, mock_pool):
        mock_pool.set_fetchrow(None)
        event = _created_event(status="PENDING_DISBURSEMENT")

        await handle_account_created(mock_pool, event)

        upsert = mock_pool.last_upsert("loan_accounts")
        assert upsert["account_status"] == "pending_disbursement"
        assert upsert["sdk_status"] == "PENDING_DISBURSEMENT"
