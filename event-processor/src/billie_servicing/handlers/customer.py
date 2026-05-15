"""Customer event handlers using Billie Customers SDK.

Handles events:
- customer.changed.v1
- customer.created.v1
- customer.updated.v1
- customer.verified.v1
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import asyncpg
import structlog

from ..db import coerce_date, update_by_key, upsert

logger = structlog.get_logger()


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
    """
    payload = parsed_event.payload
    customer_id = payload.customer_id

    log = logger.bind(customer_id=customer_id)
    log.info("Processing customer event")

    # Fetch existing for full_name computation. We only need first/last to
    # rebuild the denormalised full_name when the incoming event is partial.
    existing = await pool.fetchrow(
        "SELECT first_name, last_name FROM customers WHERE customer_id = $1",
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
            values[column] = v

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
