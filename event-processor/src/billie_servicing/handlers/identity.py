"""Customer identity link/merge handlers (BTB-120).

Consumes ``customer.identity.linked.v1`` / ``customer.identity.merged.v1`` —
which reach ``inbox:billie-servicing`` via billieChat routing — and
re-attributes a returning customer's records from the alias id (the journey id,
or the dropped canonical) to the surviving canonical id, then tombstones the
orphan ``customers`` row that was created under the alias.

The payloads are small and fixed (see ``billie_customers_events``
``CustomerIdentityLinkedV1`` / ``CustomerIdentityMergedV1``: ``journey_id`` /
``canonical_id`` and ``merged_canonical_id`` / ``canonical_id``) so we read them
straight from the envelope rather than coupling to a specific SDK version.

Idempotent: the re-attribution UPDATEs match the alias id, so a second delivery
finds no alias rows left to move, and the ``merged_into`` tombstone is a fixed
write. Processor-level dedup also guards exact redelivery.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import asyncpg
import structlog

from .sanitize import safe_str

logger = structlog.get_logger()

# Projection tables that carry a (customer_id_string, customer_id_id) pair we
# re-point to the canonical customer.
_REATTRIBUTE_TABLES = ("conversations", "applications", "loan_accounts")


def _extract_payload(event: dict[str, Any]) -> dict[str, Any]:
    """Return the event payload as a dict (it may arrive as a JSON string)."""
    payload = event.get("payload", {})
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (ValueError, TypeError):
            payload = {}
    return payload if isinstance(payload, dict) else {}


async def handle_customer_identity_linked(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Handle ``customer.identity.linked.v1`` (AC-C1/AC-C2)."""
    payload = _extract_payload(event)
    await _merge_identity(
        pool,
        canonical_id=safe_str(payload.get("canonical_id"), "canonical_id"),
        alias_id=safe_str(payload.get("journey_id"), "journey_id"),
        kind="linked",
    )


async def handle_customer_identity_merged(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Handle ``customer.identity.merged.v1`` (AC-C1/AC-C2)."""
    payload = _extract_payload(event)
    await _merge_identity(
        pool,
        canonical_id=safe_str(payload.get("canonical_id"), "canonical_id"),
        alias_id=safe_str(payload.get("merged_canonical_id"), "merged_canonical_id"),
        kind="merged",
    )


async def _merge_identity(
    pool: asyncpg.Pool, canonical_id: str, alias_id: str, kind: str
) -> None:
    """Re-attribute alias records to the canonical and tombstone the alias row."""
    log = logger.bind(canonical_id=canonical_id, alias_id=alias_id, kind=kind)
    if not canonical_id or not alias_id or canonical_id == alias_id:
        log.debug("Identity merge no-op (missing ids or self-link)")
        return

    log.info("Processing customer.identity event — re-attributing to canonical")

    # Resolve the canonical customers row reference (may be None if the canonical
    # customer row hasn't been projected yet — the string column still re-buckets
    # the monitoring grid, and the ref backfills on the next canonical event).
    canonical_ref = await pool.fetchval(
        "SELECT id FROM customers WHERE customer_id = $1", canonical_id
    )
    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn, conn.transaction():
        for table in _REATTRIBUTE_TABLES:
            await conn.execute(
                f"UPDATE {table} "
                f"SET customer_id_string = $1, customer_id_id = $2 "
                f"WHERE customer_id_string = $3",
                canonical_id,
                canonical_ref,
                alias_id,
            )
        # Tombstone/redirect the orphan customers row created under the alias.
        await conn.execute(
            "UPDATE customers SET merged_into = $1, updated_at = $2 "
            "WHERE customer_id = $3",
            canonical_id,
            now,
            alias_id,
        )

    log.info("Re-attributed alias records to canonical and tombstoned alias row")
