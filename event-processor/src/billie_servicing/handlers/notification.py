"""Notification event handlers (read-only audit projections).

Handles events from the platform notification dispatcher:
- notification.sent.v1
- notification.delivery_failed.v1
- notification.suppression.changed.v1
- statement.generated.v1

All four projections land in the ``notifications`` table, keyed by
``notification_id``, with ``status`` as the discriminator:
- ``sent``      — successful delivery
- ``failed``    — provider/recipient error
- ``blocked``   — delivery_failed with error_type == "suppressed"
- ``suppression_change`` — suppression mode flip (kill-switch on/off)
- ``statement`` — statement.generated audit marker

The unified shape lets the CRM render a single chronological timeline in the
customer view's Communications panel.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import asyncpg
import structlog

from ..db import upsert

logger = structlog.get_logger()

# Must match the Payload `notification.suppression.mode` select options
# (enum_notifications_suppression_mode in the database).
_SUPPRESSION_MODES = frozenset(
    {"all", "non_essential", "marketing_only", "panic_button", "off"}
)


async def _resolve_customer_link(pool: asyncpg.Pool, customer_id: str | None) -> Any | None:
    """Look up the customers.id (uuid) so Payload's relationship hydrates.

    Returns None silently if the customer isn't in the projection yet — the
    ``customer_id`` string is still stored for later joining via queries.
    """
    if not customer_id:
        return None
    return await pool.fetchval(
        "SELECT id FROM customers WHERE customer_id = $1", customer_id
    )


def _coerce_dt(value: Any) -> datetime | None:
    """Coerce a Pydantic-parsed date/datetime field to a tz-aware datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


async def handle_notification_sent(pool: asyncpg.Pool, parsed_event: Any) -> None:
    """Project notification.sent.v1 into the notifications table."""
    payload = parsed_event.payload
    notification_id = payload.notification_id
    customer_id = payload.customer_id

    log = logger.bind(
        notification_id=notification_id,
        customer_id=customer_id,
        template=payload.template_name,
    )
    log.info("Processing notification.sent.v1")

    customer_ref_id = await _resolve_customer_link(pool, customer_id)
    now = datetime.now(timezone.utc)
    tags = payload.tags or {}

    await upsert(
        pool,
        "notifications",
        conflict_columns=["notification_id"],
        values={
            "notification_id": notification_id,
            "idempotency_key": payload.idempotency_key,
            "request_id": payload.request_id,
            "status": "sent",
            "channel": payload.channel,
            "template_name": payload.template_name,
            "template_content_hash": payload.template_content_hash or None,
            "template_git_sha": payload.template_git_sha,
            "provider": payload.provider,
            "provider_message_id": payload.provider_message_id,
            "recipient_hash": payload.recipient_hash,
            "customer_id": customer_id,
            "customer_ref_id": customer_ref_id,
            "correlation_id": payload.correlation_id,
            "event_at": _coerce_dt(payload.sent_at),
            "sent_at": _coerce_dt(payload.sent_at),
            "tags_category": tags.get("category"),
            "tags_reason": tags.get("reason"),
            "tags_step": tags.get("step"),
            "updated_at": now,
            "created_at": now,
        },
        insert_only_columns=["created_at"],
    )

    log.info("Notification sent projected")


async def handle_notification_delivery_failed(
    pool: asyncpg.Pool, parsed_event: Any
) -> None:
    """Project notification.delivery_failed.v1 into the notifications table.

    error_type == "suppressed" is mapped to status="blocked" so the UI can
    distinguish kill-switch blocks from generic failures.
    """
    payload = parsed_event.payload
    notification_id = payload.notification_id
    customer_id = payload.customer_id
    error_type = payload.error_type
    status = "blocked" if error_type == "suppressed" else "failed"

    log = logger.bind(
        notification_id=notification_id,
        customer_id=customer_id,
        template=payload.template_name,
        error_type=error_type,
        mapped_status=status,
    )
    log.info("Processing notification.delivery_failed.v1")

    customer_ref_id = await _resolve_customer_link(pool, customer_id)
    now = datetime.now(timezone.utc)
    tags = payload.tags or {}

    await upsert(
        pool,
        "notifications",
        conflict_columns=["notification_id"],
        values={
            "notification_id": notification_id,
            "idempotency_key": payload.idempotency_key,
            "request_id": payload.request_id,
            "status": status,
            "channel": payload.channel,
            "template_name": payload.template_name,
            "template_content_hash": payload.template_content_hash or None,
            "template_git_sha": payload.template_git_sha,
            "provider": payload.provider,
            "recipient_hash": payload.recipient_hash,
            "customer_id": customer_id,
            "customer_ref_id": customer_ref_id,
            "correlation_id": payload.correlation_id,
            "event_at": _coerce_dt(payload.failed_at),
            "tags_category": tags.get("category"),
            "tags_reason": tags.get("reason"),
            "tags_step": tags.get("step"),
            "failure_failed_at": _coerce_dt(payload.failed_at),
            "failure_error_type": error_type,
            "failure_error_message": payload.error_message,
            "failure_attempt": payload.attempt,
            "failure_fallback_suggested": payload.fallback_suggested,
            "updated_at": now,
            "created_at": now,
        },
        insert_only_columns=["created_at"],
    )

    log.info("Notification failure projected")


async def handle_notification_suppression_changed(
    pool: asyncpg.Pool, parsed_event: Any
) -> None:
    """Project notification.suppression.changed.v1 into the notifications table.

    Uses a synthesized notification_id (``suppression:<event-id>``) so each
    suppression change gets its own timeline row.
    """
    payload = parsed_event.payload
    customer_id = payload.customer_id
    raw_mode = (payload.mode or "").lower()
    set_at = _coerce_dt(payload.set_at)
    event_id = getattr(parsed_event, "cause", "") or getattr(parsed_event, "conv", "")
    timeline_id = (
        f"suppression:{event_id}"
        if event_id
        else f"suppression:{customer_id}:{set_at.isoformat() if set_at else 'now'}"
    )

    log = logger.bind(timeline_id=timeline_id, customer_id=customer_id, mode=raw_mode)
    log.info("Processing notification.suppression.changed.v1")

    customer_ref_id = await _resolve_customer_link(pool, customer_id)
    now = datetime.now(timezone.utc)
    # event_at is NOT NULL on the table; the suppression set_at is the
    # natural timeline anchor but some publishers omit it — fall back to
    # the projection wall-clock when missing.
    event_at = set_at or now
    # The pg enum constraint rejects unknown modes; map to NULL with a
    # warning rather than crashing the consumer. Status row still lands.
    mode_value = raw_mode if raw_mode in _SUPPRESSION_MODES else None
    if mode_value is None:
        log.warning("Unknown suppression mode, storing NULL", raw_mode=raw_mode)

    await upsert(
        pool,
        "notifications",
        conflict_columns=["notification_id"],
        values={
            "notification_id": timeline_id,
            "status": "suppression_change",
            "customer_id": customer_id,
            "customer_ref_id": customer_ref_id,
            "correlation_id": payload.correlation_id,
            "event_at": event_at,
            "suppression_mode": mode_value,
            "suppression_reason": payload.reason or None,
            "suppression_set_by": payload.set_by or None,
            "suppression_set_at": set_at,
            "suppression_expires_at": _coerce_dt(payload.expires_at),
            "updated_at": now,
            "created_at": now,
        },
        insert_only_columns=["created_at"],
    )

    log.info("Suppression change projected")


async def handle_statement_generated(pool: asyncpg.Pool, parsed_event: Any) -> None:
    """Project statement.generated.v1 into the notifications table."""
    payload = parsed_event.payload
    notification_id = payload.notification_id
    customer_id = payload.customer_id
    account_id = payload.account_id

    log = logger.bind(
        notification_id=notification_id,
        customer_id=customer_id,
        account_id=account_id,
    )
    log.info("Processing statement.generated.v1")

    customer_ref_id = await _resolve_customer_link(pool, customer_id)
    now = datetime.now(timezone.utc)

    await upsert(
        pool,
        "notifications",
        conflict_columns=["notification_id"],
        values={
            "notification_id": notification_id,
            "status": "statement",
            "customer_id": customer_id,
            "customer_ref_id": customer_ref_id,
            "correlation_id": payload.correlation_id,
            "event_at": _coerce_dt(payload.dispatched_at),
            "statement_account_id": account_id,
            "statement_period_start": _coerce_dt(payload.period_start),
            "statement_period_end": _coerce_dt(payload.period_end),
            "statement_dispatched_at": _coerce_dt(payload.dispatched_at),
            "updated_at": now,
            "created_at": now,
        },
        insert_only_columns=["created_at"],
    )

    log.info("Statement marker projected")
