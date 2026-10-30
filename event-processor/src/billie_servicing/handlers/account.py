"""Account event handlers using Billie Accounts SDK.

Handles events:
- account.created.v1
- account.updated.v1
- account.status_changed.v1
- account.closed.v1
- account.cancelled.v1
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
    "CANCELLED": "cancelled",
}

# AccountClosedV1.closure_reason → Payload accountStatus
CLOSURE_REASON_STATUS_MAP = {
    "PAID_OFF": "paid_off",
    "WRITTEN_OFF": "written_off",
    "ADMIN_CLOSED": "paid_off",
}

# SDK PaymentStatus → Payload repayment-schedule enum
# (enum_loan_accounts_repayment_schedule_payments_status:
# scheduled/paid/partial/missed/void).
# Keyed by the upper-cased status member; already-Payload values map to themselves.
SCHEDULE_PAYMENT_STATUS_MAP = {
    "PENDING": "scheduled",
    "SCHEDULED": "scheduled",
    "PARTIAL": "partial",
    "PAID": "paid",
    "OVERDUE": "missed",
    "MISSED": "missed",
    # BTB-517: every instalment of a cancelled-before-disbursement loan.
    "VOID": "void",
}


def _normalise_status(value: Any, default: str = "PENDING") -> str:
    """Strip the ``EnumName.MEMBER`` prefix that some Pydantic enums stringify with."""
    text = str(value) if value is not None else default
    return text.split(".")[-1] if "." in text else text


# One-way disbursement gate (prod incident 2026-08-17, account VNUR7Z4N8ZLJ):
# accountsService can publish an account.updated.v1 carrying a stale
# pre-transition snapshot (status PENDING_DISBURSEMENT on the establishment-fee
# event) after the ACTIVE disbursement event, and with two CRM machines in the
# same consumer group there is no cross-consumer ordering — the stale event can
# be applied last. The BTB-256 finding still holds (no reliable ordering field,
# so no general skip-stale guard), but the disbursement gate is strictly
# one-way in the domain: once money is out the door no legitimate transition
# returns an account to PENDING/PENDING_DISBURSEMENT, so that narrow
# regression is safe to drop.
PRE_DISBURSEMENT_SDK_STATUSES = frozenset({"PENDING", "PENDING_DISBURSEMENT"})
POST_DISBURSEMENT_SDK_STATUSES = frozenset({"ACTIVE", "SUSPENDED", "CLOSED"})


# Terminal cancellation gate (BTB-517): a loan cancelled before disbursement
# is CANCELLED for good. account.cancelled.v1, the follow-up account.updated.v1
# (status CANCELLED) and the schedule VOID update reach the CRM in no guaranteed
# order, and a stale PENDING_DISBURSEMENT account.updated.v1 emitted before the
# cancel can be applied after it. Unlike the one-way disbursement gate above,
# which only drops a *pre*-disbursement status, nothing legitimate leaves
# CANCELLED, so once the stored row is cancelled NO incoming status is applied
# - whatever event carries it. Every writer of ``account_status`` below routes
# through ``_status_block_reason`` / ``_is_status_regression``.
CANCELLED_ACCOUNT_STATUS = "cancelled"
CANCELLED_SDK_STATUS = "CANCELLED"


def _is_account_cancelled(row: Any) -> bool:
    """True when the stored projection is already cancelled. ``row`` may be an
    asyncpg.Record or dict and may lack either column (legacy rows / older
    query shapes) - absence of evidence means not cancelled."""
    if row is None:
        return False
    return (
        row.get("account_status") == CANCELLED_ACCOUNT_STATUS
        or row.get("sdk_status") == CANCELLED_SDK_STATUS
    )


def _status_block_reason(incoming_sdk_status: str, row: Any) -> str | None:
    """Why an incoming status must be dropped for the stored ``row``, or None
    when it may be applied."""
    if row is None:
        return None
    if _is_account_cancelled(row):
        return "stored projection is cancelled (terminal)"
    if incoming_sdk_status not in PRE_DISBURSEMENT_SDK_STATUSES:
        return None
    if row.get("sdk_status") in POST_DISBURSEMENT_SDK_STATUSES or row.get(
        "loan_terms_disbursed_date"
    ):
        return "stored projection is already disbursed"
    return None


def _is_status_regression(incoming_sdk_status: str, row: Any) -> bool:
    """True when ``incoming_sdk_status`` must not be applied to the stored
    projection: either a pre-disbursement status arriving for an account the
    row shows has already been disbursed, or ANY status arriving for an
    account the row shows is cancelled. ``row`` may be an asyncpg.Record or
    dict and may lack either evidence column (legacy rows/older query shapes)
    - absence of evidence means no regression."""
    return _status_block_reason(incoming_sdk_status, row) is not None


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

    existing_row = await pool.fetchrow(
        "SELECT account_status, sdk_status, loan_terms_disbursed_date "
        "FROM loan_accounts WHERE loan_account_id = $1",
        account_id,
    )

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

    commencement_date = getattr(payload, "commencement_date", None)
    if commencement_date is not None:
        values["commencement_date"] = coerce_date(commencement_date)

    signed_url = getattr(payload, "signed_loan_agreement_url", None)
    if signed_url is not None:
        values["signed_loan_agreement_url"] = str(signed_url) if signed_url else None

    # Nominated salary account (accounts-v2.11.0+). getattr-guarded like the two
    # fields above so an older SDK in the venv can't AttributeError the handler.
    # Written per-field rather than as a blob: the disbursement queue renders each
    # value as its own copy target, and a partial account (BSB known, number not)
    # must still land so the row can be shown and flagged.
    # Customer-facing loan reference — goes in the Osko payment message so the
    # morning statement recon can tie the payment back to the loan.
    application_number = getattr(payload, "application_number", None)
    if application_number is not None:
        values["application_number"] = str(application_number) if application_number else None

    disbursement_account = getattr(payload, "disbursement_account", None)
    if disbursement_account is not None:
        values["disbursement_account_holder"] = disbursement_account.holder
        values["disbursement_account_bsb"] = disbursement_account.bsb
        values["disbursement_account_number"] = disbursement_account.number

    # A replayed account.created.v1 carries the original pre-disbursement
    # snapshot; dropping the status keys is safe because the regression check
    # only fires when the row already exists (so the INSERT branch — where
    # account_status is NOT NULL — can't be taken). The same replay must not
    # un-cancel a cancelled loan (BTB-517).
    block_reason = _status_block_reason(sdk_status, existing_row)
    if block_reason:
        log.warning(
            "Ignoring status regression on account.created.v1 replay — "
            "other fields in this event still apply",
            block_reason=block_reason,
            incoming_sdk_status=sdk_status,
            stored_sdk_status=existing_row.get("sdk_status"),
        )
        del values["account_status"]
        del values["sdk_status"]

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

    Ordering (BTB-256 crm half / Task 40): account.updated.v1 carries NO
    reliable monotonic ordering field by the time it reaches this handler.
    ``triggered_by_transaction_id`` is an opaque ``str`` — usually the
    ledger's globally-incrementing ``TXN-YYYY-NNNNNNNN`` id, but on the
    disbursement path it falls back to a differently-shaped
    ``conversation_id`` when ``disbursement_transaction_id`` is absent
    (accountsService.event_handlers._publish_account_updated_event_from_disbursement),
    so it isn't safely comparable across all publish sites. The chatLedger
    envelope's ``seq`` is hardcoded to ``1`` for every domain event
    (accountsService never passes an explicit ``seq`` for this event type),
    so it's useless too. A hard-skip guard keyed on either would risk
    silently dropping legitimate updates. So this only LOGS a staleness
    warning (payload `timestamp` older than the stored projection's
    `updated_at`) and always still applies the write — mirroring the DLQ
    `extra_original_event_timestamp` staleness-triage convention from
    Task 39/BTB-256 (platform half), where timestamp is informational only.
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
                "SELECT account_status, sdk_status, loan_terms_disbursed_date, "
                "balances_total_outstanding, updated_at "
                "FROM loan_accounts WHERE loan_account_id = $1",
                account_id,
            )
        return existing

    # Log-only staleness warning — see the docstring's "Ordering" note for
    # why this can't be a hard-skip guard. Never blocks/skips the write;
    # any failure here (missing column, naive/aware datetime mismatch) is
    # swallowed so staleness triage can never break projection updates.
    # Strict `<` (not `<=`) is deliberate: an incoming timestamp exactly equal
    # to the stored projection's updated_at (e.g. same-instant redelivery of
    # the same event) is not stale and must not warn.
    incoming_timestamp = getattr(payload, "timestamp", None)
    if isinstance(incoming_timestamp, datetime):
        try:
            row = await _load_existing()
            stored_updated_at = row["updated_at"] if row is not None else None
            if (
                isinstance(stored_updated_at, datetime)
                and incoming_timestamp < stored_updated_at
            ):
                log.warning(
                    "Possible out-of-order account.updated.v1: event timestamp "
                    "is older than the stored projection's updated_at. No "
                    "reliable ordering field exists on this payload, so this "
                    "is a log-only staleness warning — the write is still "
                    "applied.",
                    incoming_event_timestamp=incoming_timestamp.isoformat(),
                    stored_updated_at=stored_updated_at.isoformat(),
                )
        except (KeyError, TypeError):
            pass

    current_balance_value: float | None = None
    if payload.current_balance is not None:
        current_balance_value = float(payload.current_balance)
        update_doc["balances_current_balance"] = current_balance_value
        update_doc["balances_total_outstanding"] = current_balance_value

    if payload.status:
        sdk_status = _normalise_status(payload.status)
        row = await _load_existing()
        block_reason = _status_block_reason(sdk_status, row)
        if block_reason:
            log.warning(
                "Ignoring status regression on account.updated.v1 — "
                "other fields in this event still apply",
                block_reason=block_reason,
                incoming_sdk_status=sdk_status,
                stored_sdk_status=row.get("sdk_status"),
            )
        else:
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

    # Fallback: stamp last_payment from a balance decrease — but only when the
    # triggering ledger transaction was (or could have been) a repayment. The
    # disbursement-path event reports a fee-related balance dip (52.50 → 50.00,
    # trigger DISBURSEMENT) that stamped a phantom "last payment" on freshly
    # disbursed accounts; waivers/write-offs/adjustments also decrease the
    # balance without any customer payment. Absent trigger = legacy event,
    # keep inferring.
    trigger_type = _normalise_status(
        getattr(payload, "triggered_by_transaction_type", None), default=""
    )
    if (
        not last_payment_date_set
        and current_balance_value is not None
        and update_doc.get("account_status", "active") == "active"
        and trigger_type in ("", "REPAYMENT")
    ):
        row = await _load_existing()
        existing_balance = row["balances_total_outstanding"] if row else None
        # A dropped status leaves update_doc without account_status, which the
        # "active" default above reads as "a repayment may have happened".
        # Acceptable for the disbursement gate; a cancelled loan can never have
        # been repaid, so never infer a payment onto one (BTB-517).
        if (
            existing_balance is not None
            and not _is_account_cancelled(row)
            and current_balance_value < float(existing_balance)
        ):
            delta = float(existing_balance) - current_balance_value
            update_doc["last_payment_date"] = now
            update_doc["last_payment_amount"] = delta
            log.info(
                "Inferred lastPayment from balance decrease",
                previous_balance=float(existing_balance),
                new_balance=current_balance_value,
                delta=delta,
            )

    # Only update commencement_date when the field is present AND non-None —
    # don't overwrite an existing value with None on unrelated account.updated.v1
    # events (mirrors how signed_loan_agreement_url is handled via hasattr).
    _commencement_date = getattr(payload, "commencement_date", None)
    if _commencement_date is not None:
        update_doc["commencement_date"] = coerce_date(_commencement_date)

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

    row = await pool.fetchrow(
        "SELECT account_status, sdk_status, loan_terms_disbursed_date "
        "FROM loan_accounts WHERE loan_account_id = $1",
        account_id,
    )

    block_reason = _status_block_reason(sdk_status, row)
    if block_reason:
        log.warning(
            "Ignoring status regression on account.status_changed.v1",
            block_reason=block_reason,
            incoming_sdk_status=sdk_status,
            stored_sdk_status=row.get("sdk_status"),
        )
        return

    update_doc: dict[str, Any] = {
        "sdk_status": sdk_status,
        "account_status": account_status,
        "updated_at": now,
    }

    if account_status == "active":
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

    # Cancelled is terminal (BTB-517): the platform cannot close a cancelled
    # loan, so a closure event for one is contradictory. Drop it whole - unlike
    # a stale status on account.updated.v1, its other fields (closure_* snapshot,
    # zeroed balances) would only describe a closure that never happened.
    stored = await pool.fetchrow(
        "SELECT account_status, sdk_status FROM loan_accounts "
        "WHERE loan_account_id = $1",
        account_id,
    )
    if _is_account_cancelled(stored):
        log.warning(
            "Ignoring account.closed.v1 for a cancelled account — "
            "cancelled is terminal",
            stored_account_status=stored.get("account_status"),
        )
        return

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


async def handle_account_cancelled(pool: asyncpg.Pool, parsed_event: Any) -> None:
    """Handle account.cancelled.v1 event (accounts SDK v2.12.0+, BTB-517).

    Projects the cancellation directly: ``account_status='cancelled'`` plus the
    full cancellation record (reason, note, evidence, who, when). It does NOT
    wait for the follow-up account.updated.v1 (status CANCELLED), which may
    arrive before, after or never - ``account_status`` must be right from this
    event alone. Balances and the repayment schedule are left to those follow-up
    events. Idempotent: replaying writes the same values.

    Cancelled is terminal; later events cannot change ``account_status`` (see
    ``_status_block_reason``).
    """
    payload = parsed_event.payload
    account_id = payload.account_id

    # reason_code is a str-Enum on the SDK model; stringifying the member
    # itself would store "CancellationReason.CUSTOMER_WITHDREW".
    reason = getattr(payload.reason_code, "value", payload.reason_code)
    cancelled_by = payload.cancelled_by

    log = logger.bind(account_id=account_id, cancellation_reason=reason)
    log.info("Processing account.cancelled.v1")

    update_doc: dict[str, Any] = {
        "account_status": CANCELLED_ACCOUNT_STATUS,
        "sdk_status": CANCELLED_SDK_STATUS,
        "cancellation_reason": reason,
        "cancellation_note": payload.note,
        "cancellation_evidence_ref": getattr(payload, "evidence_ref", None),
        "cancellation_cancelled_by_id": cancelled_by.id,
        "cancellation_cancelled_by_name": cancelled_by.name,
        "cancellation_cancelled_at": coerce_date(payload.cancelled_at),
        "updated_at": datetime.now(timezone.utc),
    }

    status = await update_by_key(
        pool,
        "loan_accounts",
        key_column="loan_account_id",
        key_value=account_id,
        values=update_doc,
    )
    if status.endswith(" 0"):
        # No loan_accounts row yet (account.created.v1 not projected): nothing
        # was cancelled in the CRM. Like handle_account_closed this is an
        # UPDATE-only projection, so only a replay after account.created.v1
        # recovers it - make the gap visible rather than silent.
        log.warning(
            "account.cancelled.v1 matched no loan_accounts row",
            asyncpg_status=status,
        )
        return
    log.info("Loan account cancelled", asyncpg_status=status)


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
                # Map the SDK PaymentStatus (PENDING/PARTIAL/PAID/OVERDUE) onto the
                # Payload repayment-schedule enum (scheduled/partial/paid/missed).
                # Unknown values fall back to 'scheduled' so the upsert never fails
                # the enum check.
                raw_status = _normalise_status(payment.status, "PENDING").upper()
                new_status = SCHEDULE_PAYMENT_STATUS_MAP.get(raw_status, "scheduled")

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
