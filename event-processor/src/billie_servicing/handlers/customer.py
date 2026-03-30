"""Customer event handlers using Billie Customers SDK.

Handles events:
- customer.changed.v1
- customer.created.v1
- customer.updated.v1
- customer.verified.v1
"""

from datetime import datetime
from typing import Any

import structlog
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = structlog.get_logger()


async def handle_customer_changed(db: AsyncIOMotorDatabase, parsed_event: Any) -> None:
    """
    Handle customer.changed.v1, customer.created.v1, customer.updated.v1 events.

    SDK Model: CustomerChangedV1
    Fields: customer_id, first_name, last_name, email_address,
            mobile_phone_number, date_of_birth, ekyc_status,
            residential_address, changed_at
    """
    payload = parsed_event.payload
    customer_id = payload.customer_id

    log = logger.bind(customer_id=customer_id)
    log.info("Processing customer event")

    # Get existing customer for merge (events may be partial updates)
    existing = await db.customers.find_one({"customerId": customer_id})

    # Build full name
    first = getattr(payload, "first_name", None) or (existing or {}).get("firstName", "")
    last = getattr(payload, "last_name", None) or (existing or {}).get("lastName", "")
    full_name = f"{first} {last}".strip()

    update_doc: dict[str, Any] = {
        "customerId": customer_id,
        "fullName": full_name,
        "updatedAt": datetime.utcnow(),
    }

    # Map SDK fields to Payload fields
    field_mappings = {
        "first_name": "firstName",
        "last_name": "lastName",
        "email_address": "emailAddress",
        "mobile_phone_number": "mobilePhoneNumber",
        "date_of_birth": "dateOfBirth",
        "ekyc_status": "ekycStatus",
    }

    for sdk_field, payload_field in field_mappings.items():
        value = getattr(payload, sdk_field, None)
        if value is not None:
            update_doc[payload_field] = value

    # Handle residential address
    if hasattr(payload, "residential_address") and payload.residential_address:
        addr = payload.residential_address
        update_doc["residentialAddress"] = {
            "streetNumber": getattr(addr, "street_number", None),
            "streetName": getattr(addr, "street_name", None),
            "streetType": getattr(addr, "street_type", None),
            "unitNumber": getattr(addr, "unit_number", None),
            "suburb": getattr(addr, "suburb", None),
            "state": getattr(addr, "state", None),
            "postcode": getattr(addr, "postcode", None),
            "country": getattr(addr, "country", "Australia"),
            "fullAddress": getattr(addr, "full_address", None),
            # Computed street field for backward compatibility
            "street": _build_street_address(addr),
            "city": getattr(addr, "suburb", None),  # Map suburb to city
        }

    result = await db.customers.update_one(
        {"customerId": customer_id},
        {
            "$set": update_doc,
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )

    log.info(
        "Customer upserted",
        customer_id=customer_id,
        matched=result.matched_count,
        modified=result.modified_count,
        upserted_id=str(result.upserted_id) if result.upserted_id else None,
    )


def _build_street_address(addr: Any) -> str:
    """Build a single-line street address from components."""
    parts = []

    unit = getattr(addr, "unit_number", None)
    if unit:
        parts.append(f"Unit {unit}")

    street_num = getattr(addr, "street_number", None)
    street_name = getattr(addr, "street_name", None)
    street_type = getattr(addr, "street_type", None)

    if street_num:
        street_line = street_num
        if street_name:
            street_line += f" {street_name}"
        if street_type:
            street_line += f" {street_type}"
        parts.append(street_line)

    return ", ".join(parts) if parts else ""


async def handle_customer_verified(db: AsyncIOMotorDatabase, parsed_event: Any) -> None:
    """
    Handle customer.verified.v1 event.

    Sets identityVerified flag to true.

    Fields: customer_id, verified_at
    """
    payload = parsed_event.payload
    customer_id = payload.customer_id

    log = logger.bind(customer_id=customer_id)
    log.info("Processing customer.verified.v1")

    result = await db.customers.update_one(
        {"customerId": customer_id},
        {
            "$set": {
                "identityVerified": True,
                "ekycStatus": "successful",
                "updatedAt": datetime.utcnow(),
            }
        },
    )

    log.info(
        "Customer verified", matched=result.matched_count, modified=result.modified_count
    )

