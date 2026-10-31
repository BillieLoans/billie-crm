"""BTB-517: the CRM mirrors a loan cancelled before disbursement.

The platform publishes three events when a loan is cancelled before
disbursement, to ``inbox:billie-servicing`` in no guaranteed order:

* ``account.cancelled.v1`` - the full cancellation record;
* a follow-up ``account.updated.v1`` with ``status="CANCELLED"``;
* an ``account.schedule.updated.v1`` whose payments are all ``VOID``.

These tests drive the real handlers with events parsed by the real accounts
SDK (``parse_account_message``), so a field rename in the SDK breaks them
rather than slipping past a hand-built mock. The Postgres pool is the shared
``mock_pool`` fixture.

The platform is the system of record and its state machine already keeps a
cancelled account cancelled, so the CRM carries no lifecycle rule of its own:
it projects whatever the platform publishes (see ``TestCrmMirrorsThePlatform``).
The one status guard in the event processor is the pre-existing one-way
disbursement gate, pinned in ``test_status_regression_guard.py``.
"""

from __future__ import annotations

import ast
import copy
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from billie_accounts_events import AccountCancelledV1, parse_account_message

import billie_servicing.handlers as handlers_pkg
from billie_servicing.handlers.account import (
    SDK_STATUS_MAP,
    handle_account_cancelled,
    handle_account_closed,
    handle_account_created,
    handle_account_status_changed,
    handle_account_updated,
    handle_schedule_updated,
)

ACCOUNT_ID = "acc-cancel-001"
CANCELLED_AT = "2026-10-30T02:14:59Z"

CANCELLED_ENVELOPE = {
    "conv": "conv-cancel-001",
    "agt": "accountsService",
    "usr": "cust-101-ghi",
    "seq": 1,
    "cls": "msg",
    "typ": "account.cancelled.v1",
    "payload": {
        "event_type": "account.cancelled.v1",
        "event_id": "6f1d1c52-3c43-4d5e-9d52-0b1f4a3b7a10",
        "timestamp": "2026-10-30T02:15:00Z",
        "correlation_id": "corr-cancel-001",
        "account_id": ACCOUNT_ID,
        "account_number": "A110C401",
        "customer_id": "cust-101-ghi",
        "application_number": "APP-2026-001234",
        "previous_status": "PENDING_DISBURSEMENT",
        "reason_code": "mutual_cancellation",
        "note": "Customer and Billie agreed to cancel before funds were sent.",
        "evidence_ref": "email-2026-10-29-agreement",
        "cancelled_by": {"id": "usr-supervisor-1", "name": "Sam Supervisor"},
        "cancelled_at": CANCELLED_AT,
        "ledger_snapshot": {
            "transactions": 3,
            "accrual_entries": 0,
            "ecl_allowance": "12.34",
        },
    },
}


def _cancelled_event(**payload_overrides):
    envelope = copy.deepcopy(CANCELLED_ENVELOPE)
    envelope["payload"].update(payload_overrides)
    return parse_account_message(envelope)


def _updated_event(status, current_balance="52.50", trigger_type="ADJUSTMENT"):
    return parse_account_message(
        {
            "conv": "conv-upd-001",
            "agt": "accountsService",
            "usr": "cust-101-ghi",
            "seq": 1,
            "cls": "msg",
            "typ": "account.updated.v1",
            "payload": {
                "event_type": "account.updated.v1",
                "account_id": ACCOUNT_ID,
                "account_number": "A110C401",
                "customer_id": "cust-101-ghi",
                "status": status,
                "loan_amount": "50.00",
                "loan_fee": "2.50",
                "loan_total_payable": "52.50",
                "opened_date": "2026-10-20T00:00:00Z",
                "current_balance": current_balance,
                "total_paid": "0.00",
                "previous_balance": "52.50",
                "balance_change": "0.00",
                "triggered_by_transaction_id": "TXN-1",
                "triggered_by_transaction_type": trigger_type,
            },
        }
    )


def _status_changed_event(new_status):
    # The accounts SDK has no typed model for account.status_changed.v1
    # (nothing in the platform publishes it - plan D8), so the handler's own
    # contract (account_id + new_status) is exercised with a minimal stand-in,
    # as the other status_changed tests in this suite do.
    event = MagicMock()
    event.payload = MagicMock(spec=["account_id", "new_status"])
    event.payload.account_id = ACCOUNT_ID
    event.payload.new_status = new_status
    return event


def _created_event(status="PENDING_DISBURSEMENT"):
    return parse_account_message(
        {
            "conv": "conv-create-001",
            "agt": "accountsService",
            "usr": "cust-101-ghi",
            "seq": 1,
            "cls": "msg",
            "typ": "account.created.v1",
            "payload": {
                "event_type": "account.created.v1",
                "account_id": ACCOUNT_ID,
                "account_number": "A110C401",
                "customer_id": "cust-101-ghi",
                "status": status,
                # Numbers, not strings: the created model's amount validators
                # compare the raw input against 0.
                "loan_amount": 50.0,
                "loan_fee": 2.5,
                "loan_total_payable": 52.5,
                "opened_date": "2026-10-20T00:00:00Z",
                "current_balance": 52.5,
            },
        }
    )


def _closed_event():
    return parse_account_message(
        {
            "conv": "conv-close-001",
            "agt": "accountsService",
            "usr": "cust-101-ghi",
            "seq": 1,
            "cls": "msg",
            "typ": "account.closed.v1",
            "payload": {
                "event_type": "account.closed.v1",
                "account_id": ACCOUNT_ID,
                "account_number": "A110C401",
                "customer_id": "cust-101-ghi",
                "closure_reason": "PAID_OFF",
                "previous_status": "ACTIVE",
                "closed_date": "2026-10-31T00:00:00Z",
                "final_balance": "0.00",
                "total_paid": "52.50",
                "loan_total_payable": "52.50",
                "triggered_by_transaction_id": "TXN-9",
            },
        }
    )


def _schedule_updated_event(statuses):
    return parse_account_message(
        {
            "conv": "conv-sched-001",
            "agt": "accountsService",
            "usr": "cust-101-ghi",
            "seq": 1,
            "cls": "msg",
            "typ": "account.schedule.updated.v1",
            "payload": {
                "event_type": "account.schedule.updated.v1",
                "schedule_id": "sched-001",
                "account_id": ACCOUNT_ID,
                "customer_id": "cust-101-ghi",
                "triggered_by_transaction_id": "evt-cancel",
                "loan_amount": "50.00",
                "total_amount": "52.50",
                "fee": "2.50",
                "n_payments": len(statuses),
                "payment_frequency": "fortnightly",
                "payments": [
                    {
                        "payment_number": number,
                        "due_date": f"2026-11-{number:02d}",
                        "scheduled_amount": "26.25",
                        "status": status,
                        "amount_paid": "0.00",
                        "amount_remaining": "26.25",
                        "linked_transaction_ids": [],
                        "last_updated": "2026-10-30T02:15:01Z",
                    }
                    for number, status in enumerate(statuses, start=1)
                ],
                "total_paid": "0.00",
                "total_remaining": "52.50",
                "paid_count": 0,
                "partial_count": 0,
                "overdue_count": 0,
                "pending_count": 0,
            },
        }
    )


def _row(account_status, sdk_status=None, disbursed=None, balance=52.5):
    """The stored loan_accounts projection row, as the handlers SELECT it."""
    return {
        "account_status": account_status,
        "sdk_status": sdk_status,
        "loan_terms_disbursed_date": disbursed,
        "balances_total_outstanding": balance,
        "updated_at": None,
    }


CANCELLED_ROW = _row("cancelled", "CANCELLED")

# ---------------------------------------------------------------------------
# account.cancelled.v1 - direct projection (AC12)
# ---------------------------------------------------------------------------


class TestCancelledDirectHandler:
    @pytest.mark.asyncio
    async def test_cancelled_direct_handler(self, mock_pool):
        """AC12: only account.cancelled.v1 is delivered (no account.updated.v1),
        and the projection still lands on cancelled with the full record."""
        await handle_account_cancelled(mock_pool, _cancelled_event())

        update = mock_pool.last_update("loan_accounts")
        assert update is not None
        assert update["account_status"] == "cancelled"
        assert update["sdk_status"] == "CANCELLED"
        assert update["cancellation_reason"] == "mutual_cancellation"
        assert (
            update["cancellation_note"]
            == "Customer and Billie agreed to cancel before funds were sent."
        )
        assert update["cancellation_evidence_ref"] == "email-2026-10-29-agreement"
        assert update["cancellation_cancelled_by_id"] == "usr-supervisor-1"
        assert update["cancellation_cancelled_by_name"] == "Sam Supervisor"
        assert update["cancellation_cancelled_at"] == _cancelled_event().payload.cancelled_at
        assert update["updated_at"] is not None

    @pytest.mark.asyncio
    async def test_targets_the_account_row_by_loan_account_id(self, mock_pool):
        await handle_account_cancelled(mock_pool, _cancelled_event())

        call = next(c for c in mock_pool.calls if c.op == "UPDATE")
        assert call.table == "loan_accounts"
        assert call.where == {"loan_account_id": ACCOUNT_ID}

    @pytest.mark.asyncio
    async def test_reason_is_stored_as_the_plain_code_not_the_enum_repr(self, mock_pool):
        """reason_code is a str-Enum on the SDK model; stringifying it directly
        would store 'CancellationReason.CUSTOMER_WITHDREW'."""
        event = _cancelled_event(reason_code="customer_withdrew", evidence_ref=None)
        assert isinstance(event.payload, AccountCancelledV1)

        await handle_account_cancelled(mock_pool, event)

        update = mock_pool.last_update("loan_accounts")
        assert update["cancellation_reason"] == "customer_withdrew"
        assert type(update["cancellation_reason"]) is str

    @pytest.mark.asyncio
    async def test_evidence_ref_is_optional(self, mock_pool):
        await handle_account_cancelled(
            mock_pool, _cancelled_event(reason_code="duplicate", evidence_ref=None)
        )

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "cancelled"
        assert update["cancellation_evidence_ref"] is None

    @pytest.mark.asyncio
    async def test_replay_writes_the_same_projection(self, mock_pool):
        """Safe to replay: the projection after a second delivery is identical."""
        event = _cancelled_event()
        await handle_account_cancelled(mock_pool, event)
        await handle_account_cancelled(mock_pool, event)

        first, second = mock_pool.updates_to("loan_accounts")
        first.pop("updated_at")
        second.pop("updated_at")
        assert first == second

    @pytest.mark.asyncio
    async def test_leaves_balances_and_schedule_alone(self, mock_pool):
        """The cancel event is about status and the cancellation record; the
        follow-up account.updated.v1 / schedule.updated.v1 own the rest."""
        await handle_account_cancelled(mock_pool, _cancelled_event())

        update = mock_pool.last_update("loan_accounts")
        assert not [k for k in update if k.startswith("balances_")]
        assert not mock_pool.has_call_against("loan_accounts_repayment_schedule_payments")


# ---------------------------------------------------------------------------
# SDK_STATUS_MAP (Review focus 5: never default CANCELLED to "active")
# ---------------------------------------------------------------------------


class TestStatusMap:
    def test_map_has_cancelled(self):
        assert SDK_STATUS_MAP["CANCELLED"] == "cancelled"

    @pytest.mark.asyncio
    async def test_updated_cancelled_maps_to_cancelled(self, mock_pool):
        """The follow-up account.updated.v1 (status CANCELLED) lands as
        cancelled, not the unknown-status default of active."""
        mock_pool.set_fetchrow(_row("pending_disbursement", "PENDING_DISBURSEMENT"))

        await handle_account_updated(mock_pool, _updated_event("CANCELLED"))

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "cancelled"
        assert update["sdk_status"] == "CANCELLED"

    @pytest.mark.asyncio
    async def test_status_changed_cancelled_maps_to_cancelled(self, mock_pool):
        """No fallback handler is added (plan D8), but the existing
        account.status_changed.v1 handler benefits from the map entry."""
        mock_pool.set_fetchrow(_row("pending_disbursement", "PENDING_DISBURSEMENT"))

        await handle_account_status_changed(mock_pool, _status_changed_event("CANCELLED"))

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "cancelled"
        assert update["sdk_status"] == "CANCELLED"

    @pytest.mark.asyncio
    async def test_updated_cancelled_is_never_active_even_without_a_stored_row(
        self, mock_pool
    ):
        """Out-of-order delivery: the CANCELLED update can precede any stored
        state. It must still map to cancelled."""
        mock_pool.set_fetchrow(None)

        await handle_account_updated(mock_pool, _updated_event("CANCELLED"))

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "cancelled"


# ---------------------------------------------------------------------------
# The CRM mirrors the platform: no lifecycle rule of its own for cancelled
# ---------------------------------------------------------------------------


class TestCrmMirrorsThePlatform:
    @pytest.mark.asyncio
    async def test_a_later_updated_status_is_applied_to_a_cancelled_row(self, mock_pool):
        """The CRM is a projection, not the system of record. The platform's
        state machine guarantees a cancelled account never leaves CANCELLED, so
        the CRM does not re-enforce that: a later account.updated.v1 carrying a
        status is applied to a row stored as cancelled, exactly like any other
        row."""
        mock_pool.set_fetchrow(CANCELLED_ROW)

        await handle_account_updated(mock_pool, _updated_event("ACTIVE"))

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "active"
        assert update["sdk_status"] == "ACTIVE"

    @pytest.mark.asyncio
    async def test_created_for_a_new_account_still_sets_status(self, mock_pool):
        mock_pool.set_fetchrow(None)

        await handle_account_created(mock_pool, _created_event("PENDING_DISBURSEMENT"))

        insert = mock_pool.last_insert("loan_accounts")
        assert insert["account_status"] == "pending_disbursement"
        assert insert["sdk_status"] == "PENDING_DISBURSEMENT"

    @pytest.mark.asyncio
    async def test_closed_closes_an_account(self, mock_pool):
        mock_pool.set_fetchrow(_row("active", "ACTIVE"))

        await handle_account_closed(mock_pool, _closed_event())

        assert mock_pool.last_update("loan_accounts")["account_status"] == "paid_off"

    @pytest.mark.asyncio
    async def test_updated_transitions_a_pending_account(self, mock_pool):
        mock_pool.set_fetchrow(_row("pending_disbursement", "PENDING_DISBURSEMENT"))

        await handle_account_updated(mock_pool, _updated_event("ACTIVE"))

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "active"
        assert update["sdk_status"] == "ACTIVE"

    @pytest.mark.asyncio
    async def test_schedule_stub_never_overwrites_account_status(self, mock_pool):
        """The schedule handlers create a stub parent row when none exists; on
        an existing (cancelled) row account_status must be insert-only."""
        mock_pool.set_fetchval("parent-uuid")

        await handle_schedule_updated(mock_pool, _schedule_updated_event(["VOID", "VOID"]))

        stub = next(
            c
            for c in mock_pool.calls
            if c.op == "INSERT" and c.table == "loan_accounts"
        )
        # Not part of the DO UPDATE SET clause: a conflict leaves the stored
        # account_status (cancelled) untouched.
        set_clause = stub.sql.split("DO UPDATE SET", 1)[1]
        assert "account_status" not in set_clause


# ---------------------------------------------------------------------------
# account.schedule.updated.v1 with VOID instalments (AC10)
# ---------------------------------------------------------------------------


class TestScheduleVoid:
    @pytest.mark.asyncio
    async def test_schedule_updated_void_stored(self, mock_pool):
        """AC10: VOID is stored as 'void', not collapsed to 'scheduled'."""
        mock_pool.set_fetchval("parent-uuid")

        await handle_schedule_updated(
            mock_pool, _schedule_updated_event(["VOID", "VOID", "VOID"])
        )

        rows = {
            r["payment_number"]: r["status"]
            for r in mock_pool.inserts_into("loan_accounts_repayment_schedule_payments")
        }
        assert rows == {1: "void", 2: "void", 3: "void"}

    @pytest.mark.asyncio
    async def test_other_statuses_are_unchanged(self, mock_pool):
        mock_pool.set_fetchval("parent-uuid")

        await handle_schedule_updated(
            mock_pool, _schedule_updated_event(["PENDING", "PARTIAL", "PAID", "OVERDUE"])
        )

        rows = {
            r["payment_number"]: r["status"]
            for r in mock_pool.inserts_into("loan_accounts_repayment_schedule_payments")
        }
        assert rows == {1: "scheduled", 2: "partial", 3: "paid", 4: "missed"}


# ---------------------------------------------------------------------------
# Wiring
# ---------------------------------------------------------------------------


class TestWiring:
    def test_handler_is_exported_from_the_handlers_package(self):
        assert handlers_pkg.handle_account_cancelled is handle_account_cancelled
        assert "handle_account_cancelled" in handlers_pkg.__all__

    def test_main_registers_account_cancelled_v1(self):
        """main.py must register the handler under the event type. Parsed
        statically (like test_handler_exports) so it needs no live SDK set."""
        main_py = Path(handlers_pkg.__file__).parent.parent / "main.py"
        tree = ast.parse(main_py.read_text())
        registered = {
            (node.args[0].value, node.args[1].id)
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "register_handler"
            and len(node.args) == 2
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[1], ast.Name)
        }
        assert ("account.cancelled.v1", "handle_account_cancelled") in registered
