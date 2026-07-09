"""Handlers for fraud_risk.* events emitted by the billieChat FraudRiskAgent."""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog

from ..db import coerce_date, upsert
from .conversation import _ASSESSMENT_COLUMNS, _set_assessment
from .identity import resolve_canonical_customer_id
from .sanitize import parse_payload, safe_str, strip_dollar_keys

logger = structlog.get_logger()

_MEDIUM_PLUS = {"MEDIUM", "HIGH", "CRITICAL"}


async def handle_fraud_risk_assessment(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Persist a MEDIUM+ fraud assessment onto the conversation's fraudCheck slot.

    LOW (benign) assessments are skipped. The latest MEDIUM+ assessment wins,
    matching how the other assessment columns overwrite.
    """
    payload = parse_payload(event)
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or payload.get("conversation_id"),
        "conversation_id",
    )
    severity = str(payload.get("severity", "")).upper()
    log = logger.bind(conversation_id=conversation_id, severity=severity)

    if severity not in _MEDIUM_PLUS:
        log.info("fraud_risk.assessment.v1 below MEDIUM — skipping")
        return
    if not conversation_id:
        log.warning("fraud_risk.assessment.v1 without conversation id — skipping")
        return

    data = strip_dollar_keys(payload)
    await _set_assessment(pool, conversation_id, _ASSESSMENT_COLUMNS["fraudCheck"], data)
    log.info("fraud check assessment persisted")


async def handle_fraud_risk_halt(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Raise the customer-level fraud alert from a HIGH/CRITICAL fraud_risk.halt.v1.

    Mirrors the reapplication-block customer mirror: resolve the canonical customer
    id and upsert the fraud_risk_* fields that drive the AttentionStrip chip.
    """
    payload = parse_payload(event)
    severity = str(payload.get("severity", "")).upper()
    categories = payload.get("categories") or []
    score = payload.get("final_score")

    customer_id = safe_str(event.get("usr") or payload.get("customer_id"), "customer_id")
    canonical_id = await resolve_canonical_customer_id(pool, customer_id or None)
    log = logger.bind(customer_id=customer_id, severity=severity)
    if not canonical_id:
        log.warning("fraud_risk.halt.v1 without resolvable customer id — no mirror")
        return

    now = datetime.now(UTC)
    await upsert(
        pool,
        "customers",
        conflict_columns=["customer_id"],
        values={
            "customer_id": canonical_id,
            "fraud_risk_severity": severity or None,
            "fraud_risk_score": int(score) if isinstance(score, int | float) else None,
            "fraud_risk_categories": json.dumps(categories),
            "fraud_risk_flagged_at": coerce_date(payload.get("flagged_at")) or now,
            "fraud_risk_active": True,
            "updated_at": now,
            "created_at": now,
        },
        insert_only_columns=["created_at"],
    )
    log.info("customer fraud-risk alert raised")
