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
    triggered_by_transaction_type=None,
):
    event = MagicMock()
    event.payload = MagicMock(
        spec=[
            "account_id",
            "current_balance",
            "status",
            "last_payment_date",
            "last_payment_amount",
            "triggered_by_transaction_type",
        ]
    )
    event.payload.account_id = account_id
    event.payload.current_balance = current_balance
    event.payload.status = status
    event.payload.last_payment_date = last_payment_date
    event.payload.last_payment_amount = last_payment_amount
    event.payload.triggered_by_transaction_type = triggered_by_transaction_type
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


class TestLastPaymentInferenceTriggerType:
    """The inference must only treat balance decreases as customer payments
    when the triggering ledger transaction actually was a repayment.

    Prod incident 2026-08-17: the disbursement-path account.updated.v1
    (balance 52.50 -> 50.00, triggered_by_transaction_type DISBURSEMENT)
    stamped a phantom $2.50 "last payment" on a freshly disbursed account.
    """

    @pytest.mark.asyncio
    async def test_no_inference_when_triggered_by_disbursement(self, mock_pool):
        mock_pool.set_fetchrow(
            {
                "account_status": "pending_disbursement",
                "loan_terms_disbursed_date": None,
                "balances_total_outstanding": 52.5,
            }
        )
        event = _make_updated_event(
            account_id="LA-PMT-DISB",
            current_balance=Decimal("50.00"),
            status="ACTIVE",
            triggered_by_transaction_type="DISBURSEMENT",
        )

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert "last_payment_date" not in update
        assert "last_payment_amount" not in update

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "trigger",
        [
            "ESTABLISHMENT_FEE",
            "LATE_FEE",
            "DISHONOUR_FEE",
            "FEE_WAIVER",
            "ADJUSTMENT",
            "WRITE_OFF",
        ],
    )
    async def test_no_inference_for_non_payment_triggers(self, mock_pool, trigger):
        mock_pool.set_fetchrow(
            {
                "account_status": "active",
                "loan_terms_disbursed_date": datetime(2026, 5, 10),
                "balances_total_outstanding": 100.0,
            }
        )
        event = _make_updated_event(
            account_id="LA-PMT-TRG",
            current_balance=Decimal("90.00"),
            status="ACTIVE",
            triggered_by_transaction_type=trigger,
        )

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert "last_payment_date" not in update
        assert "last_payment_amount" not in update

    @pytest.mark.asyncio
    async def test_inference_still_runs_for_repayment_trigger(self, mock_pool):
        mock_pool.set_fetchrow(
            {
                "account_status": "active",
                "loan_terms_disbursed_date": datetime(2026, 5, 10),
                "balances_total_outstanding": 100.0,
            }
        )
        event = _make_updated_event(
            account_id="LA-PMT-RPY",
            current_balance=Decimal("88.00"),
            status="ACTIVE",
            triggered_by_transaction_type="REPAYMENT",
        )

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["last_payment_amount"] == pytest.approx(12.0)

    @pytest.mark.asyncio
    async def test_inference_still_runs_when_trigger_type_absent(self, mock_pool):
        """Legacy events without the field keep the original behaviour."""
        mock_pool.set_fetchrow(
            {
                "account_status": "active",
                "loan_terms_disbursed_date": datetime(2026, 5, 10),
                "balances_total_outstanding": 100.0,
            }
        )
        event = _make_updated_event(
            account_id="LA-PMT-LEGACY",
            current_balance=Decimal("95.00"),
            status="ACTIVE",
            triggered_by_transaction_type=None,
        )

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["last_payment_amount"] == pytest.approx(5.0)

    @pytest.mark.asyncio
    async def test_enum_prefixed_trigger_type_is_normalised(self, mock_pool):
        """Pydantic enums may stringify as TransactionType.DISBURSEMENT."""
        mock_pool.set_fetchrow(
            {
                "account_status": "active",
                "loan_terms_disbursed_date": datetime(2026, 5, 10),
                "balances_total_outstanding": 52.5,
            }
        )
        event = _make_updated_event(
            account_id="LA-PMT-ENUM",
            current_balance=Decimal("50.00"),
            status="ACTIVE",
            triggered_by_transaction_type="TransactionType.DISBURSEMENT",
        )

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert "last_payment_date" not in update
        assert "last_payment_amount" not in update
