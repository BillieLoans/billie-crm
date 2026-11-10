"""BTB-537: account events are ordered by ``account_version``.

The platform stamps every ``account.*`` event with one counter per account
(accounts SDK 2.13.0+). The handlers keep the highest version they have applied
on the loan account row, in ``account_state_version`` (created, updated, status
changed, closed, cancelled) and ``account_schedule_version`` (schedule created
and updated), and an older event then overwrites nothing: it may only fill a
column that is still NULL.

The comparison is made by Postgres, inside the write, so these tests pin two
things against the shared ``mock_pool``: the statement each handler sends (the
guard, the fill-only branch, the stored maximum), and what the handler itself
decides from the row it read (the log line, the schedule payment statement,
the last-payment inference). No test here runs the SQL.
"""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock

import pytest
from billie_accounts_events import (
    AccountCancelledV1,
    AccountClosedV1,
    AccountCreatedV1,
    AccountScheduleCreatedV1,
    AccountScheduleUpdatedV1,
    AccountUpdatedV1,
)
from structlog.testing import capture_logs

from billie_servicing.db import update_by_key, upsert
from billie_servicing.handlers.account import (
    handle_account_cancelled,
    handle_account_closed,
    handle_account_created,
    handle_account_status_changed,
    handle_account_updated,
    handle_schedule_created,
    handle_schedule_updated,
)

ACCOUNT_ID = "ACC-VERSION-001"
PARENT_ID = "11111111-2222-3333-4444-555555555555"
STATE = "account_state_version"
SCHEDULE = "account_schedule_version"
PAYMENTS = "loan_accounts_repayment_schedule_payments"


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------


def _event(**fields: Any) -> MagicMock:
    """An event whose payload has exactly ``fields`` (``spec`` makes any other
    attribute raise, as it would on the SDK model)."""
    event = MagicMock()
    event.payload = MagicMock(spec=list(fields))
    for name, value in fields.items():
        setattr(event.payload, name, value)
    return event


def _created(account_version: Any) -> MagicMock:
    return _event(
        account_id=ACCOUNT_ID,
        customer_id="CUS-1",
        account_number="ACC-NUM-1",
        status="PENDING",
        loan_amount=Decimal("500.00"),
        loan_fee=Decimal("25.00"),
        loan_total_payable=Decimal("525.00"),
        opened_date="2026-11-01",
        current_balance=Decimal("525.00"),
        account_version=account_version,
    )


def _updated(account_version: Any, current_balance: str = "42.00") -> MagicMock:
    return _event(
        account_id=ACCOUNT_ID,
        current_balance=Decimal(current_balance),
        status=None,
        last_payment_date=None,
        last_payment_amount=None,
        account_version=account_version,
    )


def _status_changed(account_version: Any) -> MagicMock:
    return _event(account_id=ACCOUNT_ID, new_status="SUSPENDED", account_version=account_version)


def _closed(account_version: Any) -> MagicMock:
    return _event(
        account_id=ACCOUNT_ID,
        closure_reason="PAID_OFF",
        final_balance=Decimal("0.00"),
        total_paid=Decimal("525.00"),
        previous_status="ACTIVE",
        closed_date="2026-11-10",
        loan_total_payable=Decimal("525.00"),
        account_version=account_version,
    )


def _cancelled(account_version: Any) -> MagicMock:
    cancelled_by = MagicMock()
    cancelled_by.id = "usr-1"
    cancelled_by.name = "Sam Supervisor"
    return _event(
        account_id=ACCOUNT_ID,
        reason_code="customer_withdrew",
        note="Customer no longer needs the loan.",
        cancelled_by=cancelled_by,
        cancelled_at="2026-11-10T00:00:00Z",
        account_version=account_version,
    )


def _schedule_created(account_version: Any) -> MagicMock:
    payment = MagicMock()
    payment.payment_number = 1
    payment.due_date = "2026-11-20"
    payment.amount = Decimal("105.00")
    return _event(
        account_id=ACCOUNT_ID,
        schedule_id="SCHED-1",
        n_payments=1,
        payment_frequency="weekly",
        created_date="2026-11-01",
        payments=[payment],
        account_version=account_version,
    )


def _schedule_updated(account_version: Any) -> MagicMock:
    payment = MagicMock(
        spec=["payment_number", "status", "paid_date", "amount_paid", "amount_remaining"]
    )
    payment.payment_number = 1
    payment.status = "PAID"
    payment.paid_date = "2026-11-08"
    payment.amount_paid = Decimal("105.00")
    payment.amount_remaining = Decimal("0.00")
    return _event(
        account_id=ACCOUNT_ID,
        schedule_id="SCHED-1",
        payments=[payment],
        account_version=account_version,
    )


# The five account-state handlers, each with what one of its events writes.
STATE_HANDLERS = [
    pytest.param(handle_account_created, _created, "balances_current_balance", 525.0, id="created"),
    pytest.param(handle_account_updated, _updated, "balances_current_balance", 42.0, id="updated"),
    pytest.param(
        handle_account_status_changed, _status_changed, "sdk_status", "SUSPENDED", id="status_changed"
    ),
    pytest.param(handle_account_closed, _closed, "closure_reason", "PAID_OFF", id="closed"),
    pytest.param(
        handle_account_cancelled, _cancelled, "cancellation_reason", "customer_withdrew", id="cancelled"
    ),
]

SCHEDULE_HANDLERS = [
    pytest.param(handle_schedule_created, _schedule_created, id="schedule_created"),
    pytest.param(handle_schedule_updated, _schedule_updated, id="schedule_updated"),
]


# ---------------------------------------------------------------------------
# Reading the recorded statements
# ---------------------------------------------------------------------------


def _row(**columns: Any) -> dict[str, Any]:
    """The stored loan account row the handlers read before they write."""
    return {
        "account_status": "active",
        "sdk_status": "ACTIVE",
        "loan_terms_disbursed_date": None,
        "balances_total_outstanding": 50.0,
        **columns,
    }


PLACEHOLDER_FILL = "AND account_number = loan_account_id"


def _write(mock_pool: Any) -> Any:
    """The one INSERT/UPDATE the handler sent to loan_accounts (leaving aside
    a stale account.created.v1 filling a placeholder account number)."""
    writes = [
        c
        for c in mock_pool.calls_against("loan_accounts")
        if c.op in {"INSERT", "UPDATE"} and PLACEHOLDER_FILL not in c.sql
    ]
    assert len(writes) == 1, [c.sql for c in writes]
    return writes[0]


def _written(call: Any, column: str) -> Any:
    """The value a write carries for ``column``, whichever form the SET takes."""
    if call.op == "INSERT":
        return call.values[column]
    placeholder = re.search(rf"\b{column} = (?:CASE WHEN .*? ELSE |GREATEST\({column}, )?\$(\d+)", call.sql)
    assert placeholder, f"{column} is not written by: {call.sql}"
    return call.args[int(placeholder.group(1)) - 1]


def _set_clause(call: Any) -> str:
    return call.sql.split(" SET ", 1)[1].split(" WHERE loan_account_id")[0]


def _assert_guarded(call: Any, version_column: str, other_version_column: str) -> None:
    """Every column the write sets is fill-only for a row holding a higher
    version of this family, and the family's column keeps the maximum."""
    table = "loan_accounts." if call.op == "INSERT" else ""
    if call.op == "INSERT":
        stale = rf"loan_accounts\.{version_column} > EXCLUDED\.{version_column}"
        fill_only = rf"(\w+) = CASE WHEN {stale} THEN COALESCE\(loan_accounts\.\1, EXCLUDED\.\1\) ELSE EXCLUDED\.\1 END"
        maximum = f"{version_column} = GREATEST(loan_accounts.{version_column}, EXCLUDED.{version_column})"
    else:
        stale = rf"{version_column} > \$\d+"
        fill_only = rf"(\w+) = CASE WHEN {stale} THEN COALESCE\(\1, (\$\d+)\) ELSE \2 END"
        maximum = f"{version_column} = GREATEST({version_column}, $"

    set_clause = _set_clause(call)
    assert maximum in set_clause
    remainder = re.sub(fill_only, "", set_clause.replace(maximum, "", 1))
    # Nothing is assigned outside the guard: no bare `col = $n` / `col = EXCLUDED.col`.
    assert not re.search(r"\w+ = (\$\d+|EXCLUDED\.\w+)(,|$)", remainder), remainder
    assert f"{table}{other_version_column}" not in call.sql


def _stale_logs(captured: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [e for e in captured if "incoming_account_version" in e]


# ---------------------------------------------------------------------------
# The SDK and the two db helpers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "model",
    [
        AccountCreatedV1,
        AccountUpdatedV1,
        AccountClosedV1,
        AccountCancelledV1,
        AccountScheduleCreatedV1,
        AccountScheduleUpdatedV1,
    ],
)
def test_the_pinned_sdk_carries_account_version(model: Any) -> None:
    """accounts SDK 2.13.0 is the first with ``account_version``, optional."""
    field = model.model_fields["account_version"]
    assert field.default is None


class TestVersionColumn:
    @pytest.mark.asyncio
    async def test_update_by_key_fills_only_when_the_row_is_newer(self, mock_pool):
        await update_by_key(
            mock_pool,
            "loan_accounts",
            key_column="loan_account_id",
            key_value="A",
            values={"sdk_status": "ACTIVE", STATE: 5},
            version_column=STATE,
        )
        call = mock_pool.calls[-1]
        assert call.sql == (
            "UPDATE loan_accounts SET "
            "sdk_status = CASE WHEN account_state_version > $2 "
            "THEN COALESCE(sdk_status, $1) ELSE $1 END, "
            "account_state_version = GREATEST(account_state_version, $2) "
            "WHERE loan_account_id = $3"
        )
        assert call.args == ("ACTIVE", 5, "A")

    @pytest.mark.asyncio
    async def test_upsert_fills_only_when_the_row_is_newer(self, mock_pool):
        await upsert(
            mock_pool,
            "loan_accounts",
            conflict_columns=["loan_account_id"],
            values={"loan_account_id": "A", "sdk_status": "ACTIVE", STATE: 5},
            version_column=STATE,
        )
        assert mock_pool.calls[-1].sql.endswith(
            "ON CONFLICT (loan_account_id) DO UPDATE SET "
            "sdk_status = CASE WHEN loan_accounts.account_state_version > EXCLUDED.account_state_version "
            "THEN COALESCE(loan_accounts.sdk_status, EXCLUDED.sdk_status) ELSE EXCLUDED.sdk_status END, "
            "account_state_version = GREATEST(loan_accounts.account_state_version, "
            "EXCLUDED.account_state_version)"
        )

    @pytest.mark.asyncio
    async def test_no_version_column_leaves_both_statements_unchanged(self, mock_pool):
        await update_by_key(
            mock_pool, "loan_accounts", key_column="loan_account_id", key_value="A",
            values={"sdk_status": "ACTIVE"},
        )
        assert mock_pool.calls[-1].sql == (
            "UPDATE loan_accounts SET sdk_status = $1 WHERE loan_account_id = $2"
        )
        await upsert(
            mock_pool, "loan_accounts", conflict_columns=["loan_account_id"],
            values={"loan_account_id": "A", "sdk_status": "ACTIVE"},
        )
        assert mock_pool.calls[-1].sql.endswith("DO UPDATE SET sdk_status = EXCLUDED.sdk_status")


# ---------------------------------------------------------------------------
# Account-state events
# ---------------------------------------------------------------------------


class TestAccountStateVersion:
    @pytest.mark.parametrize("handler, make_event, column, value", STATE_HANDLERS)
    @pytest.mark.asyncio
    async def test_newer_version_applies_and_is_stored(
        self, mock_pool, handler, make_event, column, value
    ):
        mock_pool.set_fetchrow(_row(**{STATE: Decimal("3")}))

        with capture_logs() as captured:
            await handler(mock_pool, make_event(5))

        call = _write(mock_pool)
        assert _written(call, column) == value
        assert _written(call, STATE) == 5
        _assert_guarded(call, STATE, SCHEDULE)
        assert not _stale_logs(captured)

    @pytest.mark.parametrize("handler, make_event, column, value", STATE_HANDLERS)
    @pytest.mark.asyncio
    async def test_older_version_overwrites_nothing_and_fills_empty_columns(
        self, mock_pool, handler, make_event, column, value
    ):
        """The row holds version 5 and version 3 arrives. The statement still
        carries the event's values, but every one of them sits in the guard's
        fill-only branch (``COALESCE(existing, incoming)``), so Postgres keeps
        what is there and fills only what is NULL; version 5 stays stored."""
        mock_pool.set_fetchrow(_row(**{STATE: Decimal("5")}))

        with capture_logs() as captured:
            await handler(mock_pool, make_event(3))

        call = _write(mock_pool)
        _assert_guarded(call, STATE, SCHEDULE)
        assert _written(call, column) == value
        assert _written(call, STATE) == 3  # GREATEST(stored 5, 3) keeps 5

        (stale,) = _stale_logs(captured)
        assert stale["log_level"] == "info"
        assert stale["incoming_account_version"] == 3
        assert stale["stored_account_version"] == 5

    @pytest.mark.parametrize("handler, make_event, column, value", STATE_HANDLERS)
    @pytest.mark.asyncio
    async def test_equal_version_is_a_redelivery_and_is_reapplied(
        self, mock_pool, handler, make_event, column, value
    ):
        mock_pool.set_fetchrow(_row(**{STATE: Decimal("5")}))

        with capture_logs() as captured:
            await handler(mock_pool, make_event(5))

        call = _write(mock_pool)
        assert _written(call, column) == value
        assert _written(call, STATE) == 5
        assert not _stale_logs(captured)

    @pytest.mark.parametrize("handler, make_event, column, value", STATE_HANDLERS)
    @pytest.mark.parametrize("stored", [None, Decimal("9")], ids=["no-stored", "stored-9"])
    @pytest.mark.asyncio
    async def test_unversioned_event_is_written_exactly_as_before(
        self, mock_pool, handler, make_event, column, value, stored
    ):
        """An older producer or an older stored event: no guard, no version
        written, whatever the row holds."""
        mock_pool.set_fetchrow(_row(**{STATE: stored}))

        with capture_logs() as captured:
            await handler(mock_pool, make_event(None))

        call = _write(mock_pool)
        assert _written(call, column) == value
        assert STATE not in call.sql.split("SELECT")[0]
        assert "CASE WHEN" not in call.sql and "GREATEST" not in call.sql
        assert not _stale_logs(captured)

    @pytest.mark.parametrize("handler, make_event, column, value", STATE_HANDLERS)
    @pytest.mark.asyncio
    async def test_row_without_a_stored_version_applies_and_stores(
        self, mock_pool, handler, make_event, column, value
    ):
        mock_pool.set_fetchrow(_row(**{STATE: None}))

        with capture_logs() as captured:
            await handler(mock_pool, make_event(4))

        call = _write(mock_pool)
        assert _written(call, column) == value
        assert _written(call, STATE) == 4
        assert not _stale_logs(captured)

    @pytest.mark.parametrize("handler, make_event, column, value", STATE_HANDLERS)
    @pytest.mark.asyncio
    async def test_a_higher_schedule_version_does_not_block_a_state_event(
        self, mock_pool, handler, make_event, column, value
    ):
        """Schedule event 6 was applied first; state event 5 is still the
        newest STATE this row has seen (it holds 4), so it applies."""
        mock_pool.set_fetchrow(_row(**{STATE: Decimal("4"), SCHEDULE: Decimal("6")}))

        with capture_logs() as captured:
            await handler(mock_pool, make_event(5))

        call = _write(mock_pool)
        assert _written(call, column) == value
        assert _written(call, STATE) == 5
        _assert_guarded(call, STATE, SCHEDULE)  # also: never reads the schedule version
        assert not _stale_logs(captured)

    @pytest.mark.parametrize("not_a_version", [True, "7", 7.0, MagicMock()])
    @pytest.mark.asyncio
    async def test_only_an_integer_counts_as_a_version(self, mock_pool, not_a_version):
        mock_pool.set_fetchrow(_row(**{STATE: Decimal("9")}))

        await handle_account_updated(mock_pool, _updated(not_a_version))

        assert mock_pool.last_update("loan_accounts")["balances_current_balance"] == 42.0
        assert STATE not in _set_clause(_write(mock_pool))

    @pytest.mark.parametrize("stored, fills", [(Decimal("5"), True), (Decimal("1"), False)])
    @pytest.mark.asyncio
    async def test_stale_created_fills_a_placeholder_account_number(self, mock_pool, stored, fills):
        """A row first made by a schedule event has its account id standing in
        for the account number. Only a stale account.created.v1 needs the extra
        statement: a current one overwrites the placeholder anyway."""
        mock_pool.set_fetchrow(_row(**{STATE: stored}))

        await handle_account_created(mock_pool, _created(1))

        placeholder_fills = [c for c in mock_pool.calls_against("loan_accounts") if PLACEHOLDER_FILL in c.sql]
        assert len(placeholder_fills) == (1 if fills else 0)
        if fills:
            assert placeholder_fills[0].sql.startswith("UPDATE loan_accounts SET account_number = $1 ")
            assert placeholder_fills[0].args == ("ACC-NUM-1", ACCOUNT_ID)

    @pytest.mark.asyncio
    async def test_stale_update_does_not_infer_a_payment_from_the_balance(self, mock_pool):
        """Stored balance 50, a stale event says 42: that is an older balance,
        not a repayment of 8."""
        mock_pool.set_fetchrow(_row(**{STATE: Decimal("5")}))

        await handle_account_updated(mock_pool, _updated(3))

        assert "last_payment" not in _write(mock_pool).sql

    @pytest.mark.asyncio
    async def test_current_update_still_infers_a_payment_from_the_balance(self, mock_pool):
        mock_pool.set_fetchrow(_row(**{STATE: Decimal("5")}))

        await handle_account_updated(mock_pool, _updated(6))

        assert _written(_write(mock_pool), "last_payment_amount") == 8.0

    @pytest.mark.asyncio
    async def test_status_regression_guard_still_applies_to_a_newer_version(self, mock_pool):
        """The version guard is an addition: a pre-disbursement status on a
        disbursed account is still dropped, however new the event is."""
        mock_pool.set_fetchrow(_row(**{STATE: Decimal("5")}))

        await handle_account_status_changed(
            mock_pool, _event(account_id=ACCOUNT_ID, new_status="PENDING", account_version=8)
        )

        assert not mock_pool.updates_to("loan_accounts")


# ---------------------------------------------------------------------------
# Schedule events
# ---------------------------------------------------------------------------


def _schedule_pool(mock_pool: Any, stored_after_upsert: Any) -> None:
    """fetchval answers, in order: the parent id, then the schedule version the
    row holds once the parent upsert has stored the higher of the two."""
    mock_pool.set_fetchval_sequence([PARENT_ID, stored_after_upsert])


def _payment_sql(mock_pool: Any) -> str:
    (call,) = [c for c in mock_pool.calls_against(PAYMENTS) if c.op == "INSERT"]
    return call.sql.split("DO UPDATE SET", 1)[1]


class TestAccountScheduleVersion:
    @pytest.mark.parametrize("handler, make_event", SCHEDULE_HANDLERS)
    @pytest.mark.parametrize("stored_before", [3, 8], ids=["newer", "equal-redelivery"])
    @pytest.mark.asyncio
    async def test_newer_or_equal_version_applies_and_is_stored(
        self, mock_pool, handler, make_event, stored_before
    ):
        """Stored 3 or stored 8, version 8 arrives: after the parent upsert the
        row holds 8 either way, and the payments are written as before."""
        _schedule_pool(mock_pool, Decimal(max(stored_before, 8)))

        with capture_logs() as captured:
            await handler(mock_pool, make_event(8))

        parent = _write(mock_pool)
        assert parent.values[SCHEDULE] == 8
        _assert_guarded(parent, SCHEDULE, STATE)
        assert not _stale_logs(captured)

        payments = _payment_sql(mock_pool)
        if handler is handle_schedule_updated:
            assert "status = EXCLUDED.status" in payments
            assert f"amount_paid = COALESCE(EXCLUDED.amount_paid, {PAYMENTS}.amount_paid)" in payments
        else:
            assert "due_date = EXCLUDED.due_date" in payments
            assert "amount = EXCLUDED.amount" in payments

    @pytest.mark.parametrize("handler, make_event", SCHEDULE_HANDLERS)
    @pytest.mark.asyncio
    async def test_older_version_overwrites_nothing_and_fills_empty_columns(
        self, mock_pool, handler, make_event
    ):
        """The row holds 9 and version 7 arrives. The parent columns go through
        the fill-only guard; each payment that exists keeps its values and only
        has its NULL ones filled; a payment that is missing is still inserted."""
        _schedule_pool(mock_pool, Decimal("9"))

        with capture_logs() as captured:
            await handler(mock_pool, make_event(7))

        _assert_guarded(_write(mock_pool), SCHEDULE, STATE)

        (stale,) = _stale_logs(captured)
        assert stale["log_level"] == "info"
        assert stale["incoming_account_version"] == 7
        assert stale["stored_account_version"] == 9

        assert len(mock_pool.inserts_into(PAYMENTS)) == 1
        payments = _payment_sql(mock_pool)
        assert "status =" not in payments
        assignments = [a.strip() for a in payments.strip().split(",\n")]
        for assignment in assignments:
            column = assignment.split(" = ")[0]
            assert assignment == f"{column} = COALESCE({PAYMENTS}.{column}, EXCLUDED.{column})"
        if handler is handle_schedule_updated:
            assert [a.split(" = ")[0] for a in assignments] == [
                "paid_date", "amount_paid", "amount_remaining", "linked_transaction_ids", "last_updated",
            ]
        else:
            assert [a.split(" = ")[0] for a in assignments] == ["due_date", "amount"]

    @pytest.mark.parametrize("handler, make_event", SCHEDULE_HANDLERS)
    @pytest.mark.asyncio
    async def test_unversioned_event_is_written_exactly_as_before(
        self, mock_pool, handler, make_event
    ):
        mock_pool.set_fetchval(PARENT_ID)

        with capture_logs() as captured:
            await handler(mock_pool, make_event(None))

        parent = _write(mock_pool)
        assert SCHEDULE not in parent.sql
        assert "CASE WHEN" not in parent.sql and "GREATEST" not in parent.sql
        # Only the parent id is looked up: the stored version is never read.
        assert mock_pool.fetchval.await_count == 1
        assert not _stale_logs(captured)

        payments = _payment_sql(mock_pool)
        if handler is handle_schedule_updated:
            assert "status = EXCLUDED.status" in payments
            assert "last_updated = EXCLUDED.last_updated" in payments
        else:
            assert "due_date = EXCLUDED.due_date" in payments
            assert f"WHEN {PAYMENTS}.status != 'scheduled'" in payments

    @pytest.mark.parametrize("handler, make_event", SCHEDULE_HANDLERS)
    @pytest.mark.asyncio
    async def test_a_higher_state_version_does_not_block_a_schedule_event(
        self, mock_pool, handler, make_event
    ):
        """State event 20 was applied first; schedule event 8 is compared with
        the schedule version only, which the parent upsert has just set to 8."""
        _schedule_pool(mock_pool, Decimal("8"))

        with capture_logs() as captured:
            await handler(mock_pool, make_event(8))

        parent = _write(mock_pool)
        assert STATE not in parent.sql
        version_reads = [c.sql for c in mock_pool.calls if c.op == "SELECT" and "version" in c.sql]
        assert version_reads == [f"SELECT {SCHEDULE} FROM loan_accounts WHERE id = $1"]
        assert not _stale_logs(captured)
        assert "= EXCLUDED." in _payment_sql(mock_pool)  # the normal statement, not the fill-only one
