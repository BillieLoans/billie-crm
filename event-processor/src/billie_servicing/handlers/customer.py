"""Customer event handlers using Billie Customers SDK.

Handles events:
- customer.changed.v1
- customer.created.v1
- customer.updated.v1
- customer.verified.v1
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from enum import Enum
from typing import Any

import asyncpg
import structlog

from ..db import coerce_date, update_by_key, upsert
from .clicksend import normalise_au_mobile

logger = structlog.get_logger()

# Upstream eKYC vocabulary → the Payload enum (enum_customers_ekyc_status:
# successful/failed/pending). Upstream started emitting "APPROVED" on
# customer.changed.v1 (2026-08-17), and the raw pass-through failed the enum
# check — DLQ'ing the entire customer update. Keyed lower-case; matching is
# case-insensitive and strips any EnumName.MEMBER prefix.
EKYC_STATUS_MAP = {
    "successful": "successful",
    "success": "successful",
    "approved": "successful",
    "passed": "successful",
    "verified": "successful",
    "failed": "failed",
    "fail": "failed",
    "declined": "failed",
    "rejected": "failed",
    "pending": "pending",
    "in_progress": "pending",
    "in_review": "pending",
}


def _normalise_ekyc_status(value: Any) -> str | None:
    """Map an upstream ekyc_status onto the Payload enum; None if unknown."""
    raw = str(value).split(".")[-1].strip().lower()
    return EKYC_STATUS_MAP.get(raw)


# BTB-392 (customer data ownership SP4): identity provenance the platform
# customerService puts on customer.changed.v1 since customers SDK 3.0.0.
# Flat columns describe the primary contact per type; ``contacts`` is the
# SDK's ContactRecord list, stored verbatim (jsonb). The CRM renders these; it
# applies no survivorship logic of its own. Every field is optional on the
# wire — a 2.x-shaped event (pre-cut-over billieChat, replays) touches none of
# these columns.
_PROVENANCE_TEXT_FIELDS = {
    "canonical_id": "canonical_id",
    "customer_id_status": "customer_id_status",
    "email_tier": "email_tier",
    "email_source": "email_source",
    "mobile_phone_tier": "mobile_phone_tier",
    "mobile_phone_source": "mobile_phone_source",
    "changed_by": "contacts_changed_by",
}
_PROVENANCE_DATE_FIELDS = {
    "email_verified_at": "email_verified_at",
    "mobile_phone_verified_at": "mobile_phone_verified_at",
    "changed_at": "contacts_changed_at",
}


def _enum_text(value: Any) -> str | None:
    """A str / str-Enum payload value as text; anything else is "absent"."""
    if isinstance(value, Enum):
        value = value.value
    if isinstance(value, str) and value.strip():
        return value
    return None


def _contacts_json(contacts: Any) -> str | None:
    """The SDK ``contacts`` list as a JSON text for the jsonb column.

    Accepts ContactRecord models (``model_dump``) or plain dicts. ``None`` /
    empty / anything else means "not carried on this event" — the column is
    left untouched, never cleared.
    """
    if not isinstance(contacts, list) or not contacts:
        return None
    records: list[dict[str, Any]] = []
    for c in contacts:
        if hasattr(c, "model_dump"):
            records.append(c.model_dump(mode="json", exclude_none=True))
        elif isinstance(c, dict):
            records.append(c)
        else:
            return None
    return json.dumps(records)


def provenance_values(payload: Any) -> dict[str, Any]:
    """Column values for the provenance the event carries (possibly empty)."""
    values: dict[str, Any] = {}
    for sdk_field, column in _PROVENANCE_TEXT_FIELDS.items():
        text = _enum_text(getattr(payload, sdk_field, None))
        if text is not None:
            values[column] = text
    for sdk_field, column in _PROVENANCE_DATE_FIELDS.items():
        raw = getattr(payload, sdk_field, None)
        if isinstance(raw, str | datetime):
            coerced = coerce_date(raw)
            if coerced is not None:
                values[column] = coerced
    contacts = _contacts_json(getattr(payload, "contacts", None))
    if contacts is not None:
        values["contacts"] = contacts
    return values


def _build_street_address(addr: Any) -> str:
    """Build a single-line street address from components."""
    parts: list[str] = []

    unit = getattr(addr, "unit_number", None)
    if unit:
        parts.append(f"Unit {unit}")

    street_num = getattr(addr, "street_number", None)
    street_name = getattr(addr, "street_name", None)
    street_type = getattr(addr, "street_type", None)

    if street_num:
        street_line = str(street_num)
        if street_name:
            street_line += f" {street_name}"
        if street_type:
            street_line += f" {street_type}"
        parts.append(street_line)

    return ", ".join(parts) if parts else ""


async def handle_customer_changed(pool: asyncpg.Pool, parsed_event: Any) -> None:
    """Handle customer.changed.v1, customer.created.v1, customer.updated.v1.

    Upserts a row in ``customers`` keyed on the natural ``customer_id``.
    Address fields are flattened into ``residential_address_*`` columns.

    Events may be partial updates: missing fields are simply omitted from the
    values dict so ON CONFLICT DO UPDATE only touches what's present. The
    full_name column is recomputed from first/last name on every event.

    Since customers SDK 3.x the platform's event also carries identity
    provenance (``canonical_id``, ``customer_id_status``, per-type contact
    tier / source / verified-at, ``contacts``, ``changed_by``); see
    ``provenance_values``. ``contacts`` replaces the whole stored list when
    present (the platform always publishes the full set).
    """
    payload = parsed_event.payload
    customer_id = payload.customer_id

    log = logger.bind(customer_id=customer_id)
    log.info("Processing customer event")

    # Fetch existing for full_name computation (first/last) and as a fallback
    # mobile for the grant back-fill below, since a partial event may update
    # e.g. address only and not re-carry the mobile the customer already has.
    existing = await pool.fetchrow(
        "SELECT first_name, last_name, mobile_phone_number FROM customers WHERE customer_id = $1",
        customer_id,
    )

    incoming_first = getattr(payload, "first_name", None)
    incoming_last = getattr(payload, "last_name", None)
    first = incoming_first if incoming_first is not None else (existing["first_name"] if existing else "")
    last = incoming_last if incoming_last is not None else (existing["last_name"] if existing else "")
    full_name = f"{(first or '').strip()} {(last or '').strip()}".strip()

    now = datetime.now(timezone.utc)
    values: dict[str, Any] = {
        "customer_id": customer_id,
        "full_name": full_name,
        "updated_at": now,
        "created_at": now,
    }

    field_mappings = {
        "first_name": "first_name",
        "last_name": "last_name",
        "email_address": "email_address",
        "mobile_phone_number": "mobile_phone_number",
        "date_of_birth": "date_of_birth",
        "ekyc_status": "ekyc_status",
    }
    for sdk_field, column in field_mappings.items():
        v = getattr(payload, sdk_field, None)
        if v is not None:
            # date_of_birth lands in a timestamp column — asyncpg won't accept
            # raw ISO strings, so coerce explicitly.
            if column == "date_of_birth":
                v = coerce_date(v)
                if v is None:
                    continue
            # ekyc_status is an enum column — an unmappable value must drop
            # only this field, not DLQ the whole customer update.
            if column == "ekyc_status":
                v = _normalise_ekyc_status(v)
                if v is None:
                    log.warning(
                        "Unknown ekyc_status value — field skipped",
                        ekyc_status=str(getattr(payload, sdk_field, None)),
                    )
                    continue
            values[column] = v

    # Identity provenance (SDK 3.x) — absent on a 2.x-shaped event.
    values.update(provenance_values(payload))

    if hasattr(payload, "residential_address") and payload.residential_address:
        addr = payload.residential_address
        # Suburb maps to both *_suburb and *_city for backward compatibility
        # (mirrors the original Mongo handler).
        suburb = getattr(addr, "suburb", None)
        values.update(
            {
                "residential_address_street_number": getattr(addr, "street_number", None),
                "residential_address_street_name": getattr(addr, "street_name", None),
                "residential_address_street_type": getattr(addr, "street_type", None),
                "residential_address_unit_number": getattr(addr, "unit_number", None),
                "residential_address_suburb": suburb,
                "residential_address_state": getattr(addr, "state", None),
                "residential_address_postcode": getattr(addr, "postcode", None),
                "residential_address_country": getattr(addr, "country", "Australia"),
                "residential_address_full_address": getattr(addr, "full_address", None),
                "residential_address_street": _build_street_address(addr),
                "residential_address_city": suburb,
            }
        )

    await upsert(
        pool,
        "customers",
        conflict_columns=["customer_id"],
        values=values,
        insert_only_columns=["created_at"],
    )

    log.info("Customer upserted", customer_id=customer_id)

    # Back-fill: an applicant who claimed the release gate (release_grants,
    # keyed by mobile) may now have become a customer. Prefer the mobile this
    # event actually carried; fall back to whatever's already persisted so a
    # partial update (e.g. address-only) doesn't skip the back-fill for a
    # customer whose mobile was set on an earlier event.
    incoming_mobile = getattr(payload, "mobile_phone_number", None)
    effective_mobile = (
        incoming_mobile
        if incoming_mobile is not None
        else (existing["mobile_phone_number"] if existing else None)
    )
    await link_customer_to_grants(pool, customer_id, effective_mobile)


async def link_customer_to_grants(
    pool: asyncpg.Pool, customer_id: str, raw_mobile: str | None
) -> None:
    """Back-fill ``release_grants.customer_id`` for the grant(s) this customer
    claimed pre-signup, joined on the OTP-verified mobile they used at the
    gate (spec 2026-08-02, post-release follow-up).

    Idempotent and replay-safe: the UPDATE only ever touches rows where
    ``customer_id IS NULL``, so re-processing the same (or a later) customer
    event is a no-op once linked. Not restricted to active releases — a late
    link is still correct attribution. No-ops on an unnormalisable/missing
    mobile.
    """
    mobile_e164 = normalise_au_mobile(raw_mobile)
    if not mobile_e164:
        return
    await pool.execute(
        "UPDATE release_grants SET customer_id = $1, updated_at = $2 "
        "WHERE mobile_e164 = $3 AND customer_id IS NULL",
        customer_id,
        datetime.now(timezone.utc),
        mobile_e164,
    )


async def handle_customer_verified(pool: asyncpg.Pool, parsed_event: Any) -> None:
    """Handle customer.verified.v1 — sets identityVerified flag."""
    payload = parsed_event.payload
    customer_id = payload.customer_id

    log = logger.bind(customer_id=customer_id)
    log.info("Processing customer.verified.v1")

    now = datetime.now(timezone.utc)
    status = await update_by_key(
        pool,
        "customers",
        key_column="customer_id",
        key_value=customer_id,
        values={
            "identity_verified": True,
            "ekyc_status": "successful",
            "updated_at": now,
        },
    )

    log.info("Customer verified", asyncpg_status=status)
