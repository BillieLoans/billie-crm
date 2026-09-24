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

BTB-392 (customer data ownership SP4, D5 — links are reversible): every
re-attributed row records the id it arrived under in
``identity_origin_customer_id`` the first time it moves (``COALESCE`` keeps the
first origin across a second hop), the tombstoned customers row records the
platform's ``link_id`` / ``reason`` (``MERGED`` for a merge), and the journey's
conversations get ``identity_resolution.link`` (or ``.merge``) for the staff
view. ``scripts/unlink_identity_alias.py`` reverses a link from these.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import asyncpg
import structlog

from ..db import merge_jsonb
from .sanitize import safe_str

logger = structlog.get_logger()

# customer.identity.linked.v1 reason codes come from the platform's ResolveLink
# decision table; a customer.identity.merged.v1 has no reason of its own.
MERGED_REASON = "MERGED"

# Projection tables that carry a denormalised customer_id_string column we
# re-point directly to the canonical customer. The applications table is NOT in
# this list — it links to the customer only by the customer_id_id relationship
# (it has no customer_id_string column), so it is re-pointed by ref below.
# Putting it here made every re-attribution UPDATE raise
# ``column "customer_id_string" does not exist`` and roll back the whole
# transaction, so no records ever moved and the event hit the DLQ.
_STRING_KEYED_TABLES = ("conversations", "loan_accounts")


async def resolve_canonical_customer_id(target: Any, customer_id: str | None) -> str | None:
    """Follow a ``merged_into`` tombstone one hop to the canonical customer id.

    Customer-level mirrors (re-application block, identity verification) must
    land on the row the servicing view reads — the canonical one. A single hop
    matches how ``_merge_identity`` writes tombstones (aliases always point
    directly at the surviving canonical id).
    """
    if not customer_id:
        return None
    merged_into = await target.fetchval(
        "SELECT merged_into FROM customers WHERE customer_id = $1", customer_id
    )
    return str(merged_into) if merged_into else customer_id


def _extract_payload(event: dict[str, Any]) -> dict[str, Any]:
    """Return the event payload as a dict (it may arrive as a JSON string)."""
    payload = event.get("payload", {})
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (ValueError, TypeError):
            payload = {}
    return payload if isinstance(payload, dict) else {}


def _optional_str(value: Any, field_name: str) -> str | None:
    text = safe_str(value, field_name) if value is not None else ""
    return text or None


async def handle_customer_identity_linked(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Handle ``customer.identity.linked.v1`` (AC-C1/AC-C2)."""
    payload = _extract_payload(event)
    await _merge_identity(
        pool,
        canonical_id=safe_str(payload.get("canonical_id"), "canonical_id"),
        alias_id=safe_str(payload.get("journey_id"), "journey_id"),
        kind="linked",
        link_id=_optional_str(payload.get("link_id"), "link_id"),
        reason=_optional_str(payload.get("reason"), "reason"),
        conversation_id=_optional_str(event.get("conv"), "conv"),
    )


async def handle_customer_identity_merged(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Handle ``customer.identity.merged.v1`` (AC-C1/AC-C2)."""
    payload = _extract_payload(event)
    await _merge_identity(
        pool,
        canonical_id=safe_str(payload.get("canonical_id"), "canonical_id"),
        alias_id=safe_str(payload.get("merged_canonical_id"), "merged_canonical_id"),
        kind="merged",
        link_id=_optional_str(payload.get("link_id"), "link_id"),
        reason=MERGED_REASON,
        conversation_id=_optional_str(event.get("conv"), "conv"),
    )


async def _merge_identity(
    pool: asyncpg.Pool,
    canonical_id: str,
    alias_id: str,
    kind: str,
    *,
    link_id: str | None = None,
    reason: str | None = None,
    conversation_id: str | None = None,
) -> None:
    """Re-attribute alias records to the canonical and tombstone the alias row."""
    log = logger.bind(canonical_id=canonical_id, alias_id=alias_id, kind=kind)
    if not canonical_id or not alias_id or canonical_id == alias_id:
        log.debug("Identity merge no-op (missing ids or self-link)")
        return

    log.info("Processing customer.identity event — re-attributing to canonical")

    # Resolve both customers-row references. canonical_ref may be None if the
    # canonical customer row hasn't been projected yet — the string column still
    # re-buckets the monitoring grid, and the ref backfills on the next canonical
    # event. alias_ref is needed to re-point `applications`, which links to the
    # customer only by customer_id_id (it has no customer_id_string column).
    canonical_ref = await pool.fetchval(
        "SELECT id FROM customers WHERE customer_id = $1", canonical_id
    )
    alias_ref = await pool.fetchval(
        "SELECT id FROM customers WHERE customer_id = $1", alias_id
    )
    now = datetime.now(timezone.utc)

    outcome_key = "link" if kind == "linked" else "merge"
    outcome: dict[str, Any] = {
        "canonical_id": canonical_id,
        "alias_id": alias_id,
        "link_id": link_id,
        "reason": reason,
        "at": now.isoformat(),
    }

    async with pool.acquire() as conn, conn.transaction():
        # The staff view of the journey: what the platform decided and why.
        # Written before the move so the alias-keyed predicate still matches;
        # the envelope's conversation (the one the platform decided in) is
        # patched by id as well, in case it is not yet keyed by the alias.
        await merge_jsonb(
            conn,
            "conversations",
            column="identity_resolution",
            key_column="customer_id_string",
            key_value=alias_id,
            patch={outcome_key: outcome},
        )
        if conversation_id:
            await merge_jsonb(
                conn,
                "conversations",
                column="identity_resolution",
                key_column="conversation_id",
                key_value=conversation_id,
                patch={outcome_key: outcome},
            )
        # String-keyed projections carry customer_id_string + customer_id_id.
        # identity_origin_customer_id keeps the FIRST id the row arrived under.
        for table in _STRING_KEYED_TABLES:
            await conn.execute(
                f"UPDATE {table} "
                f"SET customer_id_string = $1, customer_id_id = $2, "
                f"identity_origin_customer_id = "
                f"COALESCE(identity_origin_customer_id, customer_id_string) "
                f"WHERE customer_id_string = $3",
                canonical_id,
                canonical_ref,
                alias_id,
            )
        # applications has no customer_id_string — re-point it by the customer_id_id
        # relationship. Only when both refs resolve: if the canonical row isn't
        # projected yet we'd otherwise NULL the link (applications has no string
        # fallback), so leave it on the alias row — now tombstoned via merged_into —
        # until a later canonical event re-points it.
        if alias_ref is not None and canonical_ref is not None:
            await conn.execute(
                "UPDATE applications SET customer_id_id = $1, "
                "identity_origin_customer_id = COALESCE(identity_origin_customer_id, $3) "
                "WHERE customer_id_id = $2",
                canonical_ref,
                alias_ref,
                alias_id,
            )
        # Tombstone/redirect the orphan customers row created under the alias,
        # recording the platform's link id and reason behind it.
        await conn.execute(
            "UPDATE customers SET merged_into = $1, merged_link_id = $2, "
            "merged_reason = $3, updated_at = $4 "
            "WHERE customer_id = $5",
            canonical_id,
            link_id,
            reason,
            now,
            alias_id,
        )

    log.info("Re-attributed alias records to canonical and tombstoned alias row")
