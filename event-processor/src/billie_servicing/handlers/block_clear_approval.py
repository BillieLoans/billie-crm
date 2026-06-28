"""Block-clear approval event handlers for CRM-originated events.

Handles events:
- block_clear_approval.requested.v1
- block_clear_approval.approved.v1
- block_clear_approval.rejected.v1
- block_clear_approval.cancelled.v1

These events originate from the CRM (which publishes them onto Redis), and are
routed back through this processor to populate the
``reapplication_block_clear_requests`` projection on Postgres.
"""

from __future__ import annotations

import json
import random
import string
from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog

from ..db import update_by_key, upsert
from .sanitize import safe_str

logger = structlog.get_logger()


def _parse_payload(event: dict[str, Any]) -> dict[str, Any]:
    """Parse the payload from event dict.

    The payload may be a JSON string or already parsed dict.
    """
    payload = event.get("payload", {})
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return {}
    return payload


def _generate_request_number() -> str:
    """Generate a human-readable block-clear request number.

    Format: RBC-YYYYMMDDHHMMSS-XXXX where XXXX is a random alphanumeric suffix.
    """
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"RBC-{timestamp}-{suffix}"


async def handle_block_clear_approval_requested(
    pool: asyncpg.Pool, parsed_event: dict[str, Any]
) -> None:
    """Handle block_clear_approval.requested.v1 — creates the projection row.

    Uses ``ON CONFLICT (request_id) DO NOTHING`` so replays from the Redis
    stream beyond the dedup TTL don't create duplicate rows (the schema's
    unique constraint on request_id guarantees this).
    """
    payload = _parse_payload(parsed_event)

    request_id = safe_str(parsed_event.get("conv", ""), "request_id")
    event_id = safe_str(parsed_event.get("cause", ""), "event_id")

    log = logger.bind(
        request_id=request_id,
        event_id=event_id,
        canonical_customer_id=payload.get("canonicalCustomerId"),
    )
    log.info("Processing block_clear_approval.requested.v1")

    now = datetime.now(UTC)

    # reasons is a list — asyncpg has no list→jsonb codec, so serialise to JSON
    # string here (mirrors the recognition_json pattern in reapplication.py).
    reasons_json = json.dumps(payload.get("reasons") or [])

    await upsert(
        pool,
        "reapplication_block_clear_requests",
        conflict_columns=["request_id"],
        values={
            "request_id": request_id,
            "event_id": event_id,
            "request_number": _generate_request_number(),
            "canonical_customer_id": payload.get("canonicalCustomerId"),
            "conversation_id": payload.get("conversationId"),
            "customer_name": payload.get("customerName", ""),
            "reasons": reasons_json,
            "justification": payload.get("justification"),
            "status": "pending",
            "requested_by_name": payload.get("requestedByName", ""),
            "requested_at": now,
            "created_at": now,
            "updated_at": now,
        },
        do_nothing_on_conflict=True,
    )

    log.info("Block-clear request created (or skipped on replay)")


async def handle_block_clear_approval_approved(
    pool: asyncpg.Pool, parsed_event: dict[str, Any]
) -> None:
    """Handle block_clear_approval.approved.v1 — flips status and stamps approval details."""
    payload = _parse_payload(parsed_event)
    request_id = safe_str(parsed_event.get("conv", ""), "request_id")
    event_id = safe_str(parsed_event.get("cause", ""), "event_id")

    log = logger.bind(request_id=request_id, event_id=event_id)
    log.info("Processing block_clear_approval.approved.v1")

    now = datetime.now(UTC)

    status = await update_by_key(
        pool,
        "reapplication_block_clear_requests",
        key_column="request_id",
        key_value=request_id,
        values={
            "status": "approved",
            "approval_details_approved_by": payload.get("approvedBy"),
            "approval_details_approved_by_name": payload.get("approvedByName", ""),
            "approval_details_comment": payload.get("comment", ""),
            "approval_details_approved_at": now,
            "updated_at": now,
        },
    )

    log.info("Block-clear request approved", asyncpg_status=status)


async def handle_block_clear_approval_rejected(
    pool: asyncpg.Pool, parsed_event: dict[str, Any]
) -> None:
    """Handle block_clear_approval.rejected.v1 — flips status and stamps rejection details."""
    payload = _parse_payload(parsed_event)
    request_id = safe_str(parsed_event.get("conv", ""), "request_id")
    event_id = safe_str(parsed_event.get("cause", ""), "event_id")

    log = logger.bind(request_id=request_id, event_id=event_id)
    log.info("Processing block_clear_approval.rejected.v1")

    now = datetime.now(UTC)

    status = await update_by_key(
        pool,
        "reapplication_block_clear_requests",
        key_column="request_id",
        key_value=request_id,
        values={
            "status": "rejected",
            "approval_details_rejected_by": payload.get("rejectedBy"),
            "approval_details_rejected_by_name": payload.get("rejectedByName", ""),
            "approval_details_reason": payload.get("reason", ""),
            "approval_details_rejected_at": now,
            "updated_at": now,
        },
    )

    log.info("Block-clear request rejected", asyncpg_status=status)


async def handle_block_clear_approval_cancelled(
    pool: asyncpg.Pool, parsed_event: dict[str, Any]
) -> None:
    """Handle block_clear_approval.cancelled.v1 — flips status and stamps cancellation details."""
    payload = _parse_payload(parsed_event)
    request_id = safe_str(parsed_event.get("conv", ""), "request_id")
    event_id = safe_str(parsed_event.get("cause", ""), "event_id")

    log = logger.bind(request_id=request_id, event_id=event_id)
    log.info("Processing block_clear_approval.cancelled.v1")

    now = datetime.now(UTC)

    status = await update_by_key(
        pool,
        "reapplication_block_clear_requests",
        key_column="request_id",
        key_value=request_id,
        values={
            "status": "cancelled",
            "cancellation_details_cancelled_by": payload.get("cancelledBy"),
            "cancellation_details_cancelled_by_name": payload.get("cancelledByName", ""),
            "cancellation_details_cancelled_at": now,
            "updated_at": now,
        },
    )

    log.info("Block-clear request cancelled", asyncpg_status=status)
