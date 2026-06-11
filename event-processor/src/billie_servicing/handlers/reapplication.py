"""Re-application block handler (BTB-135).

Consumes ``application.reapplication_blocked.v1`` — emitted by
customerLiaisonAgent the moment the BTB-85 re-application block halts an
application, before the customer-facing stop message. Fire-once per
application (delivery is at-least-once; the writes below are idempotent
upserts keyed on natural ids).

Two projections:

* ``conversations.reapplication_block_*`` — the rich "why was this declined"
  shown on the application details view.
* ``customers.reapplication_block_*`` — a compact mirror on the canonical
  customer row so the servicing view can flag "blocked until …" without
  scanning conversations.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog

from ..db import coerce_date, upsert, upsert_conversation
from .identity import resolve_canonical_customer_id
from .sanitize import parse_payload, safe_str

logger = structlog.get_logger()


async def handle_reapplication_blocked(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Handle ``application.reapplication_blocked.v1``."""
    payload = parse_payload(event)
    conversation_id = safe_str(
        payload.get("conversation_id") or event.get("cid") or event.get("conv"),
        "conversation_id",
    )
    application_number = safe_str(payload.get("application_number"), "application_number")
    reason = payload.get("reason")

    log = logger.bind(
        conversation_id=conversation_id,
        application_number=application_number,
        reason=reason,
    )
    log.info("Processing application.reapplication_blocked.v1")

    if conversation_id:
        await upsert_conversation(
            pool,
            conversation_id=conversation_id,
            set_values={
                "reapplication_block_reason": reason,
                "reapplication_block_message_variant": payload.get("message_variant"),
                "reapplication_block_stop_message": payload.get("stop_message"),
                "reapplication_block_source_application_number": payload.get(
                    "source_application_number"
                ),
                "reapplication_block_source_account_id": payload.get("source_account_id"),
                "reapplication_block_source_decided_at": coerce_date(
                    payload.get("source_decided_at")
                ),
                # blocked_until null = permanent (PEP, PRIOR_DEFAULT,
                # IDENTITY_CONFLICT) or ongoing-state (ACTIVE_LOAN).
                "reapplication_block_blocked_until": coerce_date(payload.get("blocked_until")),
                "reapplication_block_blocked_at": coerce_date(payload.get("blocked_at")),
                "reapplication_block_canonical_customer_id": payload.get(
                    "canonical_customer_id"
                ),
            },
            # Identifying columns only seed a fresh row — never overwrite an
            # existing one (identity merges may have re-pointed customer_id_string).
            insert_only_values={
                "application_number": application_number or "",
                "customer_id_string": payload.get("journey_customer_id")
                or event.get("usr")
                or None,
            },
        )
    else:
        log.warning("Re-application block event without conversation id")

    # Customer-level mirror on the canonical row.
    customer_id = safe_str(
        payload.get("canonical_customer_id")
        or payload.get("journey_customer_id")
        or event.get("usr"),
        "customer_id",
    )
    canonical_id = await resolve_canonical_customer_id(pool, customer_id or None)
    if canonical_id:
        now = datetime.now(UTC)
        await upsert(
            pool,
            "customers",
            conflict_columns=["customer_id"],
            values={
                "customer_id": canonical_id,
                "reapplication_block_reason": reason,
                "reapplication_block_blocked_until": coerce_date(payload.get("blocked_until")),
                "reapplication_block_blocked_at": coerce_date(payload.get("blocked_at")),
                "reapplication_block_application_number": application_number or None,
                "updated_at": now,
                "created_at": now,
            },
            insert_only_columns=["created_at"],
        )
    else:
        log.warning("Re-application block event without customer id — no customer mirror")

    log.info("Re-application block recorded")
