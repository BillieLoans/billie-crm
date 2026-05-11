"""Notification event handlers (read-only audit projections).

Handles events from the platform notification dispatcher:
- notification.sent.v1
- notification.delivery_failed.v1
- statement.generated.v1

All three projections land in a single MongoDB collection ``notifications``,
keyed by ``notificationId``, with ``status`` as the discriminator:
- ``sent``      — successful delivery
- ``failed``    — provider/recipient error
- ``blocked``   — delivery_failed with error_type == "suppressed"
                  (kill-switch active for the customer)
- ``statement`` — statement.generated audit marker

The unified Mongo shape lets the CRM render a single chronological timeline
in the customer view's Communications panel.
"""

from datetime import datetime
from typing import Any

import structlog
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = structlog.get_logger()


async def _resolve_customer_link(
    db: AsyncIOMotorDatabase, customer_id: str | None
) -> Any | None:
    """Look up the Mongo customer ``_id`` so Payload's relationship field hydrates.

    Returns None silently if the customer isn't in the projection yet — the
    ``customerId`` string is still stored for later joining via queries.
    """
    if not customer_id:
        return None
    customer = await db.customers.find_one({"customerId": customer_id}, {"_id": 1})
    return customer.get("_id") if customer else None


def _coerce_iso(value: Any) -> str | None:
    """Coerce a Pydantic-parsed date/datetime field to an ISO 8601 string."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


async def handle_notification_sent(
    db: AsyncIOMotorDatabase, parsed_event: Any
) -> None:
    """Project ``notification.sent.v1`` into the notifications collection.

    Idempotent on ``notificationId`` — replays from at-least-once delivery or
    DLQ recovery resolve to the same document.
    """
    payload = parsed_event.payload
    notification_id = payload.notification_id
    customer_id = payload.customer_id

    log = logger.bind(
        notification_id=notification_id,
        customer_id=customer_id,
        template=payload.template_name,
    )
    log.info("Processing notification.sent.v1")

    customer_mongo_id = await _resolve_customer_link(db, customer_id)
    now = datetime.utcnow()

    document = {
        "notificationId": notification_id,
        "idempotencyKey": payload.idempotency_key,
        "requestId": payload.request_id,
        "status": "sent",
        "channel": payload.channel,
        "templateName": payload.template_name,
        "templateContentHash": payload.template_content_hash or None,
        "templateGitSha": payload.template_git_sha,
        "provider": payload.provider,
        "providerMessageId": payload.provider_message_id,
        "recipientHash": payload.recipient_hash,
        "customerId": customer_id,
        "customerRef": customer_mongo_id,
        "correlationId": payload.correlation_id,
        "eventAt": _coerce_iso(payload.sent_at),
        "sentAt": _coerce_iso(payload.sent_at),
        "tags": {
            "category": (payload.tags or {}).get("category"),
            "reason": (payload.tags or {}).get("reason"),
            "step": (payload.tags or {}).get("step"),
        },
        "updatedAt": now,
    }

    result = await db["notifications"].update_one(
        {"notificationId": notification_id},
        {"$set": document, "$setOnInsert": {"createdAt": now}},
        upsert=True,
    )

    log.info(
        "Notification sent projected",
        matched=result.matched_count,
        modified=result.modified_count,
        upserted_id=str(result.upserted_id) if result.upserted_id else None,
    )


async def handle_notification_delivery_failed(
    db: AsyncIOMotorDatabase, parsed_event: Any
) -> None:
    """Project ``notification.delivery_failed.v1`` into the notifications collection.

    ``error_type == "suppressed"`` is mapped to ``status="blocked"`` so the
    UI can show "Notification blocked — suppression active" with distinct
    styling from generic failures (recipient invalid, template error, etc.).
    """
    payload = parsed_event.payload
    notification_id = payload.notification_id
    customer_id = payload.customer_id
    error_type = payload.error_type

    # Kill-switch blocks render as a distinct timeline category.
    status = "blocked" if error_type == "suppressed" else "failed"

    log = logger.bind(
        notification_id=notification_id,
        customer_id=customer_id,
        template=payload.template_name,
        error_type=error_type,
        mapped_status=status,
    )
    log.info("Processing notification.delivery_failed.v1")

    customer_mongo_id = await _resolve_customer_link(db, customer_id)
    now = datetime.utcnow()

    document = {
        "notificationId": notification_id,
        "idempotencyKey": payload.idempotency_key,
        "requestId": payload.request_id,
        "status": status,
        "channel": payload.channel,
        "templateName": payload.template_name,
        "templateContentHash": payload.template_content_hash or None,
        "templateGitSha": payload.template_git_sha,
        "provider": payload.provider,
        "recipientHash": payload.recipient_hash,
        "customerId": customer_id,
        "customerRef": customer_mongo_id,
        "correlationId": payload.correlation_id,
        "eventAt": _coerce_iso(payload.failed_at),
        "tags": {
            "category": (payload.tags or {}).get("category"),
            "reason": (payload.tags or {}).get("reason"),
            "step": (payload.tags or {}).get("step"),
        },
        "failure": {
            "failedAt": _coerce_iso(payload.failed_at),
            "errorType": error_type,
            "errorMessage": payload.error_message,
            "attempt": payload.attempt,
            "fallbackSuggested": payload.fallback_suggested,
        },
        "updatedAt": now,
    }

    result = await db["notifications"].update_one(
        {"notificationId": notification_id},
        {"$set": document, "$setOnInsert": {"createdAt": now}},
        upsert=True,
    )

    log.info(
        "Notification failure projected",
        matched=result.matched_count,
        modified=result.modified_count,
        upserted_id=str(result.upserted_id) if result.upserted_id else None,
    )


async def handle_notification_suppression_changed(
    db: AsyncIOMotorDatabase, parsed_event: Any
) -> None:
    """Project ``notification.suppression.changed.v1`` into the notifications
    collection so suppression flips are visible in the customer's Communications
    timeline alongside sent / failed / blocked entries.

    Idempotency: keyed on the inbox envelope id (``parsed_event.cause``), so
    DLQ replays converge on the same document.
    """
    payload = parsed_event.payload
    customer_id = payload.customer_id
    mode = (payload.mode or "").lower()
    set_at = _coerce_iso(payload.set_at)
    event_id = getattr(parsed_event, "cause", "") or getattr(parsed_event, "conv", "")
    # Fallback to a deterministic composite when the envelope id is missing.
    timeline_id = (
        f"suppression:{event_id}"
        if event_id
        else f"suppression:{customer_id}:{set_at or 'now'}"
    )

    log = logger.bind(
        timeline_id=timeline_id,
        customer_id=customer_id,
        mode=mode,
    )
    log.info("Processing notification.suppression.changed.v1")

    customer_mongo_id = await _resolve_customer_link(db, customer_id)
    now = datetime.utcnow()

    document = {
        "notificationId": timeline_id,
        "status": "suppression_change",
        "customerId": customer_id,
        "customerRef": customer_mongo_id,
        "correlationId": payload.correlation_id,
        # Use set_at as the timeline anchor so the entry appears at the time
        # the change was applied (not the time the projection ran).
        "eventAt": set_at,
        "suppression": {
            "mode": mode,
            "reason": payload.reason or None,
            "setBy": payload.set_by or None,
            "setAt": set_at,
            "expiresAt": _coerce_iso(payload.expires_at),
        },
        "updatedAt": now,
    }

    result = await db["notifications"].update_one(
        {"notificationId": timeline_id},
        {"$set": document, "$setOnInsert": {"createdAt": now}},
        upsert=True,
    )

    log.info(
        "Suppression change projected",
        matched=result.matched_count,
        modified=result.modified_count,
        upserted_id=str(result.upserted_id) if result.upserted_id else None,
    )


async def handle_statement_generated(
    db: AsyncIOMotorDatabase, parsed_event: Any
) -> None:
    """Project ``statement.generated.v1`` into the notifications collection.

    Statement notifications use ``status="statement"`` and store the account
    + period in a dedicated ``statement`` sub-document. They link to the
    matching ``notification.sent.v1`` via the shared ``notification_id``.
    """
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

    customer_mongo_id = await _resolve_customer_link(db, customer_id)
    now = datetime.utcnow()

    document = {
        "notificationId": notification_id,
        "status": "statement",
        "customerId": customer_id,
        "customerRef": customer_mongo_id,
        "correlationId": payload.correlation_id,
        "eventAt": _coerce_iso(payload.dispatched_at),
        "statement": {
            "accountId": account_id,
            "periodStart": _coerce_iso(payload.period_start),
            "periodEnd": _coerce_iso(payload.period_end),
            "dispatchedAt": _coerce_iso(payload.dispatched_at),
        },
        "updatedAt": now,
    }

    result = await db["notifications"].update_one(
        {"notificationId": notification_id},
        {"$set": document, "$setOnInsert": {"createdAt": now}},
        upsert=True,
    )

    log.info(
        "Statement marker projected",
        matched=result.matched_count,
        modified=result.modified_count,
        upserted_id=str(result.upserted_id) if result.upserted_id else None,
    )
