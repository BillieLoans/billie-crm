"""
Tests for the `lastPayment` inference fallback in handle_account_updated.

The platform's `account.updated.v1` event doesn't always carry
`last_payment_date` — off-schedule and partial repayments commonly omit it
because no scheduled row matched. Without intervention the CRM's
"Last payment" column shows "Never" forever for those accounts.

This handler infers a lastPayment stamp when the new balance is strictly
less than the previous balance on an active account, treating the event's
processing time as a proxy for the payment time.
"""

import pytest
from datetime import datetime
from decimal import Decimal
from unittest.mock import MagicMock

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
    async def test_stamps_lastPayment_when_balance_decreases(self, mock_db):
        # Active account, $105 → $93. SDK didn't include last_payment_date.
        mock_db["loan-accounts"].find_one.return_value = {
            "loanAccountId": "LA-PMT-001",
            "accountStatus": "active",
            "balances": {"totalOutstanding": 105.0},
            "loanTerms": {"openedDate": "2026-05-10"},
        }

        event = _make_updated_event(
            account_id="LA-PMT-001",
            current_balance=Decimal("93.00"),
            status="ACTIVE",
        )

        await handle_account_updated(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        assert "lastPayment.date" in set_doc
        assert isinstance(set_doc["lastPayment.date"], datetime)
        # Delta is the inferred payment amount.
        assert set_doc["lastPayment.amount"] == pytest.approx(12.0)

    @pytest.mark.asyncio
    async def test_does_not_overwrite_event_supplied_lastPayment_date(self, mock_db):
        mock_db["loan-accounts"].find_one.return_value = {
            "loanAccountId": "LA-PMT-002",
            "accountStatus": "active",
            "balances": {"totalOutstanding": 100.0},
            "loanTerms": {"openedDate": "2026-05-10"},
        }

        explicit_date = "2026-05-12"
        event = _make_updated_event(
            account_id="LA-PMT-002",
            current_balance=Decimal("80.00"),
            status="ACTIVE",
            last_payment_date=explicit_date,
            last_payment_amount=Decimal("20.00"),
        )

        await handle_account_updated(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        # The explicit date wins; we don't overwrite with utcnow().
        assert set_doc["lastPayment.date"] == explicit_date
        assert set_doc["lastPayment.amount"] == 20.0

    @pytest.mark.asyncio
    async def test_no_lastPayment_when_balance_unchanged(self, mock_db):
        mock_db["loan-accounts"].find_one.return_value = {
            "loanAccountId": "LA-PMT-003",
            "accountStatus": "active",
            "balances": {"totalOutstanding": 50.0},
            "loanTerms": {"openedDate": "2026-05-10"},
        }

        event = _make_updated_event(
            account_id="LA-PMT-003",
            current_balance=Decimal("50.00"),
            status="ACTIVE",
        )

        await handle_account_updated(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        assert "lastPayment.date" not in set_doc
        assert "lastPayment.amount" not in set_doc

    @pytest.mark.asyncio
    async def test_no_lastPayment_when_balance_increases(self, mock_db):
        # E.g. a late fee added — not a payment.
        mock_db["loan-accounts"].find_one.return_value = {
            "loanAccountId": "LA-PMT-004",
            "accountStatus": "active",
            "balances": {"totalOutstanding": 50.0},
            "loanTerms": {"openedDate": "2026-05-10"},
        }

        event = _make_updated_event(
            account_id="LA-PMT-004",
            current_balance=Decimal("55.00"),
            status="ACTIVE",
        )

        await handle_account_updated(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        assert "lastPayment.date" not in set_doc

    @pytest.mark.asyncio
    async def test_no_lastPayment_inference_for_closure_transition(self, mock_db):
        # Account being written off — balance may decrease to 0 but it's not a
        # payment. Closure is handled by handle_account_closed; here we receive
        # a status update via account.updated.v1 saying CLOSED.
        mock_db["loan-accounts"].find_one.return_value = {
            "loanAccountId": "LA-PMT-005",
            "accountStatus": "in_arrears",
            "balances": {"totalOutstanding": 80.0},
            "loanTerms": {"openedDate": "2026-04-01"},
        }

        event = _make_updated_event(
            account_id="LA-PMT-005",
            current_balance=Decimal("0.00"),
            status="CLOSED",
        )

        await handle_account_updated(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        # accountStatus maps to paid_off for CLOSED — fallback is skipped.
        assert set_doc["accountStatus"] == "paid_off"
        assert "lastPayment.date" not in set_doc
