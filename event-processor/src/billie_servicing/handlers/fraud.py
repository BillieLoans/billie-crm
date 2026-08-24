"""Handlers for fraud_risk.* events emitted by the billieChat FraudRiskAgent."""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog

from ..db import coerce_date, upsert
from .conversation import _ASSESSMENT_COLUMNS
from .identity import resolve_canonical_customer_id
from .sanitize import parse_payload, safe_str, strip_dollar_keys

logger = structlog.get_logger()

_MEDIUM_PLUS = {"MEDIUM", "HIGH", "CRITICAL"}

# Severity ordering used for the peak fold — a later LOW must never downgrade
# the stored peak. Unknown severities rank below LOW so they never win.
_SEVERITY_RANK = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}

_FRAUD_COLUMN = _ASSESSMENT_COLUMNS["fraudCheck"]

# Normalise the stored jsonb to the rolling-summary shape. Legacy prod rows are
# a flat FraudRiskDecision (no `peak_severity` key) — fold them as a summary of
# one flagged turn (the old handler only ever wrote MEDIUM+).
_PREV = (
    "CASE "
    f"WHEN {_FRAUD_COLUMN} IS NULL THEN NULL::jsonb "
    f"WHEN {_FRAUD_COLUMN} ? 'peak_severity' THEN {_FRAUD_COLUMN} "
    "ELSE jsonb_build_object("
    f"'latest', {_FRAUD_COLUMN}, "
    f"'peak_severity', {_FRAUD_COLUMN}->>'severity', "
    f"'peak_score', COALESCE(({_FRAUD_COLUMN}->>'final_score')::int, 0), "
    "'turns_assessed', 1, "
    "'flagged_count', 1) "
    "END"
)

_PREV_RANK = (
    f"CASE ({_PREV})->>'peak_severity' "
    "WHEN 'CRITICAL' THEN 3 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 1 "
    "WHEN 'LOW' THEN 0 ELSE -1 END"
)

# One atomic statement: the whole read-fold-write happens inside the SET
# expression (Postgres re-evaluates it against the latest row version under
# concurrent updates, like `counter = counter + 1`), so the 18 prod consumers
# can't lose increments or downgrade the peak the way a Python
# SELECT-then-UPDATE would. Update-only: a missing conversation row updates
# nothing, matching the other assessment handlers.
#   $1 latest payload json · $2 severity · $3 severity rank · $4 score
#   $5 flagged increment (0/1) · $6 assessed-at ISO-8601 · $7 conversation_id
_FOLD_SQL = f"""
UPDATE conversations SET {_FRAUD_COLUMN} = jsonb_build_object(
    'latest', $1::jsonb,
    'peak_severity', CASE WHEN $3::int >= ({_PREV_RANK}) THEN $2::text
                          ELSE ({_PREV})->>'peak_severity' END,
    'peak_score', GREATEST($4::int, COALESCE((({_PREV})->>'peak_score')::int, 0)),
    'turns_assessed', COALESCE((({_PREV})->>'turns_assessed')::int, 0) + 1,
    'flagged_count', COALESCE((({_PREV})->>'flagged_count')::int, 0) + $5::int,
    'first_assessed_at', COALESCE(({_PREV})->>'first_assessed_at', $6::text),
    'last_assessed_at', $6::text
  ),
  updated_at = NOW(),
  version = COALESCE(version, 1) + 1
WHERE conversation_id = $7
"""


async def handle_fraud_risk_assessment(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Fold every fraud_risk.assessment.v1 into the conversation's rolling summary.

    Every scored turn is persisted — LOW included — so the CRM panel can tell
    "the agent ran and found nothing" apart from "no assessment has arrived".
    The stored shape in ``assessments_fraud_check`` is::

        {latest, peak_severity, peak_score, turns_assessed, flagged_count,
         first_assessed_at, last_assessed_at}

    The fold runs as a single atomic UPDATE (see ``_FOLD_SQL``); a later LOW
    never downgrades ``peak_severity``/``peak_score``.
    """
    payload = parse_payload(event)
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or payload.get("conversation_id"),
        "conversation_id",
    )
    severity = str(payload.get("severity", "")).upper()
    log = logger.bind(conversation_id=conversation_id, severity=severity)

    if not conversation_id:
        log.warning("fraud_risk.assessment.v1 without conversation id — skipping")
        return

    score = payload.get("final_score")
    status = await pool.execute(
        _FOLD_SQL,
        json.dumps(strip_dollar_keys(payload)),
        severity,
        _SEVERITY_RANK.get(severity, -1),
        int(score) if isinstance(score, int | float) else 0,
        1 if severity in _MEDIUM_PLUS else 0,
        datetime.now(UTC).isoformat(),
        conversation_id,
    )
    if status == "UPDATE 0":
        log.warning("fraud_risk.assessment.v1 for unknown conversation — no row updated")
    else:
        log.info("fraud check assessment folded into summary")


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
