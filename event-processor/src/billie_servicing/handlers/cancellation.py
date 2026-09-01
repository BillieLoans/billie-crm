"""Projection for customer_cancelled / offer_cancelled, and the terminal ladder.

billieChat emits two cancellation events. ``customer_cancelled`` (sender
``chatbot``) fires when the customer confirms an in-card decline at any stage;
``offer_cancelled`` (sender ``contract``) fires when the offer expiry poller or
the browser-close beacon retires an un-accepted offer. Neither reached the CRM
before 2026-08-28 — the (chatbot, customer_cancelled) pair had no route at all,
and neither routed rule targeted billie-crm.

The credit decision is deliberately left alone: a customer walking away must not
restate Billie's approval as a decline, so ``decision_status`` and
``final_decision`` are untouched and only the lifecycle ``status`` moves.

``terminal_rank`` is the single ordering every terminal write consults — see
handlers/conversation.py, which uses it for the kill and final-decision paths.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog

from .sanitize import parse_payload, safe_str

logger = structlog.get_logger(__name__)

CUSTOMER_DECLINED = "customer_declined"

# Terminal-state ladder. A weaker terminal state must never overwrite a stronger
# one: a stale session_timeout landing an hour after a fraud kill would otherwise
# flip the row to `expired` and mask a live fraud control.
TERMINAL_RANK: dict[str, int] = {"expired": 1, "cancelled": 2, "hard_end": 3}


def terminal_rank(status: str | None) -> int:
    """Rank of a conversation status on the terminal ladder (0 = not terminal)."""
    return TERMINAL_RANK.get(status or "", 0)


# reason -> (category, conversations.status)
REASON_MAP: dict[str, tuple[str, str]] = {
    "attestation_declined": (CUSTOMER_DECLINED, "cancelled"),
    "preliminary_approval_cancelled": (CUSTOMER_DECLINED, "cancelled"),
    "statement_consent_declined": (CUSTOMER_DECLINED, "cancelled"),
    "final_offer_declined": (CUSTOMER_DECLINED, "cancelled"),
    "browser_close": ("abandoned", "expired"),
    "session_timeout": ("system_expired", "expired"),
    "cutover_exhausted": ("system_expired", "expired"),
}

# Fallback when billieChat introduces a reason we don't know yet: trust the
# event type rather than dropping the cancellation.
_SOURCE_DEFAULT: dict[str, tuple[str, str]] = {
    "customer_cancelled": (CUSTOMER_DECLINED, "cancelled"),
    "offer_cancelled": ("system_expired", "expired"),
}


async def _project(pool: asyncpg.Pool, event: dict[str, Any], source_event: str) -> None:
    payload = parse_payload(event)
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or payload.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id, source_event=source_event)
    if not conversation_id:
        log.warning("cancellation event without conversation id — skipping")
        return

    reason = payload.get("cancellation_reason") or payload.get("reason") or ""
    category, status = REASON_MAP.get(reason, _SOURCE_DEFAULT[source_event])

    row = await pool.fetchrow(
        "SELECT status, cancellation_record FROM conversations WHERE conversation_id = $1",
        conversation_id,
    )
    if row is None:
        log.warning("cancellation for unknown conversation — skipping")
        return

    incoming = terminal_rank(status)
    current = terminal_rank(row["status"])
    # Strictly stronger always wins. Equal strength wins only if nothing is
    # recorded yet, so the FIRST reason at a given strength is the one kept.
    if incoming < current or (incoming == current and row["cancellation_record"]):
        log.info(
            "terminal state already at least as strong — skipping",
            current_status=row["status"],
            incoming_status=status,
        )
        return

    application_number = safe_str(
        payload.get("application_number") or event.get("application_number"),
        "application_number",
    )
    record = {
        "reason": reason,
        "category": category,
        "cancelled_at": payload.get("cancelled_at") or datetime.now(UTC).isoformat(),
        "source_event": source_event,
        "application_number": application_number or None,
    }

    await pool.execute(
        "UPDATE conversations SET status = $1, cancellation_record = $2::jsonb, "
        "updated_at = NOW(), version = COALESCE(version, 1) + 1 "
        "WHERE conversation_id = $3",
        status,
        json.dumps(record),
        conversation_id,
    )

    if application_number:
        await pool.execute(
            "UPDATE applications SET application_outcome = $1, updated_at = NOW() "
            "WHERE application_number = $2",
            "withdrawn",
            application_number,
        )

    log.info("cancellation projected", status=status, category=category, reason=reason)


async def handle_customer_cancelled(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Project customer_cancelled — a customer-confirmed decline at any stage."""
    await _project(pool, event, "customer_cancelled")


async def handle_offer_cancelled(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Project offer_cancelled — offer expiry or browser-close abandonment."""
    await _project(pool, event, "offer_cancelled")
