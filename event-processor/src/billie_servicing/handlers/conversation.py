"""Conversation event handlers.

Handles all chat/conversation events (ported from worker.ts):
- conversation_started
- user_input
- assistant_response
- applicationDetail_changed
- identityRisk_assessment
- serviceability_assessment_results
- fraudCheck_assessment
- noticeboard_updated
- final_decision
- conversation_summary
"""

from datetime import datetime
from typing import Any

import structlog
from motor.motor_asyncio import AsyncIOMotorDatabase

from .sanitize import safe_str, strip_dollar_keys
from ..config import settings

logger = structlog.get_logger()


async def handle_conversation_started(db: AsyncIOMotorDatabase, event: dict[str, Any]) -> None:
    """
    Handle conversation_started event.

    Creates a new conversation record.
    """
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"), "conversation_id"
    )
    customer_id = safe_str(event.get("usr") or event.get("user_id"), "customer_id")
    application_number = event.get("app_number") or event.get("application_number", "")

    # Try to get application_number from payload
    payload = event.get("payload", {})
    if isinstance(payload, dict):
        application_number = application_number or payload.get("application_number", "")

    log = logger.bind(
        conversation_id=conversation_id,
        customer_id=customer_id,
        application_number=application_number,
    )
    log.info("Processing conversation_started")

    # Get customer MongoDB ID if customer exists
    customer_mongo_id = None
    if customer_id:
        customer = await db.customers.find_one({"customerId": customer_id})
        customer_mongo_id = customer.get("_id") if customer else None

    document = {
        "conversationId": conversation_id,
        "customerId": customer_mongo_id,
        "customerIdString": customer_id,
        "applicationNumber": application_number,
        "status": "active",
        "startedAt": event.get("timestamp") or datetime.utcnow(),
        "updatedAt": datetime.utcnow(),
        "utterances": [],
        "assessments": {},
        "noticeboard": [],
        "version": 1,
    }

    result = await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": document,
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )

    log.info(
        "Conversation created",
        matched=result.matched_count,
        upserted_id=str(result.upserted_id) if result.upserted_id else None,
    )


async def handle_utterance(db: AsyncIOMotorDatabase, event: dict[str, Any]) -> None:
    """
    Handle user_input and assistant_response events.

    Appends utterance to conversation.
    """
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"), "conversation_id"
    )
    event_type = event.get("msg_type") or event.get("typ") or event.get("event_type", "")

    log = logger.bind(conversation_id=conversation_id, event_type=event_type)
    log.info("Processing utterance")

    # Determine speaker
    username = "customer" if event_type == "user_input" else "assistant"

    # Get utterance content from payload or event
    payload = event.get("payload", {})
    if isinstance(payload, dict):
        utterance_text = payload.get("utterance", "")
        created_at = payload.get("created_at")
        rationale = payload.get("rationale")
        answer_input_type = payload.get("answer_input_type")
        end_conversation = payload.get("end_conversation", False)
        additional_data = payload.get("additional_data")
    else:
        utterance_text = event.get("utterance", "")
        created_at = event.get("created_at")
        rationale = event.get("rationale")
        answer_input_type = event.get("answer_input_type")
        end_conversation = event.get("end_conversation", False)
        additional_data = event.get("additional_data")

    utterance = {
        "username": username,
        "utterance": utterance_text,
        "rationale": rationale,
        "createdAt": created_at or datetime.utcnow(),
        "answerInputType": answer_input_type,
        "prevSeq": event.get("prev_seq") or event.get("seq"),
        "endConversation": end_conversation,
        "additionalData": additional_data,
    }

    # Ensure conversation exists
    await _ensure_conversation_exists(db, conversation_id, event)

    result = await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$push": {"utterances": {"$each": [utterance], "$slice": -settings.max_utterances}},
            "$set": {
                "updatedAt": datetime.utcnow(),
                "lastUtteranceTime": utterance["createdAt"],
            },
            "$inc": {"version": 1},
        },
    )

    log.info(
        "Utterance added",
        username=username,
        matched=result.matched_count,
        modified=result.modified_count,
    )


async def handle_application_detail_changed(
    db: AsyncIOMotorDatabase, event: dict[str, Any]
) -> None:
    """
    Handle applicationDetail_changed event.

    Updates customer data and application details.
    """
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"), "conversation_id"
    )

    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing applicationDetail_changed")

    # Handle customer data from event.customer
    customer_data = event.get("customer")
    if isinstance(customer_data, dict):
        customer_id = safe_str(
            customer_data.get("customer_id") or event.get("customer_id"), "customer_id"
        )
        if customer_id:
            await _sync_customer(db, customer_id, customer_data)

    # Handle customer data from event.payload.customer
    payload = event.get("payload", {})
    if isinstance(payload, dict) and isinstance(payload.get("customer"), dict):
        customer_data = payload["customer"]
        customer_id = safe_str(
            customer_data.get("customer_id") or customer_data.get("customerId"), "customer_id"
        )
        if customer_id:
            await _sync_customer(db, customer_id, customer_data)

    # Get application number
    application_number = (
        event.get("application_number")
        or event.get("applicationNumber")
        or (payload.get("application_number") if isinstance(payload, dict) else None)
    )

    # Update conversation with application details
    update_doc: dict[str, Any] = {"updatedAt": datetime.utcnow()}

    if application_number:
        update_doc["applicationNumber"] = application_number

    # Store application data (strip $-prefixed keys to prevent operator injection)
    app_data = {k: v for k, v in event.items() if k not in ["typ", "agt", "timestamp", "customer"]}
    if app_data:
        update_doc["applicationData"] = strip_dollar_keys(app_data)

    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {"$set": update_doc, "$inc": {"version": 1}},
    )


async def handle_assessment(db: AsyncIOMotorDatabase, event: dict[str, Any]) -> None:
    """
    Handle assessment events:
    - identityRisk_assessment
    - serviceability_assessment_results
    - fraudCheck_assessment
    """
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"), "conversation_id"
    )
    event_type = event.get("msg_type") or event.get("typ") or event.get("event_type", "")

    log = logger.bind(conversation_id=conversation_id, event_type=event_type)
    log.info("Processing assessment")

    # Map event type to assessment field
    assessment_map = {
        "identityRisk_assessment": "identityRisk",
        "serviceability_assessment_results": "serviceability",
        "fraudCheck_assessment": "fraudCheck",
    }

    assessment_key = assessment_map.get(event_type)
    if not assessment_key:
        log.warning("Unknown assessment type")
        return

    assessment_data = event.get("payload") or event

    result = await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": {
                f"assessments.{assessment_key}": assessment_data,
                "updatedAt": datetime.utcnow(),
            },
            "$inc": {"version": 1},
        },
    )

    log.info(
        "Assessment updated",
        assessment_key=assessment_key,
        matched=result.matched_count,
    )


async def handle_noticeboard_updated(db: AsyncIOMotorDatabase, event: dict[str, Any]) -> None:
    """
    Handle noticeboard_updated event.

    Adds agent notes to noticeboard with version history.
    """
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"), "conversation_id"
    )

    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing noticeboard_updated")

    agent_name = event.get("agentName") or event.get("agent_name") or "unknown"
    content = event.get("content", "")
    timestamp = event.get("timestamp") or datetime.utcnow()

    # Extract topic from agentName (e.g., "serviceability_agent::Serviceability Assessment")
    topic = agent_name.split("::")[-1] if "::" in agent_name else agent_name

    noticeboard_entry = {
        "agentName": agent_name,
        "topic": topic,
        "content": content,
        "timestamp": timestamp,
    }

    # Add to noticeboard array
    result = await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$push": {"noticeboard": {"$each": [noticeboard_entry], "$slice": -settings.max_noticeboard_entries}},
            "$set": {"updatedAt": datetime.utcnow()},
            "$inc": {"version": 1},
        },
    )

    log.info(
        "Noticeboard updated",
        agent_name=agent_name,
        matched=result.matched_count,
    )


async def handle_final_decision(db: AsyncIOMotorDatabase, event: dict[str, Any]) -> None:
    """
    Handle final_decision event.

    Updates conversation status based on decision.
    """
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"), "conversation_id"
    )
    decision = (event.get("decision") or event.get("outcome", "")).upper()

    log = logger.bind(conversation_id=conversation_id, decision=decision)
    log.info("Processing final_decision")

    # Map decision to status
    status_map = {
        "APPROVED": "approved",
        "DECLINED": "declined",
        "REFERRED": "referred",
    }
    status = status_map.get(decision, "hard_end")

    result = await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": {
                "status": status,
                "finalDecision": decision,
                "updatedAt": datetime.utcnow(),
            },
            "$inc": {"version": 1},
        },
    )

    log.info(
        "Final decision recorded",
        status=status,
        matched=result.matched_count,
        modified=result.modified_count,
    )


async def handle_conversation_summary(db: AsyncIOMotorDatabase, event: dict[str, Any]) -> None:
    """
    Handle conversation_summary event.

    Stores purpose and key facts from conversation summary.
    """
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"), "conversation_id"
    )

    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing conversation_summary")

    payload = event.get("payload", {})
    if isinstance(payload, dict):
        purpose = payload.get("purpose", "")
        facts = payload.get("facts", [])
    else:
        purpose = event.get("purpose", "")
        facts = event.get("facts", [])

    result = await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": {
                "purpose": purpose,
                "facts": [{"fact": f} for f in facts] if facts else [],
                "updatedAt": datetime.utcnow(),
            },
            "$inc": {"version": 1},
        },
    )

    log.info(
        "Conversation summary updated",
        purpose=purpose,
        num_facts=len(facts),
        matched=result.matched_count,
    )


# =============================================================================
# Helper Functions
# =============================================================================


async def _ensure_conversation_exists(
    db: AsyncIOMotorDatabase, conversation_id: str, event: dict[str, Any]
) -> None:
    """Ensure conversation document exists before updating."""
    # conversation_id is already validated by caller via safe_str
    existing = await db.conversations.find_one({"conversationId": conversation_id})
    if not existing:
        # Create minimal conversation document
        customer_id = safe_str(event.get("usr") or event.get("user_id"), "customer_id")
        application_number = event.get("app_number") or event.get("application_number", "")

        await db.conversations.insert_one(
            {
                "conversationId": conversation_id,
                "customerIdString": customer_id,
                "applicationNumber": application_number,
                "status": "active",
                "startedAt": datetime.utcnow(),
                "createdAt": datetime.utcnow(),
                "updatedAt": datetime.utcnow(),
                "utterances": [],
                "assessments": {},
                "noticeboard": [],
                "version": 1,
            }
        )


async def _sync_customer(
    db: AsyncIOMotorDatabase, customer_id: str, customer_data: dict[str, Any]
) -> None:
    """Sync customer data to customers collection.

    customer_id is expected to be pre-validated as a string by the caller.
    """
    log = logger.bind(customer_id=customer_id)

    # Build full name
    first_name = customer_data.get("first_name") or customer_data.get("firstName", "")
    last_name = customer_data.get("last_name") or customer_data.get("lastName", "")
    full_name = f"{first_name} {last_name}".strip()
    if not full_name:
        full_name = customer_data.get("full_name") or customer_data.get("name", f"Customer {customer_id}")

    update_doc: dict[str, Any] = {
        "customerId": customer_id,
        "fullName": full_name,
        "updatedAt": datetime.utcnow(),
    }

    # Optional fields
    if first_name:
        update_doc["firstName"] = first_name
    if last_name:
        update_doc["lastName"] = last_name

    preferred_name = customer_data.get("preferred_name") or customer_data.get("preferredName")
    if preferred_name:
        update_doc["preferredName"] = preferred_name

    email = (
        customer_data.get("email")
        or customer_data.get("email_address")
        or customer_data.get("emailAddress")
    )
    if email:
        update_doc["emailAddress"] = email

    phone = (
        customer_data.get("phone")
        or customer_data.get("mobile_phone_number")
        or customer_data.get("mobilePhoneNumber")
    )
    if phone:
        update_doc["mobilePhoneNumber"] = phone

    dob = customer_data.get("date_of_birth") or customer_data.get("dateOfBirth")
    if dob:
        update_doc["dateOfBirth"] = dob

    # Handle residential address
    addr = customer_data.get("residential_address") or customer_data.get("residentialAddress")
    if addr and isinstance(addr, dict):
        # Build street from components
        street_parts = []
        if addr.get("unit_number") or addr.get("unitNumber"):
            street_parts.append(f"Unit {addr.get('unit_number') or addr.get('unitNumber')}")
        if addr.get("street_number") or addr.get("streetNumber"):
            street_parts.append(addr.get("street_number") or addr.get("streetNumber"))
        if addr.get("street_name") or addr.get("streetName"):
            street_parts.append(addr.get("street_name") or addr.get("streetName"))
        if addr.get("street_type") or addr.get("streetType"):
            street_parts.append(addr.get("street_type") or addr.get("streetType"))

        update_doc["residentialAddress"] = {
            "streetNumber": addr.get("street_number") or addr.get("streetNumber") or "",
            "streetName": addr.get("street_name") or addr.get("streetName") or "",
            "streetType": addr.get("street_type") or addr.get("streetType") or "",
            "unitNumber": addr.get("unit_number") or addr.get("unitNumber") or "",
            "street": " ".join(street_parts) if street_parts else addr.get("street", ""),
            "suburb": addr.get("suburb") or "",
            "city": addr.get("city") or addr.get("suburb") or "",
            "state": addr.get("state") or "",
            "postcode": addr.get("postcode") or "",
            "country": addr.get("country") or "Australia",
            "fullAddress": addr.get("full_address") or addr.get("fullAddress") or "",
        }

    await db.customers.update_one(
        {"customerId": customer_id},
        {
            "$set": update_doc,
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )

    log.info("Customer synced from conversation")
