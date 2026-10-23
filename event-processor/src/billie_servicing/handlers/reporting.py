"""Reporting facts written by the event processor (BTB-504).

Most of the ``reporting`` schema is views over the CRM projection (see
``src/server/reporting/schema.ts``). The exception is
``reporting.decision_event``: one row per ``final_credit_decision``, because
the conversation row keeps only the latest decision and has no decision time.
It is append-only and keyed so a redelivery or a back-fill of the same event
writes nothing.

Only ids, codes, flags and timestamps are stored. Never names, contact
details or free text.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from ..db import ExecuteTarget, coerce_date
from .sanitize import safe_str

_INSERT_DECISION_EVENT = """
INSERT INTO reporting.decision_event
  (decision_key, event_id, conversation_id, application_number, decision, reason,
   retry_eligible, ruleset_version, build_sha, mock_origin,
   assessment_record_location, decided_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
ON CONFLICT (decision_key) DO NOTHING
"""


def _text(value: object) -> str | None:
    """A non-empty string, or None."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def conversation_of(event: dict[str, Any]) -> str:
    """The conversation id an envelope belongs to (``cid``, ``conv`` or ``conversation_id``)."""
    return safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )


def decision_of(event: dict[str, Any], payload: dict[str, Any]) -> str:
    """The upper-cased outcome of a final_credit_decision, or ``""``."""
    return str(
        event.get("decision")
        or event.get("outcome")
        or payload.get("decision")
        or payload.get("outcome")
        or ""
    ).upper()


def decision_time(payload: dict[str, Any], fallback: datetime | None = None) -> datetime:
    """When the decision was made.

    The producer stamps ``decided_at`` (UTC ISO 8601) since BTB-505. Older
    events fall back to ``fallback`` (the archived stream time in the
    back-fill), then to now. A naive timestamp is read as UTC.
    """
    stamped = coerce_date(payload.get("decided_at"))
    if isinstance(stamped, datetime):
        return stamped if stamped.tzinfo else stamped.replace(tzinfo=UTC)
    return fallback or datetime.now(UTC)


def decision_key(event: dict[str, Any], conversation_id: str, decision: str) -> str:
    """Natural key of one decision event.

    The producer stamps ``event_id`` once and preserves it across the fan-out
    to inboxes, so the live copy and the archived chatLedger copy share it.
    Events published before ids were stamped fall back to conversation,
    sequence and outcome.
    """
    event_id = _text(event.get("event_id"))
    if event_id:
        return event_id
    return f"{conversation_id}:{event.get('seq', '')}:{decision}"


async def record_decision_event(
    target: ExecuteTarget,
    event: dict[str, Any],
    payload: dict[str, Any],
    *,
    conversation_id: str,
    decision: str,
    decided_at: datetime | None = None,
) -> bool:
    """Append one ``final_credit_decision`` to ``reporting.decision_event``.

    Args:
        target: asyncpg pool or connection.
        event: The sanitized envelope (``event_id``, ``seq``).
        payload: The parsed decision payload.
        conversation_id: The conversation the decision belongs to.
        decision: The outcome, upper-cased (``APPROVED``, ``DECLINED`` ...).
        decided_at: Fallback decision time for events without a stamped
            ``decided_at`` (see :func:`decision_time`). The back-fill passes
            the archived stream timestamp; live events default to now.

    Returns:
        True if a row was written, False if the event was already recorded or
        carried no outcome.
    """
    if not decision:
        return False
    status = await target.execute(
        _INSERT_DECISION_EVENT,
        decision_key(event, conversation_id, decision),
        _text(event.get("event_id")),
        conversation_id,
        _text(payload.get("application_number")),
        decision,
        _text(payload.get("reason")),
        payload["retry_eligible"] if isinstance(payload.get("retry_eligible"), bool) else None,
        _text(payload.get("ruleset_version")),
        _text(payload.get("build_sha")),
        payload.get("mock_origin") is True,
        _text(payload.get("assessment_record_location")),
        decision_time(payload, decided_at),
    )
    return str(status).endswith(" 1")
