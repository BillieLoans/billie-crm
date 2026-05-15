"""Tests for the last_payment_* inference fallback in handle_account_updated.

The platform's account.updated.v1 event doesn't always carry
``last_payment_date`` — off-schedule and partial repayments commonly omit it.
The handler infers ``last_payment_*`` when the new balance is strictly less
than the previous balance on an active account.
"""

from datetime import datetime
from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from billie_servicing.handlers.account import handle_account_updated


def _make_updated_event(
    account_id: str,
    current_balance,
    status: str | None = None,
    last_payment_date=None,
    last_payment_amount=None,
):
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
    event.payload.account_id = account_id
    event.payload.current_balance = current_balance
    event.payload.status = status
    event.payload.last_payment_date = last_payment_date
    event.payload.last_payment_amount = last_payment_amount
    return event


class TestLastPaymentInference:
    @pytest.mark.asyncio
    async def test_stamps_lastPayment_when_balance_decreases(self, mock_pool):
        mock_pool.set_fetchrow(
            {
                "account_status": "active",
                "loan_terms_disbursed_date": datetime(2026, 5, 10),
                "balances_total_outstanding": 105.0,
            }
        )

        event = _make_updated_event(
            account_id="LA-PMT-001",
            current_balance=Decimal("93.00"),
            status="ACTIVE",
        )
        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert "last_payment_date" in update
        assert isinstance(update["last_payment_date"], datetime)
        assert update["last_payment_amount"] == pytest.approx(12.0)

    @pytest.mark.asyncio
    async def test_does_not_overwrite_event_supplied_lastPayment_date(self, mock_pool):
        mock_pool.set_fetchrow(
            {
                "account_status": "active",
                "loan_terms_disbursed_date": datetime(2026, 5, 10),
                "balances_total_outstanding": 100.0,
            }
        )

        explicit_date = "2026-05-12"
        event = _make_updated_event(
            account_id="LA-PMT-002",
            current_balance=Decimal("80.00"),
            status="ACTIVE",
            last_payment_date=explicit_date,
            last_payment_amount=Decimal("20.00"),
        )
        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        # coerce_date parses "2026-05-12" into a date object.
        assert update["last_payment_date"] is not None
        assert update["last_payment_amount"] == 20.0

    @pytest.mark.asyncio
    async def test_no_lastPayment_when_balance_unchanged(self, mock_pool):
        mock_pool.set_fetchrow(
            {
                "account_status": "active",
                "loan_terms_disbursed_date": datetime(2026, 5, 10),
                "balances_total_outstanding": 50.0,
            }
        )
        event = _make_updated_event(
            account_id="LA-PMT-003",
            current_balance=Decimal("50.00"),
            status="ACTIVE",
        )
        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert "last_payment_date" not in update
        assert "last_payment_amount" not in update

    @pytest.mark.asyncio
    async def test_no_lastPayment_when_balance_increases(self, mock_pool):
        # Late fee — not a payment.
        mock_pool.set_fetchrow(
            {
                "account_status": "active",
                "loan_terms_disbursed_date": datetime(2026, 5, 10),
                "balances_total_outstanding": 50.0,
            }
        )
        event = _make_updated_event(
            account_id="LA-PMT-004",
            current_balance=Decimal("55.00"),
            status="ACTIVE",
        )
        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert "last_payment_date" not in update

    @pytest.mark.asyncio
    async def test_no_lastPayment_inference_for_closure_transition(self, mock_pool):
        mock_pool.set_fetchrow(
            {
                "account_status": "in_arrears",
                "loan_terms_disbursed_date": datetime(2026, 4, 1),
                "balances_total_outstanding": 80.0,
            }
        )
        event = _make_updated_event(
            account_id="LA-PMT-005",
            current_balance=Decimal("0.00"),
            status="CLOSED",
        )
        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "paid_off"
        assert "last_payment_date" not in update
