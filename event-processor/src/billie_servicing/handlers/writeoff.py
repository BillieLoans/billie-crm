"""Write-off event handlers for CRM-originated events.

Handles events:
- writeoff.requested.v1
- writeoff.approved.v1
- writeoff.rejected.v1
- writeoff.cancelled.v1

These events originate from the CRM and are published to Redis,
then routed back to this processor to create/update MongoDB projections.
"""

import json
import random
import string
from datetime import datetime
from typing import Any

import structlog
from motor.motor_asyncio import AsyncIOMotorDatabase

from .sanitize import safe_str

logger = structlog.get_logger()


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
    return payload


def _generate_request_number() -> str:
    """Generate a human-readable write-off request number.
    
    Format: WO-YYYYMMDDHHMMSS-XXXX
    Where XXXX is a random alphanumeric suffix.
    """
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"WO-{timestamp}-{suffix}"


async def handle_writeoff_requested(
    db: AsyncIOMotorDatabase, parsed_event: dict[str, Any]
) -> None:
    """
    Handle writeoff.requested.v1 event.
    
    Creates a new write-off request document in the write-off-requests collection.
    
    Event envelope fields:
    - conv: Request ID (for workflow correlation)
    - cause: Event ID (for polling lookup)
    - typ: "writeoff.requested.v1"
    
    Payload fields:
    - loanAccountId, customerId, customerName, accountNumber
    - amount, originalBalance, reason, notes, priority
    - requestedBy, requestedByName
    """
    payload = _parse_payload(parsed_event)

    request_id = safe_str(parsed_event.get("conv", ""), "request_id")
    event_id = safe_str(parsed_event.get("cause", ""), "event_id")

    log = logger.bind(
        request_id=request_id,
        event_id=event_id,
        loan_account_id=payload.get("loanAccountId"),
    )
    log.info("Processing writeoff.requested.v1")
    
    # Generate human-readable request number
    request_number = _generate_request_number()
    
    now = datetime.utcnow()
    
    document = {
        # IDs for lookup and correlation
        "requestId": request_id,
        "eventId": event_id,
        "requestNumber": request_number,
        
        # Account/customer info
        "loanAccountId": payload.get("loanAccountId"),
        "customerId": payload.get("customerId"),
        "customerName": payload.get("customerName", ""),
        "accountNumber": payload.get("accountNumber", ""),
        
        # Request details
        "amount": payload.get("amount"),
        "originalBalance": payload.get("originalBalance"),
        "reason": payload.get("reason"),
        "notes": payload.get("notes"),
        "priority": payload.get("priority", "normal"),
        "status": "pending",
        
        # Audit
        "requestedBy": payload.get("requestedBy"),
        "requestedByName": payload.get("requestedByName", ""),
        "requestedAt": now,
        
        # Timestamps
        "createdAt": now,
        "updatedAt": now,
    }
    
    result = await db["write-off-requests"].insert_one(document)
    
    log.info(
        "Write-off request created",
        request_number=request_number,
        inserted_id=str(result.inserted_id),
    )


async def handle_writeoff_approved(
    db: AsyncIOMotorDatabase, parsed_event: dict[str, Any]
) -> None:
    """
    Handle writeoff.approved.v1 event.
    
    Updates the write-off request status to 'approved' and sets approval details.
    
    Event envelope fields:
    - conv: Request ID (matches the original request)
    - cause: Event ID
    - typ: "writeoff.approved.v1"
    
    Payload fields:
    - requestId, requestNumber
    - comment
    - approvedBy, approvedByName
    """
    payload = _parse_payload(parsed_event)

    request_id = safe_str(parsed_event.get("conv", ""), "request_id")
    event_id = safe_str(parsed_event.get("cause", ""), "event_id")

    log = logger.bind(
        request_id=request_id,
        event_id=event_id,
    )
    log.info("Processing writeoff.approved.v1")
    
    now = datetime.utcnow()
    
    result = await db["write-off-requests"].update_one(
        {"requestId": request_id},
        {
            "$set": {
                "status": "approved",
                "approvalDetails": {
                    "approvedBy": payload.get("approvedBy"),
                    "approvedByName": payload.get("approvedByName", ""),
                    "comment": payload.get("comment", ""),
                    "approvedAt": now,
                },
                "updatedAt": now,
            }
        },
    )
    
    log.info(
        "Write-off request approved",
        matched=result.matched_count,
        modified=result.modified_count,
    )


async def handle_writeoff_rejected(
    db: AsyncIOMotorDatabase, parsed_event: dict[str, Any]
) -> None:
    """
    Handle writeoff.rejected.v1 event.
    
    Updates the write-off request status to 'rejected' and sets rejection details.
    
    Event envelope fields:
    - conv: Request ID (matches the original request)
    - cause: Event ID
    - typ: "writeoff.rejected.v1"
    
    Payload fields:
    - requestId, requestNumber
    - reason
    - rejectedBy, rejectedByName
    """
    payload = _parse_payload(parsed_event)

    request_id = safe_str(parsed_event.get("conv", ""), "request_id")
    event_id = safe_str(parsed_event.get("cause", ""), "event_id")

    log = logger.bind(
        request_id=request_id,
        event_id=event_id,
    )
    log.info("Processing writeoff.rejected.v1")
    
    now = datetime.utcnow()
    
    result = await db["write-off-requests"].update_one(
        {"requestId": request_id},
        {
            "$set": {
                "status": "rejected",
                "approvalDetails": {
                    "rejectedBy": payload.get("rejectedBy"),
                    "rejectedByName": payload.get("rejectedByName", ""),
                    "reason": payload.get("reason", ""),
                    "rejectedAt": now,
                },
                "updatedAt": now,
            }
        },
    )
    
    log.info(
        "Write-off request rejected",
        matched=result.matched_count,
        modified=result.modified_count,
    )


async def handle_writeoff_cancelled(
    db: AsyncIOMotorDatabase, parsed_event: dict[str, Any]
) -> None:
    """
    Handle writeoff.cancelled.v1 event.
    
    Updates the write-off request status to 'cancelled'.
    
    Event envelope fields:
    - conv: Request ID (matches the original request)
    - cause: Event ID
    - typ: "writeoff.cancelled.v1"
    
    Payload fields:
    - requestId, requestNumber
    - cancelledBy, cancelledByName
    """
    payload = _parse_payload(parsed_event)

    request_id = safe_str(parsed_event.get("conv", ""), "request_id")
    event_id = safe_str(parsed_event.get("cause", ""), "event_id")

    log = logger.bind(
        request_id=request_id,
        event_id=event_id,
    )
    log.info("Processing writeoff.cancelled.v1")
    
    now = datetime.utcnow()
    
    result = await db["write-off-requests"].update_one(
        {"requestId": request_id},
        {
            "$set": {
                "status": "cancelled",
                "cancellationDetails": {
                    "cancelledBy": payload.get("cancelledBy"),
                    "cancelledByName": payload.get("cancelledByName", ""),
                    "cancelledAt": now,
                },
                "updatedAt": now,
            }
        },
    )
    
    log.info(
        "Write-off request cancelled",
        matched=result.matched_count,
        modified=result.modified_count,
    )
