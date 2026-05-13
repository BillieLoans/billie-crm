"""
Tests for the loan.aging.updated.v1 handler.

The handler projects the aging service's authoritative `is_in_arrears`
flag onto the LoanAccount document. We exercise:
  - The happy path (all fields present from aging-v1.1.0)
  - The derived fallback (older publishers without `is_in_arrears`)
  - Bucket-only / DPD-only variations
"""

import pytest
from unittest.mock import MagicMock

from billie_servicing.handlers.aging import handle_loan_aging_updated


def _make_event(account_id="LA-001", bucket="late_arrears", dpd=23, is_in_arrears=True,
                last_updated=None):
    """Construct a MagicMock parsed event matching the LoanAgingUpdatedV1 shape."""
    event = MagicMock()
    event.payload = MagicMock()
    event.payload.account_id = account_id
    event.payload.bucket = bucket
    event.payload.dpd = dpd
    event.payload.is_in_arrears = is_in_arrears
    event.payload.last_updated = last_updated
    return event


class TestLoanAgingUpdated:
    @pytest.mark.asyncio
    async def test_writes_isInArrears_and_bucket_and_dpd(self, mock_db):
        event = _make_event(
            account_id="LA-AGING-001",
            bucket="late_arrears",
            dpd=23,
            is_in_arrears=True,
        )
        await handle_loan_aging_updated(mock_db, event)

        mock_db["loan-accounts"].update_one.assert_called_once()
        filter_q, update_q = mock_db["loan-accounts"].update_one.call_args[0]
        assert filter_q == {"loanAccountId": "LA-AGING-001"}
        set_doc = update_q["$set"]
        assert set_doc["aging.isInArrears"] is True
        assert set_doc["aging.bucket"] == "late_arrears"
        assert set_doc["aging.currentDPD"] == 23
        assert "aging.lastUpdated" in set_doc

    @pytest.mark.asyncio
    async def test_current_bucket_marks_not_in_arrears(self, mock_db):
        event = _make_event(bucket="current", dpd=0, is_in_arrears=False)
        await handle_loan_aging_updated(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        assert set_doc["aging.isInArrears"] is False
        assert set_doc["aging.bucket"] == "current"

    @pytest.mark.asyncio
    async def test_closed_bucket_marks_not_in_arrears(self, mock_db):
        # Closed accounts are explicitly NOT in arrears even if they were before.
        event = _make_event(bucket="closed", dpd=45, is_in_arrears=False)
        await handle_loan_aging_updated(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        assert set_doc["aging.isInArrears"] is False
        assert set_doc["aging.bucket"] == "closed"

    @pytest.mark.asyncio
    async def test_derives_isInArrears_when_field_missing(self, mock_db):
        # Older publishers may not include `is_in_arrears`; we derive from bucket.
        event = MagicMock()
        event.payload = MagicMock(spec=["account_id", "bucket", "dpd", "last_updated"])
        event.payload.account_id = "LA-LEGACY"
        event.payload.bucket = "early_arrears"
        event.payload.dpd = 5
        event.payload.last_updated = None

        await handle_loan_aging_updated(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        assert set_doc["aging.isInArrears"] is True
        assert set_doc["aging.bucket"] == "early_arrears"

    @pytest.mark.asyncio
    async def test_derives_isInArrears_as_false_for_current_when_field_missing(self, mock_db):
        event = MagicMock()
        event.payload = MagicMock(spec=["account_id", "bucket", "dpd", "last_updated"])
        event.payload.account_id = "LA-CURRENT"
        event.payload.bucket = "current"
        event.payload.dpd = 0
        event.payload.last_updated = None

        await handle_loan_aging_updated(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        assert set_doc["aging.isInArrears"] is False

    @pytest.mark.asyncio
    async def test_uses_event_last_updated_when_present(self, mock_db):
        event = _make_event(last_updated="2026-05-13T03:14:15Z")
        await handle_loan_aging_updated(mock_db, event)

        set_doc = mock_db["loan-accounts"].update_one.call_args[0][1]["$set"]
        assert set_doc["aging.lastUpdated"] == "2026-05-13T03:14:15Z"
