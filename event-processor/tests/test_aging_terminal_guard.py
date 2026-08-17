"""Tests for the terminal-closure guard on aging bucket writes.

Prod incident 2026-08-17 (accounts WTVFB9Q1CK0N, 1CPTX2ZA67SC): the
agingMonitor daily scheduler emitted `bucket: current, previous_bucket:
closed, transition_reason: "downgrade"` for accounts that had already been
closed (paid off), flipping the CRM's collections status from Closed back to
Current. Unlike the BTB-285 disbursement race these events were genuinely
newer, not stale — the emitted data itself was wrong, so the fix is a domain
guard: while the projection shows the account in a terminal status
(paid_off / written_off), an aging event that would move the bucket away
from `closed` is spurious and must be dropped (warning logged). Events
carrying `bucket: closed` still apply (closure + replay path), and a genuine
reopen lifts the terminal account_status via account.status_changed.v1
before any aging update would legitimately differ.
"""

from unittest.mock import MagicMock

import pytest
from billie_servicing.handlers.aging import handle_loan_aging_updated
from structlog.testing import capture_logs


def _aging_event(bucket, dpd=0, is_in_arrears=False):
    event = MagicMock()
    event.payload = MagicMock(
        spec=["account_id", "bucket", "dpd", "is_in_arrears", "last_updated"]
    )
    event.payload.account_id = "ACC-AGING-TERM-1"
    event.payload.bucket = bucket
    event.payload.dpd = dpd
    event.payload.is_in_arrears = is_in_arrears
    event.payload.last_updated = None
    return event


class TestAgingTerminalGuard:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("terminal_status", ["paid_off", "written_off"])
    async def test_downgrade_to_current_ignored_for_terminal_account(
        self, mock_pool, terminal_status
    ):
        """The prod repro: scheduler 'downgrade' closed → current."""
        mock_pool.set_fetchrow({"account_status": terminal_status})

        with capture_logs() as captured:
            await handle_loan_aging_updated(mock_pool, _aging_event("current"))

        assert mock_pool.last_update("loan_accounts") is None
        warnings = [e for e in captured if e.get("log_level") == "warning"]
        assert warnings, "expected a warning for the dropped aging downgrade"

    @pytest.mark.asyncio
    async def test_arrears_bucket_also_ignored_for_terminal_account(self, mock_pool):
        mock_pool.set_fetchrow({"account_status": "paid_off"})

        await handle_loan_aging_updated(
            mock_pool, _aging_event("early_arrears", dpd=3, is_in_arrears=True)
        )

        assert mock_pool.last_update("loan_accounts") is None

    @pytest.mark.asyncio
    async def test_closed_bucket_still_applies_to_terminal_account(self, mock_pool):
        """Closure events and stream replays must keep working."""
        mock_pool.set_fetchrow({"account_status": "paid_off"})

        await handle_loan_aging_updated(mock_pool, _aging_event("closed"))

        update = mock_pool.last_update("loan_accounts")
        assert update is not None
        assert update["aging_bucket"] == "closed"
        assert update["aging_is_in_arrears"] is False

    @pytest.mark.asyncio
    async def test_active_account_updates_apply_normally(self, mock_pool):
        mock_pool.set_fetchrow({"account_status": "active"})

        await handle_loan_aging_updated(
            mock_pool, _aging_event("late_arrears", dpd=20, is_in_arrears=True)
        )

        update = mock_pool.last_update("loan_accounts")
        assert update["aging_bucket"] == "late_arrears"
        assert update["aging_current_d_p_d"] == 20

    @pytest.mark.asyncio
    async def test_missing_projection_row_applies_without_guard(self, mock_pool):
        """No row yet — nothing to guard; the update no-ops downstream anyway."""
        mock_pool.set_fetchrow(None)

        await handle_loan_aging_updated(mock_pool, _aging_event("current"))

        assert mock_pool.last_update("loan_accounts") is not None
