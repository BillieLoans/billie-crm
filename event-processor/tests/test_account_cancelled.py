"""BTB-517: ``CANCELLED`` is a terminal account status in the CRM projection.

The platform publishes three events when a loan is cancelled before
disbursement, to ``inbox:billie-servicing`` in no guaranteed order:

* ``account.cancelled.v1`` - the full cancellation record;
* a follow-up ``account.updated.v1`` with ``status="CANCELLED"``;
* an ``account.schedule.updated.v1`` whose payments are all ``VOID``.

These tests drive the real handlers with events parsed by the real accounts
SDK (``parse_account_message``), so a field rename in the SDK breaks them
rather than slipping past a hand-built mock. The Postgres pool is the shared
``mock_pool`` fixture.

Review focus pinned here: a stale ``account.updated.v1`` carrying
``PENDING_DISBURSEMENT`` must never move a cancelled loan back to
``pending_disbursement`` - and neither may any other status, from any writer
of ``account_status``.
"""

from __future__ import annotations

import ast
import copy
import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from billie_accounts_events import AccountCancelledV1, parse_account_message
from structlog.testing import capture_logs

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

# Every SDK status plus a value the map has never heard of - none may move a
# cancelled loan.
ANY_INCOMING_STATUS = [
    "PENDING",
    "PENDING_DISBURSEMENT",
    "ACTIVE",
    "SUSPENDED",
    "CLOSED",
    "CANCELLED",
    "SOMETHING_NEW",
]


def _account_status_writes(mock_pool):
    """Every statement against loan_accounts that sets account_status."""
    return [
        c
        for c in mock_pool.calls
        if c.table == "loan_accounts"
        and c.op in {"INSERT", "UPDATE"}
        and "account_status" in c.values
    ]


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
# Terminal guard (Review focus 1) - every writer of account_status
# ---------------------------------------------------------------------------


class TestCancelledIsTerminal:
    @pytest.mark.asyncio
    async def test_stale_updated_after_cancel_ignored(self, mock_pool):
        """Review focus 1: stale PENDING_DISBURSEMENT after the cancel."""
        mock_pool.set_fetchrow(CANCELLED_ROW)

        await handle_account_updated(mock_pool, _updated_event("PENDING_DISBURSEMENT"))

        update = mock_pool.last_update("loan_accounts")
        assert update is not None
        assert "account_status" not in update
        assert "sdk_status" not in update

    @pytest.mark.asyncio
    @pytest.mark.parametrize("incoming", ANY_INCOMING_STATUS)
    async def test_updated_with_any_status_cannot_move_a_cancelled_account(
        self, mock_pool, incoming
    ):
        mock_pool.set_fetchrow(CANCELLED_ROW)

        await handle_account_updated(mock_pool, _updated_event(incoming))

        assert _account_status_writes(mock_pool) == []

    @pytest.mark.asyncio
    async def test_other_updated_fields_still_apply_when_status_is_dropped(self, mock_pool):
        """Mirrors the disbursement gate: only the status is dropped."""
        mock_pool.set_fetchrow(CANCELLED_ROW)

        await handle_account_updated(
            mock_pool, _updated_event("PENDING_DISBURSEMENT", current_balance="52.50")
        )

        update = mock_pool.last_update("loan_accounts")
        assert update["balances_current_balance"] == 52.5
        assert update["balances_total_outstanding"] == 52.5

    @pytest.mark.asyncio
    async def test_dropped_status_change_logs_a_warning(self, mock_pool):
        mock_pool.set_fetchrow(CANCELLED_ROW)

        with capture_logs() as captured:
            await handle_account_updated(mock_pool, _updated_event("ACTIVE"))

        warnings = [e for e in captured if e.get("log_level") == "warning"]
        assert any("cancelled" in json.dumps(e, default=str).lower() for e in warnings), captured

    # Final-review M2: the platform's own follow-up account.updated.v1
    # (status CANCELLED) reaches a row account.cancelled.v1 already made
    # cancelled on every cancel. That is a no-op, not a regression: INFO, never
    # WARNING. A real attempt to move a cancelled loan still warns (above).
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "deliver",
        [
            pytest.param(
                lambda pool: handle_account_updated(pool, _updated_event("CANCELLED")),
                id="updated",
            ),
            pytest.param(
                lambda pool: handle_account_created(pool, _created_event("CANCELLED")),
                id="created",
            ),
            pytest.param(
                lambda pool: handle_account_status_changed(
                    pool, _status_changed_event("CANCELLED")
                ),
                id="status_changed",
            ),
        ],
    )
    async def test_cancelled_onto_cancelled_is_info_not_warning(self, mock_pool, deliver):
        mock_pool.set_fetchrow(CANCELLED_ROW)

        with capture_logs() as captured:
            await deliver(mock_pool)

        assert not [e for e in captured if e.get("log_level") == "warning"], captured
        infos = [e for e in captured if e.get("log_level") == "info"]
        assert any("already cancelled" in str(e.get("event", "")) for e in infos), captured

    @pytest.mark.asyncio
    async def test_no_phantom_last_payment_on_a_cancelled_account(self, mock_pool):
        """With the status dropped, the 'balance went down so a payment must
        have happened' inference must not run against a cancelled loan."""
        mock_pool.set_fetchrow(_row("cancelled", "CANCELLED", balance=52.5))

        await handle_account_updated(
            mock_pool,
            _updated_event("PENDING_DISBURSEMENT", current_balance="0.00", trigger_type=""),
        )

        update = mock_pool.last_update("loan_accounts")
        assert "last_payment_date" not in update
        assert "last_payment_amount" not in update

    @pytest.mark.asyncio
    @pytest.mark.parametrize("incoming", ANY_INCOMING_STATUS)
    async def test_status_changed_cannot_move_a_cancelled_account(self, mock_pool, incoming):
        mock_pool.set_fetchrow(CANCELLED_ROW)

        await handle_account_status_changed(mock_pool, _status_changed_event(incoming))

        assert _account_status_writes(mock_pool) == []

    @pytest.mark.asyncio
    async def test_created_replay_cannot_move_a_cancelled_account(self, mock_pool):
        """A replayed account.created.v1 carries the original
        PENDING_DISBURSEMENT snapshot."""
        mock_pool.set_fetchrow(CANCELLED_ROW)

        await handle_account_created(mock_pool, _created_event("PENDING_DISBURSEMENT"))

        assert _account_status_writes(mock_pool) == []
        # ...but the row is still upserted (non-status fields apply).
        assert mock_pool.last_insert("loan_accounts") is not None

    @pytest.mark.asyncio
    async def test_created_for_a_new_account_still_sets_status(self, mock_pool):
        mock_pool.set_fetchrow(None)

        await handle_account_created(mock_pool, _created_event("PENDING_DISBURSEMENT"))

        insert = mock_pool.last_insert("loan_accounts")
        assert insert["account_status"] == "pending_disbursement"
        assert insert["sdk_status"] == "PENDING_DISBURSEMENT"

    @pytest.mark.asyncio
    async def test_closed_cannot_move_a_cancelled_account(self, mock_pool):
        mock_pool.set_fetchrow(CANCELLED_ROW)

        await handle_account_closed(mock_pool, _closed_event())

        assert mock_pool.updates_to("loan_accounts") == []

    @pytest.mark.asyncio
    async def test_closed_still_closes_an_account_that_is_not_cancelled(self, mock_pool):
        mock_pool.set_fetchrow(_row("active", "ACTIVE"))

        await handle_account_closed(mock_pool, _closed_event())

        assert mock_pool.last_update("loan_accounts")["account_status"] == "paid_off"

    @pytest.mark.asyncio
    async def test_updated_still_transitions_a_pending_account(self, mock_pool):
        """The guard is cancelled-only: forward transitions are untouched."""
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
