"""Collection case event handlers (read-only projection — Stream D / BTB-199).

Consumes the ``collection.case.*`` events the headless collectionsService
(BTB-166) emits to ChatLedger and projects them into the ``collection_cases``
table, keyed by ``account_id`` (one case per advance):

- collection.case.opened.v1                → state = 'open'
- collection.case.exhausted.v1             → state = 'awaiting_human'
- collection.case.cured.v1                 → state = 'cured'
- collection.case.hardship_paused.v1       → hardship_paused = True  (flag only)
- collection.case.resumed.v1               → hardship_paused = False (flag only)
- collection.case.stop_contact_applied.v1  → stopped_contact = True  (flag only)
- collection.case.step_advanced.v1         → rung = step (flag only, BTB-199 residual)

Handlers receive the flat ``billie_collection_events`` pydantic model (the
event *is* the payload — ``account_id``/``customer_id``/… are top-level
attributes, with ``event_id``/``timestamp``/``correlation_id`` from the common
base). ``customer_id`` is the real id (BTB-154 provenance, sourced by the
engine), so it is safe to resolve the customers relationship from it.

The state events (opened/exhausted/cured) own ``state``; the flag events
(hardship/resume/stop-contact/step-advanced) deliberately do NOT write
``state`` so a cross-cutting flag never clobbers the lifecycle. Every write is
an idempotent upsert, so redelivery and out-of-order arrival converge.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import asyncpg
import structlog

from ..db import coerce_date, upsert

logger = structlog.get_logger()

TABLE = "collection_cases"


async def _resolve_customer_link(pool: asyncpg.Pool, customer_id: str | None) -> Any | None:
    """Look up customers.id (uuid) so Payload's relationship hydrates.

    Returns None if the customer isn't projected yet — the ``customer_id``
    string is still stored for later joining.
    """
    if not customer_id:
        return None
    return await pool.fetchval(
        "SELECT id FROM customers WHERE customer_id = $1", customer_id
    )


def _to_amount(value: Any) -> float | None:
    """Coerce the event's decimal-string amount to a float for the snapshot."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def _upsert_case(
    pool: asyncpg.Pool,
    *,
    account_id: str,
    customer_id: str | None,
    extra: dict[str, Any],
) -> None:
    """Upsert a collection_cases row keyed on account_id.

    ``extra`` carries the event-specific columns. Identity + bookkeeping columns
    are filled here so every handler stays a thin mapping.
    """
    now = datetime.now(timezone.utc)
    customer_ref_id = await _resolve_customer_link(pool, customer_id)
    values: dict[str, Any] = {
        "account_id": account_id,
        "customer_id": customer_id,
        "customer_ref_id": customer_ref_id,
        "updated_at": now,
        "created_at": now,
        **extra,
    }
    await upsert(
        pool,
        TABLE,
        conflict_columns=["account_id"],
        values=values,
        insert_only_columns=["created_at"],
    )


async def handle_collection_case_opened(pool: asyncpg.Pool, event: Any) -> None:
    """Project collection.case.opened.v1 — overdue series started."""
    log = logger.bind(account_id=event.account_id, customer_id=event.customer_id)
    log.info("Processing collection.case.opened.v1")
    await _upsert_case(
        pool,
        account_id=event.account_id,
        customer_id=event.customer_id,
        extra={
            "state": "open",
            "overdue_amount": _to_amount(event.overdue_amount),
            "due_date": coerce_date(event.due_date),
            "opened_at": coerce_date(event.timestamp),
            "correlation_id": event.correlation_id,
        },
    )
    log.info("Collection case opened projected")


async def handle_collection_case_exhausted(pool: asyncpg.Pool, event: Any) -> None:
    """Project collection.case.exhausted.v1 — spine ended unpaid, needs a human."""
    log = logger.bind(account_id=event.account_id, customer_id=event.customer_id)
    log.info("Processing collection.case.exhausted.v1")
    await _upsert_case(
        pool,
        account_id=event.account_id,
        customer_id=event.customer_id,
        extra={
            "state": "awaiting_human",
            "overdue_amount": _to_amount(event.overdue_amount),
            "days_overdue": event.days_overdue,
            "last_step": event.last_step,
            "exhausted_at": coerce_date(event.timestamp),
            "correlation_id": event.correlation_id,
        },
    )
    log.info("Collection case exhausted projected")


async def handle_collection_case_cured(pool: asyncpg.Pool, event: Any) -> None:
    """Project collection.case.cured.v1 — balance cleared, clean close."""
    log = logger.bind(account_id=event.account_id, customer_id=event.customer_id)
    log.info("Processing collection.case.cured.v1")
    await _upsert_case(
        pool,
        account_id=event.account_id,
        customer_id=event.customer_id,
        extra={
            "state": "cured",
            "cured_at": coerce_date(event.cured_at),
            "correlation_id": event.correlation_id,
        },
    )
    log.info("Collection case cured projected")


async def handle_collection_case_hardship_paused(pool: asyncpg.Pool, event: Any) -> None:
    """Project collection.case.hardship_paused.v1 — flag only, state untouched."""
    log = logger.bind(account_id=event.account_id, customer_id=event.customer_id)
    log.info("Processing collection.case.hardship_paused.v1")
    await _upsert_case(
        pool,
        account_id=event.account_id,
        customer_id=event.customer_id,
        extra={
            "hardship_paused": True,
            "paused_at": coerce_date(event.paused_at),
            "correlation_id": event.correlation_id,
        },
    )
    log.info("Collection case hardship pause projected")


async def handle_collection_case_resumed(pool: asyncpg.Pool, event: Any) -> None:
    """Project collection.case.resumed.v1 — operator hand-back, clears the flag."""
    log = logger.bind(account_id=event.account_id, customer_id=event.customer_id)
    log.info("Processing collection.case.resumed.v1")
    await _upsert_case(
        pool,
        account_id=event.account_id,
        customer_id=event.customer_id,
        extra={
            "hardship_paused": False,
            "resumed_at": coerce_date(event.resumed_at),
            "correlation_id": event.correlation_id,
        },
    )
    log.info("Collection case resume projected")


async def handle_collection_case_stop_contact_applied(pool: asyncpg.Pool, event: Any) -> None:
    """Project collection.case.stop_contact_applied.v1 — flag only, state untouched."""
    log = logger.bind(account_id=event.account_id, customer_id=event.customer_id)
    log.info("Processing collection.case.stop_contact_applied.v1")
    await _upsert_case(
        pool,
        account_id=event.account_id,
        customer_id=event.customer_id,
        extra={
            "stopped_contact": True,
            "stop_contact_at": coerce_date(event.applied_at),
            "correlation_id": event.correlation_id,
        },
    )
    log.info("Collection case stop-contact projected")


async def handle_collection_case_step_advanced(pool: asyncpg.Pool, event: Any) -> None:
    """Project collection.case.step_advanced.v1 — current rung (reminder step just sent),
    flag only, state untouched."""
    log = logger.bind(account_id=event.account_id, customer_id=event.customer_id)
    log.info("Processing collection.case.step_advanced.v1")
    step = int(event.step)
    await _upsert_case(
        pool,
        account_id=event.account_id,
        customer_id=event.customer_id,
        extra={
            "rung": step,
            "last_step": step,
            "correlation_id": event.correlation_id,
        },
    )
    log.info("Collection case step advance projected")
