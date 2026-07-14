"""Handlers for marketing facet events (contact.*) -> Payload projections.

Consumes ``contact.*`` events emitted by the marketingService (parsed via the
``billie_marketing_events`` SDK's ``parse_marketing_message``) and projects
them into the Payload-generated ``contacts`` / ``interactions`` /
``contact_audit_log`` tables created in Task C2.

Columns MUST match Payload's generated snake_case names (see db.py header
and the C2 migration ``src/migrations/20260702_223751_marketing_module.ts``).
Notably ``interactions`` carries BOTH ``contact_id_string`` (the marketing
SDK's natural-key text id) and ``contact_id`` (the uuid FK column Payload
generated for the ``contact`` relationship field — NOT ``contact_id_id``).

Every handler is idempotent (upserts / keyed updates) and appends a row to
``contact_audit_log`` so PI erasure and consent flips have a durable trail.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog

from ..db import coerce_date, merge_jsonb, update_by_key, upsert

logger = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(UTC)


async def _audit(
    pool: asyncpg.Pool,
    contact_id: str,
    event_type: str,
    actor: str | None,
    detail: dict[str, Any],
) -> None:
    """Append an immutable audit row for a contact.* projection write."""
    await upsert(
        pool,
        "contact_audit_log",
        conflict_columns=["id"],
        values={
            "id": str(uuid.uuid4()),
            "contact_id_string": contact_id,
            "event_type": event_type,
            "actor": actor,
            "occurred_at": _now(),
            "detail": json.dumps(detail),
            "updated_at": _now(),
            "created_at": _now(),
        },
        do_nothing_on_conflict=True,
    )


async def handle_contact_observed(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``contact.observed.v1`` — first sighting of a contact."""
    p = event.payload
    values = {
        "contact_id": p.contact_id,
        "first_name": p.first_name,
        "email": p.email,
        "mobile_e164": p.mobile_e164,
        "city": p.city,
        "postcode": p.postcode,
        "source": p.source,
        "utm": json.dumps(p.utm),
        "platforms": json.dumps(p.platforms),
        "channel_preference": p.channel_preference,
        "referral_code": p.referral_code,
        "waitlist_joined_at": coerce_date(p.waitlist_joined_at),
        "consent": json.dumps({"marketing": p.consent.model_dump()} if p.consent else {}),
        "observed_at": coerce_date(p.observed_at),
        "updated_at": _now(),
    }
    await upsert(
        pool,
        "contacts",
        conflict_columns=["contact_id"],
        values={k: v for k, v in values.items() if v is not None},
        insert_only_columns=["referral_code", "observed_at"],
    )
    await _audit(pool, p.contact_id, event.event_type, p.actor, {"source": p.source})


async def handle_contact_updated(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``contact.updated.v1`` — attribute changes to an existing contact."""
    p = event.payload
    candidate = {
        "first_name": p.first_name,
        "email": p.email,
        "mobile_e164": p.mobile_e164,
        "city": p.city,
        "postcode": p.postcode,
        "channel_preference": p.channel_preference,
    }
    changed = {k: v for k, v in candidate.items() if v is not None}
    # attributes is a DELTA (the command's patch) — merge it, never overwrite,
    # or flag overlays (advocate, needs_review) would wipe each other.
    attributes_patch = p.attributes if p.attributes else None
    if attributes_patch and "needs_review" in attributes_patch:
        # Mirror to the dedicated column so the grid can filter on it.
        changed["needs_review"] = bool(attributes_patch.get("needs_review"))
    if attributes_patch and "advisory_council" in attributes_patch:
        # Advisory-council membership mirrors to panel_member (same pattern).
        changed["panel_member"] = bool(attributes_patch.get("advisory_council"))

    values = {"contact_id": p.contact_id, **changed, "updated_at": _now()}
    await upsert(
        pool,
        "contacts",
        conflict_columns=["contact_id"],
        values=values,
        insert_only_columns=[],
    )
    if attributes_patch:
        await merge_jsonb(
            pool,
            "contacts",
            column="attributes",
            key_column="contact_id",
            key_value=p.contact_id,
            patch=attributes_patch,
        )
    audit_fields = sorted(set(changed) | ({"attributes"} if attributes_patch else set()))
    await _audit(
        pool, p.contact_id, event.event_type, p.actor, {"changed_fields": audit_fields}
    )


async def handle_contact_linked(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``contact.linked.v1`` — contact matched to a customer record."""
    p = event.payload
    await update_by_key(
        pool,
        "contacts",
        key_column="contact_id",
        key_value=p.contact_id,
        values={
            "customer_id": p.customer_id,
            "link_basis": p.match_basis,
            "linked_at": coerce_date(p.linked_at),
            "updated_at": _now(),
        },
    )
    await _audit(
        pool,
        p.contact_id,
        event.event_type,
        # Manual (staff) links carry the actor; matcher links don't.
        getattr(p, "actor", None),
        {"customer_id": p.customer_id, "match_basis": p.match_basis},
    )


async def handle_contact_unlinked(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``contact.unlinked.v1`` — remove a contact<->customer link."""
    p = event.payload
    await update_by_key(
        pool,
        "contacts",
        key_column="contact_id",
        key_value=p.contact_id,
        values={
            "customer_id": None,
            "link_basis": None,
            "linked_at": None,
            "updated_at": _now(),
        },
    )
    await _audit(
        pool,
        p.contact_id,
        event.event_type,
        getattr(p, "actor", None),
        {"customer_id": p.customer_id, "reason": p.reason},
    )


async def handle_contact_consent_granted(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``contact.consent.granted.v1`` — patch the ``consent`` jsonb column."""
    p = event.payload
    await merge_jsonb(
        pool,
        "contacts",
        column="consent",
        key_column="contact_id",
        key_value=p.contact_id,
        patch={
            "marketing": {
                "granted": True,
                "channels": p.channels,
                "method": p.method,
                "at": p.occurred_at,
            }
        },
    )
    await _audit(
        pool, p.contact_id, event.event_type, p.actor, {"channels": p.channels, "method": p.method}
    )


async def handle_contact_consent_withdrawn(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``contact.consent.withdrawn.v1`` — patch the ``consent`` jsonb column."""
    p = event.payload
    await merge_jsonb(
        pool,
        "contacts",
        column="consent",
        key_column="contact_id",
        key_value=p.contact_id,
        patch={
            "marketing": {
                "granted": False,
                "channels": p.channels,
                "method": p.method,
                "at": p.occurred_at,
            }
        },
    )
    await _audit(
        pool, p.contact_id, event.event_type, p.actor, {"channels": p.channels, "method": p.method}
    )


# The interactions.direction column is a Postgres enum (inbound/outbound).
# The SDK field is a free string, so normalise here: a non-canonical value in
# one event must degrade to NULL, not DLQ-loop the whole stream partition.
_DIRECTION_ALIASES = {
    "in": "inbound",
    "inbound": "inbound",
    "out": "outbound",
    "outbound": "outbound",
}


def _normalise_direction(raw: Any) -> str | None:
    if not raw:
        return None
    return _DIRECTION_ALIASES.get(str(raw).strip().lower())


async def handle_contact_interaction_logged(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``contact.interaction.logged.v1`` — append-only interaction row.

    ``interactions`` carries both the marketing SDK's natural-key text id
    (``contact_id_string``) and the Payload relationship column
    (``contact_id``, a uuid FK to ``contacts.id``). The FK is resolved and set
    only if the contact row already exists at first-delivery time; it is NOT
    backfilled on replay, because the ``do_nothing_on_conflict=True`` upsert
    below leaves an already-inserted interaction row untouched. This is
    harmless: the detail route queries interactions by ``contact_id_string``,
    not by the uuid FK.
    """
    p = event.payload
    contact_ref = await pool.fetchval("SELECT id FROM contacts WHERE contact_id = $1", p.contact_id)

    values: dict[str, Any] = {
        "interaction_id": p.interaction_id,
        "contact_id_string": p.contact_id,
        "occurred_at": coerce_date(p.occurred_at),
        "kind": p.kind,
        "channel": p.channel,
        "direction": _normalise_direction(p.direction),
        "subject": p.subject,
        "body": p.body,
        "source_system": p.source_system,
        "metadata": json.dumps(p.metadata),
        "updated_at": _now(),
        "created_at": _now(),
    }
    if contact_ref is not None:
        values["contact_id"] = contact_ref

    await upsert(
        pool,
        "interactions",
        conflict_columns=["interaction_id"],
        values=values,
        do_nothing_on_conflict=True,
    )
    await _audit(
        pool,
        p.contact_id,
        event.event_type,
        None,
        {"interaction_id": p.interaction_id, "kind": p.kind},
    )


async def handle_contact_stage_changed(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``contact.stage.changed.v1`` — flip the ``derived_stage`` column."""
    p = event.payload
    # Symmetric naive-downgrade guard (mirrors marketingService apply_stage):
    # only the authoritative state derivation (basis="state") may move a
    # protected stage back to lead/waitlist — a stray naive event must not
    # make this projection disagree with the canonical one.
    if getattr(p, "basis", None) != "state" and p.stage in ("lead", "waitlist"):
        current = await pool.fetchval(
            "SELECT derived_stage FROM contacts WHERE contact_id = $1", p.contact_id
        )
        if current in ("invited", "applicant", "customer", "former_customer", "closed"):
            return
    await update_by_key(
        pool,
        "contacts",
        key_column="contact_id",
        key_value=p.contact_id,
        values={
            "derived_stage": p.stage,
            "updated_at": _now(),
            # Loan-status mirror rides on state-projection-driven stage
            # changes (spec §4); tolerant of pre-field SDK models.
            **(
                {"loan_status": getattr(p, "loan_status", None)}
                if getattr(p, "loan_status", None) is not None
                else {}
            ),
        },
    )
    await _audit(
        pool,
        p.contact_id,
        event.event_type,
        None,
        {"previous_stage": p.previous_stage, "stage": p.stage},
    )


async def handle_contact_merged(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``contact.merged.v1`` — duplicate resolved to one person.

    Mirrors the platform projection: the merged record's interactions,
    feedback and audit rows re-attach to the survivor; the merged contact row
    is tombstoned with ``merged_into`` (grid queries exclude it); the
    survivor's consent takes the command-resolved value (opt-out dominates).
    Idempotent — every statement is a no-op on replay.
    """
    p = event.payload
    survivor = p.survivor_contact_id
    merged = p.merged_contact_id

    survivor_ref = await pool.fetchval(
        "SELECT id FROM contacts WHERE contact_id = $1", survivor
    )

    # Re-attach history (natural-key column + relationship FK where present)
    if survivor_ref is not None:
        await pool.execute(
            "UPDATE interactions SET contact_id_string = $1, contact_id = $2"
            " WHERE contact_id_string = $3",
            survivor,
            survivor_ref,
            merged,
        )
    else:
        await pool.execute(
            "UPDATE interactions SET contact_id_string = $1 WHERE contact_id_string = $2",
            survivor,
            merged,
        )
    await pool.execute(
        "UPDATE feedback SET contact_id_string = $1 WHERE contact_id_string = $2",
        survivor,
        merged,
    )
    await pool.execute(
        "UPDATE contact_audit_log SET contact_id_string = $1 WHERE contact_id_string = $2",
        survivor,
        merged,
    )

    # Tombstone the merged record
    await update_by_key(
        pool,
        "contacts",
        key_column="contact_id",
        key_value=merged,
        values={"merged_into": survivor, "updated_at": _now()},
    )

    # Survivor consent: command-resolved (opt-out dominates)
    if p.consent_resolution is not None:
        await update_by_key(
            pool,
            "contacts",
            key_column="contact_id",
            key_value=survivor,
            values={"consent": json.dumps(p.consent_resolution), "updated_at": _now()},
        )

    await _audit(
        pool,
        survivor,
        event.event_type,
        getattr(p, "actor", None),
        {"merged_contact_id": merged},
    )


async def handle_contact_erased(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``contact.erased.v1`` — redact PI from ``contacts`` + ``interactions``.

    Nulls direct PI columns on the ``contacts`` row (including the free-text
    ``consent.method`` and ``channel_preference``) and clears the free-text
    ``subject``/``body``/``metadata`` on every interaction for this contact.
    The audit row deliberately carries no PI in its ``detail`` (ids only).
    """
    p = event.payload
    await update_by_key(
        pool,
        "contacts",
        key_column="contact_id",
        key_value=p.contact_id,
        values={
            "first_name": None,
            "email": None,
            "mobile_e164": None,
            "city": None,
            "postcode": None,
            "utm": json.dumps({}),
            "attributes": json.dumps({}),
            "consent": json.dumps({}),
            "channel_preference": None,
            "erased": True,
            "updated_at": _now(),
        },
    )
    await pool.execute(
        "UPDATE interactions SET subject = NULL, body = NULL, metadata = $1 "
        "WHERE contact_id_string = $2",
        json.dumps({}),
        p.contact_id,
    )
    # DSR completeness: feedback text is free text typed by the data subject —
    # often the most sensitive content held. Redact it (and the staff
    # resolution note, which may quote it) alongside interactions.
    await pool.execute(
        "UPDATE feedback SET body = NULL, status_note = NULL "
        "WHERE contact_id_string = $1",
        p.contact_id,
    )
    # Audit-hardening pass: audit details are ids-only by design, EXCEPT the
    # consent 'method' free text (e.g. "phone call") — strip it on erasure so
    # the audit trail stays PI-clean while remaining append-only otherwise.
    await pool.execute(
        "UPDATE contact_audit_log SET detail = (detail::jsonb - 'method')::json "
        "WHERE contact_id_string = $1 AND detail::jsonb ? 'method'",
        p.contact_id,
    )
    await _audit(pool, p.contact_id, event.event_type, p.actor, {})


# =============================================================================
# Phase-2 (Stream A) handlers — batches, feedback, referral attribution.
# batch.assigned + referral.attributed patch pre-provisioned columns on the
# existing ``contacts`` row (batch_id / referred_by_contact_id); batch.created
# and feedback.* project into their own read-only collections.
# =============================================================================


async def handle_batch_created(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``batch.created.v1`` — upsert a marketing batch definition.

    Batches are not contact-scoped, so there is no ``contact_audit_log`` row.
    Create-once semantics: a re-delivery leaves the existing row untouched.
    """
    p = event.payload
    await upsert(
        pool,
        "batches",
        conflict_columns=["batch_id"],
        values={
            "batch_id": p.batch_id,
            "name": p.name,
            "criteria": json.dumps(p.criteria),
            "created_by_actor": p.actor,
            "batch_created_at": coerce_date(p.created_at),
            "updated_at": _now(),
            "created_at": _now(),
        },
        do_nothing_on_conflict=True,
    )


async def handle_contact_batch_assigned(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``contact.batch.assigned.v1`` — set the contact's current batch."""
    p = event.payload
    await update_by_key(
        pool,
        "contacts",
        key_column="contact_id",
        key_value=p.contact_id,
        values={"batch_id": p.batch_id, "updated_at": _now()},
    )
    await _audit(pool, p.contact_id, event.event_type, p.actor, {"batch_id": p.batch_id})


async def handle_batch_invitations_triggered(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``batch.invitations.triggered.v1`` — persist the send outcome
    (invited_at + counts) on the batch row. Last-write-wins per batch."""
    p = event.payload
    await update_by_key(
        pool,
        "batches",
        key_column="batch_id",
        key_value=p.batch_id,
        values={
            "invited_at": coerce_date(p.triggered_at),
            "invited_count": p.invited_count,
            "skipped_unconsented": p.skipped_unconsented,
            "skipped_needs_review": p.skipped_needs_review,
            "updated_at": _now(),
        },
    )


async def handle_feedback_received(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``feedback.received.v1`` — insert a feedback row (status=new).

    Append-only projection keyed by ``feedback_id``; a re-delivery leaves the
    row (and any status already advanced by a later event) untouched.
    """
    p = event.payload
    values = {
        "feedback_id": p.feedback_id,
        "contact_id_string": p.contact_id,
        "customer_id": p.customer_id,
        "feedback_type": p.type,
        "severity": p.severity,
        "body": p.text,
        "product_area": p.product_area,
        "received_at": coerce_date(p.received_at),
        "status": "new",
        "updated_at": _now(),
        "created_at": _now(),
    }
    await upsert(
        pool,
        "feedback",
        conflict_columns=["feedback_id"],
        values={k: v for k, v in values.items() if v is not None},
        do_nothing_on_conflict=True,
    )
    await _audit(
        pool,
        p.contact_id,
        event.event_type,
        None,
        {"feedback_id": p.feedback_id, "type": p.type},
    )


async def handle_feedback_status_changed(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``feedback.status.changed.v1`` — advance a feedback row's status.

    The event carries no ``contact_id``; the audit row is written against the
    feedback's contact only if the feedback row already exists (out-of-order
    delivery leaves no phantom audit).
    """
    p = event.payload
    # `note` (what was done) arrived with the resolution-note feature —
    # getattr keeps this tolerant of pre-note SDK models during rollout.
    note = getattr(p, "note", None)
    values = {
        "status": p.status,
        "status_changed_at": coerce_date(p.changed_at),
        "status_actor": p.actor,
        "updated_at": _now(),
    }
    if note:
        values["status_note"] = note
    await update_by_key(
        pool,
        "feedback",
        key_column="feedback_id",
        key_value=p.feedback_id,
        values=values,
    )
    contact_ref = await pool.fetchval(
        "SELECT contact_id_string FROM feedback WHERE feedback_id = $1", p.feedback_id
    )
    if contact_ref is not None:
        await _audit(
            pool,
            contact_ref,
            event.event_type,
            p.actor,
            {"feedback_id": p.feedback_id, "status": p.status},
        )


async def handle_referral_attributed(pool: asyncpg.Pool, event: Any) -> None:
    """Handle ``referral.attributed.v1`` — record who referred the referee.

    Patches ``referred_by_contact_id`` on the referee's contact row (the
    referrer's referred-count is derived at read time). Idempotent.
    """
    p = event.payload
    await update_by_key(
        pool,
        "contacts",
        key_column="contact_id",
        key_value=p.referee_contact_id,
        values={"referred_by_contact_id": p.referrer_contact_id, "updated_at": _now()},
    )
    await _audit(
        pool,
        p.referee_contact_id,
        event.event_type,
        None,
        {"referrer_contact_id": p.referrer_contact_id, "code": p.code},
    )
