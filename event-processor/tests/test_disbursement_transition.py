"""
Tests for the pending_disbursement → active transition.

When an account transitions from `pending_disbursement` to `active` (either
via an explicit account.status_changed.v1 event or via a balance-inferred
account.updated.v1), the handler stamps `loanTerms.disbursedDate`. This is
what drives the "Disbursed today" Smart View in the CRM's accounts browser.

These tests cover both code paths and the idempotency guarantee (we never
overwrite an existing disbursedDate).
"""

import pytest
from datetime import datetime
from decimal import Decimal
from unittest.mock import MagicMock

from billie_servicing.handlers.account import (
    handle_account_status_changed,
    handle_account_updated,
)


class TestStatusChangedDisbursement:
    """handle_account_status_changed sets disbursedDate when pending → active."""

    @pytest.mark.asyncio
    async def test_stamps_disbursedDate_on_pending_to_active(self, mock_db):
        # Existing doc says pending_disbursement, no disbursedDate yet.
        mock_db["loan-accounts"].find_one.return_value = {
            "loanAccountId": "LA-DISB-001",
            "accountStatus": "pending_disbursement",
            "loanTerms": {"openedDate": "2026-05-10"},
        }

        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "LA-DISB-001"
        event.payload.new_status = "ACTIVE"

        await handle_account_status_changed(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        assert set_doc["accountStatus"] == "active"
        assert "loanTerms.disbursedDate" in set_doc
        assert isinstance(set_doc["loanTerms.disbursedDate"], datetime)

    @pytest.mark.asyncio
    async def test_preserves_existing_disbursedDate_on_replay(self, mock_db):
        prior = datetime(2026, 5, 13, 9, 30)
        mock_db["loan-accounts"].find_one.return_value = {
            "loanAccountId": "LA-REPLAY",
            "accountStatus": "pending_disbursement",
            "loanTerms": {"openedDate": "2026-05-10", "disbursedDate": prior},
        }

        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "LA-REPLAY"
        event.payload.new_status = "ACTIVE"

        await handle_account_status_changed(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        # No overwrite — leaves the existing disbursedDate alone.
        assert "loanTerms.disbursedDate" not in set_doc

    @pytest.mark.asyncio
    async def test_no_disbursedDate_when_previous_status_was_not_pending(self, mock_db):
        # SUSPENDED → ACTIVE is not a disbursement; it's a re-activation.
        mock_db["loan-accounts"].find_one.return_value = {
            "loanAccountId": "LA-REACT",
            "accountStatus": "in_arrears",
            "loanTerms": {"openedDate": "2026-04-01"},
        }

        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "LA-REACT"
        event.payload.new_status = "ACTIVE"

        await handle_account_status_changed(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        assert "loanTerms.disbursedDate" not in set_doc


class TestAccountUpdatedDisbursement:
    """handle_account_updated stamps disbursedDate on the inferred transition."""

    @pytest.mark.asyncio
    async def test_stamps_disbursedDate_on_balance_inferred_transition(self, mock_db):
        mock_db["loan-accounts"].find_one.return_value = {
            "loanAccountId": "LA-INFER",
            "accountStatus": "pending_disbursement",
            "loanTerms": {"openedDate": "2026-05-10"},
        }

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
        event.payload.account_id = "LA-INFER"
        event.payload.current_balance = Decimal("100.00")
        event.payload.status = None  # status omitted — must infer
        event.payload.last_payment_date = None
        event.payload.last_payment_amount = None

        await handle_account_updated(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        assert set_doc["accountStatus"] == "active"
        assert "loanTerms.disbursedDate" in set_doc
        assert isinstance(set_doc["loanTerms.disbursedDate"], datetime)

    @pytest.mark.asyncio
    async def test_stamps_disbursedDate_on_explicit_status_transition(self, mock_db):
        # status=ACTIVE supplied directly, but previous status was pending.
        mock_db["loan-accounts"].find_one.return_value = {
            "loanAccountId": "LA-EXPLICIT",
            "accountStatus": "pending_disbursement",
            "loanTerms": {"openedDate": "2026-05-10"},
        }

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
        event.payload.account_id = "LA-EXPLICIT"
        event.payload.current_balance = Decimal("100.00")
        event.payload.status = "ACTIVE"
        event.payload.last_payment_date = None
        event.payload.last_payment_amount = None

        await handle_account_updated(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        assert set_doc["accountStatus"] == "active"
        assert "loanTerms.disbursedDate" in set_doc

    @pytest.mark.asyncio
    async def test_no_disbursedDate_when_already_active(self, mock_db):
        # An already-active account receiving a balance update is not a disbursement.
        mock_db["loan-accounts"].find_one.return_value = {
            "loanAccountId": "LA-ALREADY-ACTIVE",
            "accountStatus": "active",
            "loanTerms": {"openedDate": "2026-04-01", "disbursedDate": datetime(2026, 4, 5)},
        }

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
        event.payload.account_id = "LA-ALREADY-ACTIVE"
        event.payload.current_balance = Decimal("80.00")
        event.payload.status = "ACTIVE"
        event.payload.last_payment_date = None
        event.payload.last_payment_amount = None

        await handle_account_updated(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        assert "loanTerms.disbursedDate" not in set_doc
