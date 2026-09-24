"""Identity resolution events for the in-flight application view (BTB-392).

billieChat routes two PII-free events to the CRM that describe how the
platform's identity decision for a journey came about:

* ``identity.resolver.assessed.v1`` — one per resolver-agent run (SP3 D4:
  ``IDENTITY_RESOLVER_MODE`` shadow / enforce): verdict, confidence, factors,
  mode, whether it was applied, the platform reason code, latency and model.
* ``identity.review.opened.v1`` — a recognition review case (band, posterior,
  flags, candidate ids, per-signal bits, recommendation, disposition); since
  SP3 D3 an audit record rather than a halt.

Both land in ``conversations.identity_resolution`` (jsonb) beside the
``link`` / ``merge`` outcome the identity handler writes:

* ``resolver_assessments`` is an object keyed by the ledger event id, so a
  redelivery replaces its own entry (``merge_jsonb_entry`` semantics) and the
  UI orders by ``assessed_at``;
* ``review_case`` is the latest case (one per journey by construction).

Only the allow-listed keys below are stored — the PII fence. The envelope's
``conv`` names the conversation; an event without one is logged and skipped
(never DLQ'd). The conversation row is upserted first so an event that beats
``conversation_started`` still lands (the identity-verification precedent).
"""

from __future__ import annotations

from typing import Any

import asyncpg
import structlog

from ..db import merge_jsonb, merge_jsonb_entry, upsert_conversation
from .sanitize import parse_payload, safe_str

logger = structlog.get_logger()

COLUMN = "identity_resolution"

RESOLVER_FIELDS = (
    "journey_id",
    "candidate_id",
    "verdict",
    "confidence",
    "factors",
    "mode",
    "applied",
    "platform_reason_code",
    "latency_ms",
    "model",
)

REVIEW_FIELDS = (
    "case_id",
    "journey_id",
    "band",
    "posterior",
    "flags",
    "candidate_ids",
    "per_signal_bits",
    "recommendation",
    "disposition",
    "related_journeys",
)


def _event_id(event: dict[str, Any]) -> str | None:
    for key in ("id", "cause", "event_id", "message_id"):
        value = event.get(key)
        if value:
            return safe_str(value, key)
    return None


def _timestamp(event: dict[str, Any], payload: dict[str, Any]) -> str | None:
    candidates = (
        (payload, "assessed_at"),
        (payload, "opened_at"),
        (event, "ts"),
        (event, "timestamp"),
    )
    for source, key in candidates:
        value = source.get(key)
        if value:
            return safe_str(value, key)
    return None


def _project(payload: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    """Copy exactly the allow-listed keys (the PII fence)."""
    return {k: payload[k] for k in fields if k in payload}


async def _ensure_conversation(pool: asyncpg.Pool, conversation_id: str) -> None:
    await upsert_conversation(pool, conversation_id=conversation_id, set_values={})


async def handle_identity_resolver_assessed(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Handle ``identity.resolver.assessed.v1``."""
    conversation_id = safe_str(event.get("conv"), "conv")
    payload = parse_payload(event)
    event_id = _event_id(event)
    log = logger.bind(conversation_id=conversation_id, event_id=event_id)
    if not conversation_id or not event_id:
        log.warning("identity.resolver.assessed.v1 without conversation or event id — skipped")
        return

    entry = _project(payload, RESOLVER_FIELDS)
    entry["event_id"] = event_id
    entry["assessed_at"] = _timestamp(event, payload)

    await _ensure_conversation(pool, conversation_id)
    await merge_jsonb_entry(
        pool,
        "conversations",
        column=COLUMN,
        key_column="conversation_id",
        key_value=conversation_id,
        entry_key="resolver_assessments",
        patch={event_id: entry},
    )
    log.info("Resolver assessment projected", verdict=entry.get("verdict"), mode=entry.get("mode"))


async def handle_identity_review_opened(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Handle ``identity.review.opened.v1``."""
    conversation_id = safe_str(event.get("conv"), "conv")
    payload = parse_payload(event)
    log = logger.bind(conversation_id=conversation_id)
    if not conversation_id:
        log.warning("identity.review.opened.v1 without conversation — skipped")
        return

    case = _project(payload, REVIEW_FIELDS)
    case["opened_at"] = _timestamp(event, payload)
    case["event_id"] = _event_id(event)

    await _ensure_conversation(pool, conversation_id)
    await merge_jsonb(
        pool,
        "conversations",
        column=COLUMN,
        key_column="conversation_id",
        key_value=conversation_id,
        patch={"review_case": case},
    )
    log.info(
        "Recognition review case projected", case_id=case.get("case_id"), band=case.get("band")
    )
