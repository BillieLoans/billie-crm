"""Tests for the pending_disbursement → active transition.

When an account transitions from pending_disbursement to active (either via
an explicit account.status_changed.v1 event or via a balance-inferred
account.updated.v1), the handler stamps `loan_terms_disbursed_date`. This
drives the "Disbursed today" Smart View. Idempotent — never overwrite.
"""

from datetime import datetime
from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from billie_servicing.handlers.account import (
    handle_account_status_changed,
    handle_account_updated,
)


class TestStatusChangedDisbursement:
    @pytest.mark.asyncio
    async def test_stamps_disbursedDate_on_pending_to_active(self, mock_pool):
        # Existing row says pending_disbursement, no disbursed_date yet.
        mock_pool.set_fetchrow(
            {"account_status": "pending_disbursement", "loan_terms_disbursed_date": None}
        )

        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "LA-DISB-001"
        event.payload.new_status = "ACTIVE"

        await handle_account_status_changed(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "active"
        assert "loan_terms_disbursed_date" in update
        assert isinstance(update["loan_terms_disbursed_date"], datetime)

    @pytest.mark.asyncio
    async def test_preserves_existing_disbursedDate_on_replay(self, mock_pool):
        prior = datetime(2026, 5, 13, 9, 30)
        mock_pool.set_fetchrow(
            {"account_status": "pending_disbursement", "loan_terms_disbursed_date": prior}
        )

        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "LA-REPLAY"
        event.payload.new_status = "ACTIVE"

        await handle_account_status_changed(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert "loan_terms_disbursed_date" not in update

    @pytest.mark.asyncio
    async def test_no_disbursedDate_when_previous_status_was_not_pending(self, mock_pool):
        # in_arrears → active is a re-activation, not a disbursement.
        mock_pool.set_fetchrow(
            {"account_status": "in_arrears", "loan_terms_disbursed_date": None}
        )

        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "LA-REACT"
        event.payload.new_status = "ACTIVE"

        await handle_account_status_changed(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert "loan_terms_disbursed_date" not in update


class TestAccountUpdatedDisbursement:
    @pytest.mark.asyncio
    async def test_stamps_disbursedDate_on_balance_inferred_transition(self, mock_pool):
        mock_pool.set_fetchrow(
            {
                "account_status": "pending_disbursement",
                "loan_terms_disbursed_date": None,
                "balances_total_outstanding": 0.0,
            }
        )

        event = MagicMock()
        event.payload = MagicMock(
            spec=["account_id", "current_balance", "status",
                  "last_payment_date", "last_payment_amount"]
        )
        event.payload.account_id = "LA-INFER"
        event.payload.current_balance = Decimal("100.00")
        event.payload.status = None
        event.payload.last_payment_date = None
        event.payload.last_payment_amount = None

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "active"
        assert "loan_terms_disbursed_date" in update
        assert isinstance(update["loan_terms_disbursed_date"], datetime)

    @pytest.mark.asyncio
    async def test_stamps_disbursedDate_on_explicit_status_transition(self, mock_pool):
        mock_pool.set_fetchrow(
            {
                "account_status": "pending_disbursement",
                "loan_terms_disbursed_date": None,
                "balances_total_outstanding": 0.0,
            }
        )

        event = MagicMock()
        event.payload = MagicMock(
            spec=["account_id", "current_balance", "status",
                  "last_payment_date", "last_payment_amount"]
        )
        event.payload.account_id = "LA-EXPLICIT"
        event.payload.current_balance = Decimal("100.00")
        event.payload.status = "ACTIVE"
        event.payload.last_payment_date = None
        event.payload.last_payment_amount = None

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "active"
        assert "loan_terms_disbursed_date" in update

    @pytest.mark.asyncio
    async def test_no_disbursedDate_when_already_active(self, mock_pool):
        mock_pool.set_fetchrow(
            {
                "account_status": "active",
                "loan_terms_disbursed_date": datetime(2026, 4, 5),
                "balances_total_outstanding": 100.0,
            }
        )

        event = MagicMock()
        event.payload = MagicMock(
            spec=["account_id", "current_balance", "status",
                  "last_payment_date", "last_payment_amount"]
        )
        event.payload.account_id = "LA-ALREADY-ACTIVE"
        event.payload.current_balance = Decimal("80.00")
        event.payload.status = "ACTIVE"
        event.payload.last_payment_date = None
        event.payload.last_payment_amount = None

        await handle_account_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert "loan_terms_disbursed_date" not in update
