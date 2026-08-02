"""Projection handlers for applicant_release.* events (spec 2026-08-02 §5).

These are CRM-local events: the processor's parser falls through to the dict
envelope (like writeoff.*), so each handler decodes the payload itself.

Handles events:
- applicant_release.released.v1
- applicant_release.revoked.v1
- applicant_release.grant_claimed.v1
- applicant_release.invites_sent.v1
- applicant_release.gate_mode.changed.v1

``applicant_release.gate_mode.set.v1`` is deliberately NOT handled here — it's
billieChat's command, not a fact the CRM projects.

Note: ``grant_claimed``'s ``conversation_id`` is a gate pseudo-id
(``gate:{session_id}``), not a chat conversation FK — it is intentionally
never persisted by these handlers.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import asyncpg

from ..db import update_by_key, upsert


def _now() -> datetime:
    return datetime.now(UTC)


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
    return payload if isinstance(payload, dict) else {}


def _coerce_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


async def _recompute_claimed_count(pool: asyncpg.Pool, release_id: str) -> None:
    """Recompute from grant rows so replays can never drift the counter."""
    await pool.execute(
        "UPDATE release_batches SET claimed_count = ("
        "SELECT count(*) FROM release_grants "
        "WHERE release_id = $1 AND status = 'claimed') WHERE release_id = $1",
        release_id,
    )


async def handle_applicant_release_released(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """applicant_release.released.v1 — create the batch row + targeted grant rows."""
    p = _parse_payload(event)
    grants = p.get("grants") or []
    skipped = p.get("skipped") or {}
    await upsert(
        pool,
        "release_batches",
        conflict_columns=["release_id"],
        values={
            "release_id": p["release_id"],
            "name": p.get("name"),
            "type": p.get("type"),
            "status": "active",
            "quota_count": p.get("quota_count"),
            "expires_at": _coerce_ts(p.get("expires_at")),
            "send_invite_sms": bool(p.get("send_invite_sms")),
            "granted_count": len(grants),
            "claimed_count": 0,
            "sms_sent_count": 0,
            "sms_failed_count": 0,
            "skipped_already_customer": skipped.get("already_customer", 0),
            "skipped_already_released": skipped.get("already_released", 0),
            "skipped_needs_review": skipped.get("needs_review", 0),
            "skipped_invalid_number": skipped.get("invalid_number", 0),
            "created_by_actor": p.get("released_by"),
            "released_at": _now(),
            "updated_at": _now(),
            "created_at": _now(),
        },
        do_nothing_on_conflict=True,  # create-once; replays leave the row untouched
    )
    for grant in grants:
        await upsert(
            pool,
            "release_grants",
            conflict_columns=["release_id", "mobile_e164"],
            values={
                "release_id": p["release_id"],
                "mobile_e164": grant["mobile_e164"],
                "contact_id": grant.get("contact_id"),
                "source": "targeted",
                "status": "granted",
                "sms_status": "not_sent",
                "updated_at": _now(),
                "created_at": _now(),
            },
            do_nothing_on_conflict=True,
        )


async def handle_applicant_release_revoked(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """applicant_release.revoked.v1 — flip the batch and its open grants."""
    p = _parse_payload(event)
    await update_by_key(
        pool,
        "release_batches",
        key_column="release_id",
        key_value=p["release_id"],
        values={
            "status": "revoked",
            "revoked_by": p.get("revoked_by"),
            "revoked_at": _now(),
            "updated_at": _now(),
        },
    )
    await pool.execute(
        "UPDATE release_grants SET status = 'revoked', updated_at = $2 "
        "WHERE release_id = $1 AND status IN ('granted', 'claimed')",
        p["release_id"],
        _now(),
    )


async def handle_applicant_release_grant_claimed(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """applicant_release.grant_claimed.v1 — upsert the grant row (mints quota rows)."""
    p = _parse_payload(event)
    source = "quota_claim" if p.get("source") == "quota" else "targeted"
    await upsert(
        pool,
        "release_grants",
        conflict_columns=["release_id", "mobile_e164"],
        values={
            "release_id": p["release_id"],
            "mobile_e164": p["mobile_e164"],
            "source": source,
            "status": "claimed",
            "sms_status": "not_sent",
            "claimed_at": _coerce_ts(p.get("claimed_at")),
            "updated_at": _now(),
            "created_at": _now(),
        },
        insert_only_columns=["created_at", "sms_status", "contact_id"],
    )
    await _recompute_claimed_count(pool, p["release_id"])


async def handle_applicant_release_invites_sent(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """applicant_release.invites_sent.v1 — record SMS outcomes reported by billieChat."""
    p = _parse_payload(event)
    release_id = p["release_id"]
    for mobile in p.get("sent") or []:
        await pool.execute(
            "UPDATE release_grants SET sms_status = 'sent', updated_at = $3 "
            "WHERE release_id = $1 AND mobile_e164 = $2",
            release_id,
            mobile,
            _now(),
        )
    for failure in p.get("failed") or []:
        await pool.execute(
            "UPDATE release_grants SET sms_status = 'failed', updated_at = $3 "
            "WHERE release_id = $1 AND mobile_e164 = $2",
            release_id,
            failure.get("mobile_e164"),
            _now(),
        )
    await update_by_key(
        pool,
        "release_batches",
        key_column="release_id",
        key_value=release_id,
        values={
            "sms_sent_count": len(p.get("sent") or []),
            "sms_failed_count": len(p.get("failed") or []),
            "updated_at": _now(),
        },
    )


async def handle_applicant_release_gate_mode_changed(
    pool: asyncpg.Pool, event: dict[str, Any]
) -> None:
    """applicant_release.gate_mode.changed.v1 — single-row gate status."""
    p = _parse_payload(event)
    await upsert(
        pool,
        "release_gate_status",
        conflict_columns=["gate_id"],
        values={
            "gate_id": "gate",
            "mode": p.get("mode"),
            "set_by": p.get("set_by"),
            "changed_at": _coerce_ts(p.get("changed_at")) or _now(),
            "updated_at": _now(),
            "created_at": _now(),
        },
        insert_only_columns=["created_at"],
    )
