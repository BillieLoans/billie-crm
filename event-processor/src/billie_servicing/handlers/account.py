"""Account event handlers using Billie Accounts SDK.

Handles events:
- account.created.v1
- account.updated.v1
- account.status_changed.v1
- account.closed.v1
- account.schedule.created.v1
- account.schedule.updated.v1
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg
import structlog

from ..db import coerce_date, update_by_key, upsert

logger = structlog.get_logger()

# SDK AccountStatus → Payload accountStatus mapping
SDK_STATUS_MAP = {
    "PENDING": "active",
    "PENDING_DISBURSEMENT": "pending_disbursement",
    "ACTIVE": "active",
    "SUSPENDED": "in_arrears",
    "CLOSED": "paid_off",
}

# AccountClosedV1.closure_reason → Payload accountStatus
CLOSURE_REASON_STATUS_MAP = {
    "PAID_OFF": "paid_off",
    "WRITTEN_OFF": "written_off",
    "ADMIN_CLOSED": "paid_off",
}


def _normalise_status(value: Any, default: str = "PENDING") -> str:
    """Strip the ``EnumName.MEMBER`` prefix that some Pydantic enums stringify with."""
    text = str(value) if value is not None else default
    return text.split(".")[-1] if "." in text else text


async def _resolve_customer_link(pool: asyncpg.Pool, customer_id: str | None) -> Any | None:
    """Look up customers.id (uuid) so Payload's relationship hydrates."""
    if not customer_id:
        return None
    return await pool.fetchval(
        "SELECT id FROM customers WHERE customer_id = $1", customer_id
    )


async def handle_account_created(pool: asyncpg.Pool, parsed_event: Any) -> None:
    """Handle account.created.v1 event."""
    payload = parsed_event.payload
    account_id = payload.account_id
    customer_id = payload.customer_id

    log = logger.bind(account_id=account_id, customer_id=customer_id)
    log.info("Processing account.created.v1")

    customer_ref_id = await _resolve_customer_link(pool, customer_id)

    sdk_status = _normalise_status(payload.status, default="PENDING")
    account_status = SDK_STATUS_MAP.get(sdk_status, "active")

    now = datetime.now(timezone.utc)
    values: dict[str, Any] = {
        "loan_account_id": account_id,
        "account_number": payload.account_number,
        "customer_id_id": customer_ref_id,
        "customer_id_string": customer_id,
        "loan_terms_loan_amount": float(payload.loan_amount) if payload.loan_amount else None,
        "loan_terms_loan_fee": float(payload.loan_fee) if payload.loan_fee else None,
        "loan_terms_total_payable": (
            float(payload.loan_total_payable) if payload.loan_total_payable else None
        ),
        "loan_terms_opened_date": coerce_date(payload.opened_date),
        "balances_current_balance": (
            float(payload.current_balance) if payload.current_balance else 0.0
        ),
        "balances_total_outstanding": (
            float(payload.current_balance) if payload.current_balance else 0.0
        ),
        "balances_total_paid": 0.0,
        "account_status": account_status,
        "sdk_status": sdk_status,
        "updated_at": now,
        "created_at": now,
    }

    signed_url = getattr(payload, "signed_loan_agreement_url", None)
    if signed_url is not None:
        values["signed_loan_agreement_url"] = str(signed_url) if signed_url else None

    await upsert(
        pool,
        "loan_accounts",
        conflict_columns=["loan_account_id"],
        values=values,
        insert_only_columns=["created_at"],
    )

    log.info("Loan account upserted")


async def handle_account_updated(pool: asyncpg.Pool, parsed_event: Any) -> None:
    """Handle account.updated.v1 event.

    Preserves the inference logic from the Mongo version:
    - If status is missing but a positive balance arrives while the account is
      `pending_disbursement`, infer the transition to ACTIVE.
    - On the pending_disbursement → active transition, stamp
      `loan_terms_disbursed_date` (idempotent on replay).
    - When a balance decrease arrives without an explicit last_payment_date,
      derive `last_payment_date`/`last_payment_amount` from the delta so the
      "Last payment" cell doesn't read "Never" forever.
    """
    payload = parsed_event.payload
    account_id = payload.account_id

    log = logger.bind(account_id=account_id)
    log.info("Processing account.updated.v1")

    now = datetime.now(timezone.utc)
    update_doc: dict[str, Any] = {"updated_at": now}
    existing: asyncpg.Record | None = None

    async def _load_existing() -> asyncpg.Record | None:
        nonlocal existing
        if existing is None:
            existing = await pool.fetchrow(
                "SELECT account_status, loan_terms_disbursed_date, balances_total_outstanding "
                "FROM loan_accounts WHERE loan_account_id = $1",
                account_id,
            )
        return existing

    current_balance_value: float | None = None
    if payload.current_balance is not None:
        current_balance_value = float(payload.current_balance)
        update_doc["balances_current_balance"] = current_balance_value
        update_doc["balances_total_outstanding"] = current_balance_value

    if payload.status:
        sdk_status = _normalise_status(payload.status)
        update_doc["sdk_status"] = sdk_status
        update_doc["account_status"] = SDK_STATUS_MAP.get(sdk_status, "active")
    elif current_balance_value is not None:
        row = await _load_existing()
        if (
            row
            and row["account_status"] == "pending_disbursement"
            and current_balance_value > 0
        ):
            update_doc["sdk_status"] = "ACTIVE"
            update_doc["account_status"] = "active"
            log.info(
                "Inferred status transition from pending_disbursement to active",
                current_balance=current_balance_value,
            )

    # Stamp disbursedDate on pending_disbursement → active transition.
    if update_doc.get("account_status") == "active":
        row = await _load_existing()
        if (
            row
            and row["account_status"] == "pending_disbursement"
            and not row["loan_terms_disbursed_date"]
        ):
            update_doc["loan_terms_disbursed_date"] = now
            log.info("Stamped disbursed_date on pending_disbursement → active transition")

    last_payment_date_set = False
    if getattr(payload, "last_payment_date", None):
        update_doc["last_payment_date"] = coerce_date(payload.last_payment_date)
        last_payment_date_set = True
    if getattr(payload, "last_payment_amount", None) is not None:
        update_doc["last_payment_amount"] = float(payload.last_payment_amount)

    # Fallback: stamp last_payment from a balance decrease.
    if (
        not last_payment_date_set
        and current_balance_value is not None
        and update_doc.get("account_status", "active") == "active"
    ):
        row = await _load_existing()
        existing_balance = row["balances_total_outstanding"] if row else None
        if existing_balance is not None and current_balance_value < float(existing_balance):
            delta = float(existing_balance) - current_balance_value
            update_doc["last_payment_date"] = now
            update_doc["last_payment_amount"] = delta
            log.info(
                "Inferred lastPayment from balance decrease",
                previous_balance=float(existing_balance),
                new_balance=current_balance_value,
                delta=delta,
            )

    if hasattr(payload, "signed_loan_agreement_url"):
        update_doc["signed_loan_agreement_url"] = (
            str(payload.signed_loan_agreement_url)
            if payload.signed_loan_agreement_url
            else None
        )

    status = await update_by_key(
        pool,
        "loan_accounts",
        key_column="loan_account_id",
        key_value=account_id,
        values=update_doc,
    )
    log.info("Loan account updated", asyncpg_status=status)


async def handle_account_status_changed(pool: asyncpg.Pool, parsed_event: Any) -> None:
    """Handle account.status_changed.v1 event."""
    payload = parsed_event.payload
    account_id = payload.account_id

    log = logger.bind(account_id=account_id)
    log.info("Processing account.status_changed.v1")

    sdk_status = _normalise_status(payload.new_status)
    account_status = SDK_STATUS_MAP.get(sdk_status, "active")
    now = datetime.now(timezone.utc)

    update_doc: dict[str, Any] = {
        "sdk_status": sdk_status,
        "account_status": account_status,
        "updated_at": now,
    }

    if account_status == "active":
        row = await pool.fetchrow(
            "SELECT account_status, loan_terms_disbursed_date "
            "FROM loan_accounts WHERE loan_account_id = $1",
            account_id,
        )
        if (
            row
            and row["account_status"] == "pending_disbursement"
            and not row["loan_terms_disbursed_date"]
        ):
            update_doc["loan_terms_disbursed_date"] = now
            log.info("Stamped disbursed_date on pending_disbursement → active transition")

    status = await update_by_key(
        pool,
        "loan_accounts",
        key_column="loan_account_id",
        key_value=account_id,
        values=update_doc,
    )
    log.info("Account status changed", new_status=account_status, asyncpg_status=status)


async def handle_account_closed(pool: asyncpg.Pool, parsed_event: Any) -> None:
    """Handle account.closed.v1 event (accounts SDK v2.8.0+).

    Maps SDK closure_reason → Payload accountStatus and persists a closure
    snapshot on the loan_accounts row. Idempotent: safe to replay.
    """
    payload = parsed_event.payload
    account_id = payload.account_id

    closure_reason = _normalise_status(
        getattr(payload, "closure_reason", "PAID_OFF") or "PAID_OFF",
        default="PAID_OFF",
    )
    account_status = CLOSURE_REASON_STATUS_MAP.get(closure_reason, "paid_off")

    log = logger.bind(account_id=account_id, closure_reason=closure_reason)
    log.info("Processing account.closed.v1")

    final_balance = (
        float(payload.final_balance) if payload.final_balance is not None else 0.0
    )
    total_paid = float(payload.total_paid) if payload.total_paid is not None else None
    now = datetime.now(timezone.utc)

    update_doc: dict[str, Any] = {
        "account_status": account_status,
        "sdk_status": "CLOSED",
        "balances_current_balance": final_balance,
        "balances_total_outstanding": final_balance,
        "closure_reason": closure_reason,
        "closure_previous_status": payload.previous_status,
        "closure_closed_date": coerce_date(payload.closed_date),
        "closure_final_balance": final_balance,
        "closure_loan_total_payable": (
            float(payload.loan_total_payable)
            if payload.loan_total_payable is not None
            else None
        ),
        "closure_triggered_by_transaction_id": getattr(
            payload, "triggered_by_transaction_id", None
        ),
        "updated_at": now,
    }
    if total_paid is not None:
        update_doc["balances_total_paid"] = total_paid
        update_doc["closure_total_paid"] = total_paid

    status = await update_by_key(
        pool,
        "loan_accounts",
        key_column="loan_account_id",
        key_value=account_id,
        values=update_doc,
    )
    log.info(
        "Loan account closed",
        new_status=account_status,
        final_balance=final_balance,
        asyncpg_status=status,
    )


async def _get_parent_id(pool_or_conn: Any, account_id: str) -> Any | None:
    """Resolve loan_accounts.id (uuid) from the natural loan_account_id."""
    return await pool_or_conn.fetchval(
        "SELECT id FROM loan_accounts WHERE loan_account_id = $1", account_id
    )


async def handle_schedule_created(pool: asyncpg.Pool, parsed_event: Any) -> None:
    """Handle account.schedule.created.v1 event.

    Writes the parent loan_accounts.repayment_schedule_* columns and then
    upserts every payment row into the schedule-payments child table. The
    out-of-order placeholder pattern from the Mongo version collapses into a
    CASE on the status column — any payment that's already past 'scheduled'
    (e.g. arrived via schedule.updated earlier) keeps its advanced state and
    just gets its due_date/amount backfilled.
    """
    payload = parsed_event.payload
    account_id = payload.account_id

    log = logger.bind(account_id=account_id, schedule_id=payload.schedule_id)
    log.info("Processing account.schedule.created.v1")

    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        async with conn.transaction():
            # Update parent row's schedule columns first (creates the loan_accounts
            # row if missing, so the child upserts can resolve _parent_id).
            await upsert(
                conn,
                "loan_accounts",
                conflict_columns=["loan_account_id"],
                values={
                    "loan_account_id": account_id,
                    "account_number": account_id,  # required NOT NULL; will be overwritten by account.created.v1
                    "repayment_schedule_schedule_id": payload.schedule_id,
                    "repayment_schedule_number_of_payments": payload.n_payments,
                    "repayment_schedule_payment_frequency": payload.payment_frequency,
                    "repayment_schedule_created_date": coerce_date(payload.created_date),
                    "account_status": "active",  # required NOT NULL
                    "updated_at": now,
                    "created_at": now,
                },
                insert_only_columns=["created_at", "account_number", "account_status"],
            )

            parent_id = await _get_parent_id(conn, account_id)
            if parent_id is None:
                log.error("Parent loan_account row missing after upsert")
                return

            payments = payload.payments or []
            preserved = 0
            for payment in payments:
                amount_value = float(payment.amount) if payment.amount else None
                # CASE preserves any non-'scheduled' status that already exists.
                result = await conn.execute(
                    """
                    INSERT INTO loan_accounts_repayment_schedule_payments
                      (id, _order, _parent_id, payment_number, due_date, amount, status)
                    VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
                    ON CONFLICT (_parent_id, payment_number) DO UPDATE SET
                      due_date = EXCLUDED.due_date,
                      amount = EXCLUDED.amount,
                      status = CASE
                        WHEN loan_accounts_repayment_schedule_payments.status != 'scheduled'
                          THEN loan_accounts_repayment_schedule_payments.status
                        ELSE EXCLUDED.status
                      END
                    """,
                    str(uuid.uuid4()),
                    int(payment.payment_number),
                    parent_id,
                    int(payment.payment_number),
                    coerce_date(payment.due_date),
                    amount_value,
                )
                if result.startswith("INSERT 0 0"):
                    preserved += 1

            log.info("Repayment schedule projected", num_payments=len(payments), preserved=preserved)


async def handle_schedule_updated(pool: asyncpg.Pool, parsed_event: Any) -> None:
    """Handle account.schedule.updated.v1 event.

    Single upsert per payment on the composite ``(_parent_id, payment_number)``
    natural key — the Mongo positional/placeholder pattern disappears
    entirely. Rows that don't yet exist are created (with due_date/amount as
    NULL — they'll be backfilled when schedule.created arrives); rows that
    exist get their status/paid_date/amount_paid/amount_remaining refreshed.
    """
    payload = parsed_event.payload
    account_id = payload.account_id
    schedule_id = getattr(payload, "schedule_id", None)

    log = logger.bind(account_id=account_id, schedule_id=schedule_id)
    log.info("Processing account.schedule.updated.v1")

    payment_updates = payload.payments or []
    if not payment_updates:
        log.warning("No payment updates in event")
        return

    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        async with conn.transaction():
            # Ensure a parent row exists so we can resolve _parent_id. If the
            # loan_accounts row hasn't been created yet (account.created.v1
            # arrives later), insert a stub that account.created.v1 will fill
            # in. We mark account_number as the account_id as a placeholder.
            await upsert(
                conn,
                "loan_accounts",
                conflict_columns=["loan_account_id"],
                values={
                    "loan_account_id": account_id,
                    "account_number": account_id,
                    "account_status": "active",
                    "updated_at": now,
                    "created_at": now,
                },
                insert_only_columns=[
                    "created_at",
                    "account_number",
                    "account_status",
                ],
            )

            parent_id = await _get_parent_id(conn, account_id)
            if parent_id is None:
                log.error("Parent loan_account row missing after stub upsert")
                return

            for payment in payment_updates:
                payment_number = int(payment.payment_number)
                new_status = (str(payment.status).lower() if payment.status else "scheduled")
                # Map the SDK string status onto the Payload select enum.
                if "." in new_status:
                    new_status = new_status.split(".")[-1]

                paid_date = coerce_date(getattr(payment, "paid_date", None))
                amount_paid = (
                    float(payment.amount_paid)
                    if getattr(payment, "amount_paid", None) is not None
                    else None
                )
                amount_remaining = (
                    float(payment.amount_remaining)
                    if getattr(payment, "amount_remaining", None) is not None
                    else None
                )
                # linked_transaction_ids is a jsonb column. asyncpg needs a JSON
                # *string* for jsonb (no list/dict codec is registered) — passing a
                # raw Python list raises DataError. Serialise it like db.merge_jsonb.
                linked_ids = (
                    json.dumps(list(payment.linked_transaction_ids))
                    if getattr(payment, "linked_transaction_ids", None)
                    else None
                )
                last_updated = coerce_date(getattr(payment, "last_updated", None)) or now

                await conn.execute(
                    """
                    INSERT INTO loan_accounts_repayment_schedule_payments
                      (id, _order, _parent_id, payment_number,
                       status, paid_date, amount_paid, amount_remaining,
                       linked_transaction_ids, last_updated)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
                    ON CONFLICT (_parent_id, payment_number) DO UPDATE SET
                      status = EXCLUDED.status,
                      paid_date = COALESCE(EXCLUDED.paid_date, loan_accounts_repayment_schedule_payments.paid_date),
                      amount_paid = COALESCE(EXCLUDED.amount_paid, loan_accounts_repayment_schedule_payments.amount_paid),
                      amount_remaining = COALESCE(EXCLUDED.amount_remaining, loan_accounts_repayment_schedule_payments.amount_remaining),
                      linked_transaction_ids = COALESCE(EXCLUDED.linked_transaction_ids, loan_accounts_repayment_schedule_payments.linked_transaction_ids),
                      last_updated = EXCLUDED.last_updated
                    """,
                    str(uuid.uuid4()),
                    payment_number,
                    parent_id,
                    payment_number,
                    new_status,
                    paid_date,
                    amount_paid,
                    amount_remaining,
                    linked_ids,
                    last_updated,
                )

            log.info("Repayment schedule updated", payments=len(payment_updates))
