"""Tests for the loan.aging.updated.v1 handler.

The handler updates the aging_* columns on the loan_accounts row keyed by
loan_account_id. We exercise:
  - Happy path (all fields present from aging-v1.1.0)
  - Derived fallback when the publisher omits is_in_arrears
  - Bucket-only / DPD-only variations
"""

import pytest
from unittest.mock import MagicMock

from billie_servicing.handlers.aging import handle_loan_aging_updated


def _make_event(account_id="LA-001", bucket="late_arrears", dpd=23, is_in_arrears=True,
                last_updated=None):
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
    async def test_writes_isInArrears_and_bucket_and_dpd(self, mock_pool):
        event = _make_event(
            account_id="LA-AGING-001",
            bucket="late_arrears",
            dpd=23,
            is_in_arrears=True,
        )
        await handle_loan_aging_updated(mock_pool, event)

        updates = mock_pool.updates_to("loan_accounts")
        assert len(updates) == 1
        update = updates[0]
        assert mock_pool.calls_against("loan_accounts")[0].where == {"loan_account_id": "LA-AGING-001"}
        assert update["aging_is_in_arrears"] is True
        assert update["aging_bucket"] == "late_arrears"
        assert update["aging_current_d_p_d"] == 23
        assert "aging_last_updated" in update

    @pytest.mark.asyncio
    async def test_current_bucket_marks_not_in_arrears(self, mock_pool):
        event = _make_event(bucket="current", dpd=0, is_in_arrears=False)
        await handle_loan_aging_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update is not None
        assert update["aging_is_in_arrears"] is False
        assert update["aging_bucket"] == "current"

    @pytest.mark.asyncio
    async def test_closed_bucket_marks_not_in_arrears(self, mock_pool):
        event = _make_event(bucket="closed", dpd=45, is_in_arrears=False)
        await handle_loan_aging_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["aging_is_in_arrears"] is False
        assert update["aging_bucket"] == "closed"

    @pytest.mark.asyncio
    async def test_derives_isInArrears_when_field_missing(self, mock_pool):
        # Older publishers may not include is_in_arrears; we derive from bucket.
        event = MagicMock()
        event.payload = MagicMock(spec=["account_id", "bucket", "dpd", "last_updated"])
        event.payload.account_id = "LA-LEGACY"
        event.payload.bucket = "early_arrears"
        event.payload.dpd = 5
        event.payload.last_updated = None

        await handle_loan_aging_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["aging_is_in_arrears"] is True
        assert update["aging_bucket"] == "early_arrears"

    @pytest.mark.asyncio
    async def test_derives_isInArrears_as_false_for_current_when_field_missing(self, mock_pool):
        event = MagicMock()
        event.payload = MagicMock(spec=["account_id", "bucket", "dpd", "last_updated"])
        event.payload.account_id = "LA-CURRENT"
        event.payload.bucket = "current"
        event.payload.dpd = 0
        event.payload.last_updated = None

        await handle_loan_aging_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["aging_is_in_arrears"] is False

    @pytest.mark.asyncio
    async def test_uses_event_last_updated_when_present(self, mock_pool):
        event = _make_event(last_updated="2026-05-13T03:14:15Z")
        await handle_loan_aging_updated(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["aging_last_updated"] == "2026-05-13T03:14:15Z"
