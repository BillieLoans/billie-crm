"""Conversation event handlers.

Handles all chat/conversation events (ported from worker.ts):
- conversation_started
- user_input
- assistant_response
- applicationDetail_changed
- identityRisk_assessment
- credit_assessment_serviceability_result
- credit_assessment_accountConduct_result
- noticeboard_updated
- final_credit_decision
- conversation_summary
- post_identity_risk_checks_complete
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
    resolved_customer_id: str | None = None
    customer_data = event.get("customer")
    if isinstance(customer_data, dict):
        customer_id = safe_str(
            customer_data.get("customer_id") or event.get("customer_id"), "customer_id"
        )
        if customer_id:
            await _sync_customer(db, customer_id, customer_data)
            resolved_customer_id = customer_id

    # Handle customer data from event.payload.customer
    payload = event.get("payload", {})
    if isinstance(payload, dict) and isinstance(payload.get("customer"), dict):
        customer_data = payload["customer"]
        customer_id = safe_str(
            customer_data.get("customer_id") or customer_data.get("customerId"), "customer_id"
        )
        if customer_id:
            await _sync_customer(db, customer_id, customer_data)
            resolved_customer_id = resolved_customer_id or customer_id

    # Get application number (supports both snake_case and camelCase, event or payload)
    application_number = (
        event.get("application_number")
        or event.get("applicationNumber")
        or (payload.get("application_number") if isinstance(payload, dict) else None)
        or (payload.get("applicationNumber") if isinstance(payload, dict) else None)
    )

    # Update conversation with application details
    update_doc: dict[str, Any] = {"updatedAt": datetime.utcnow()}

    # Denormalize customerIdString so list queries can join to customers collection
    if resolved_customer_id:
        update_doc["customerIdString"] = resolved_customer_id

    if application_number:
        update_doc["applicationNumber"] = application_number

    # Merge payload fields into applicationData using dot-notation $set so later
    # events with smaller payloads don't wipe previously stored loan fields.
    source = strip_dollar_keys(payload) if isinstance(payload, dict) and payload else {
        k: v for k, v in event.items() if k not in ["typ", "agt", "timestamp", "customer", "payload"]
    }
    for key, value in source.items():
        if value is not None:
            update_doc[f"applicationData.{key}"] = value

    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {"$set": update_doc, "$inc": {"version": 1}},
    )

    # Upsert into applications collection if we have an application number
    if application_number:
        await _upsert_application(db, application_number, resolved_customer_id, payload if isinstance(payload, dict) else {})


async def _upsert_application(
    db: AsyncIOMotorDatabase,
    application_number: str,
    customer_id_string: str | None,
    payload: dict[str, Any],
) -> None:
    """Upsert application document into the applications collection."""
    app_doc: dict[str, Any] = {"updatedAt": datetime.utcnow()}

    # Resolve customer MongoDB _id for the relationship field
    if customer_id_string:
        customer = await db.customers.find_one(
            {"customerId": customer_id_string}, {"_id": 1}
        )
        if customer:
            app_doc["customerId"] = customer["_id"]

    # Extract loan details (camelCase from applicationDetail_changed payload)
    if payload.get("loanAmount") is not None:
        app_doc["loanAmount"] = payload["loanAmount"]
    if payload.get("loanPurpose"):
        app_doc["loanPurpose"] = payload["loanPurpose"]
    if payload.get("loanTerm") is not None:
        app_doc["loanTerm"] = payload["loanTerm"]
    if payload.get("customerAttestationAcceptance") is not None:
        app_doc["customerAttestationAcceptance"] = bool(payload["customerAttestationAcceptance"])
    if payload.get("statementCaptureConsentProvided") is not None:
        app_doc["statementCaptureConsentProvided"] = bool(payload["statementCaptureConsentProvided"])
    if payload.get("productOfferAcceptance") is not None:
        app_doc["productOfferAcceptance"] = bool(payload["productOfferAcceptance"])

    await db.applications.update_one(
        {"applicationNumber": application_number},
        {
            "$set": app_doc,
            "$setOnInsert": {
                "applicationNumber": application_number,
                "createdAt": datetime.utcnow(),
                "version": 1,
            },
        },
        upsert=True,
    )

    logger.bind(application_number=application_number).info("Application upserted")


async def handle_assessment(db: AsyncIOMotorDatabase, event: dict[str, Any]) -> None:
    """
    Handle assessment events:
    - identityRisk_assessment
    - credit_assessment_serviceability_result
    - credit_assessment_accountConduct_result
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
        "credit_assessment_serviceability_result": "serviceability",
        "credit_assessment_accountConduct_result": "accountConduct",
    }

    assessment_key = assessment_map.get(event_type)
    if not assessment_key:
        log.warning("Unknown assessment type")
        return

    payload = event.get("payload", {})
    raw_data = payload if isinstance(payload, dict) else event
    assessment_data = strip_dollar_keys(raw_data)

    # Map file_location → s3Key so S3 proxy routes can find it
    if "file_location" in assessment_data and "s3Key" not in assessment_data:
        assessment_data["s3Key"] = assessment_data["file_location"]

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

    payload = event.get("payload", {})
    payload_dict = payload if isinstance(payload, dict) else {}

    agent_name = (
        event.get("agentName") or event.get("agent_name")
        or payload_dict.get("agentName") or payload_dict.get("agent_name")
        or "unknown"
    )
    content = event.get("content") or payload_dict.get("content") or ""
    timestamp = event.get("timestamp") or payload_dict.get("timestamp") or datetime.utcnow()

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
    payload = event.get("payload", {})
    payload_dict = payload if isinstance(payload, dict) else {}
    decision = (
        event.get("decision")
        or event.get("outcome")
        or payload_dict.get("decision")
        or payload_dict.get("outcome")
        or ""
    ).upper()

    log = logger.bind(conversation_id=conversation_id, decision=decision)
    log.info("Processing final_decision")

    # Map decision to status
    status_map = {
        "APPROVED": "approved",
        "DECLINED": "declined",
        "REFERRED": "referred",
    }
    status = status_map.get(decision, "hard_end")

    # Map decision to decisionStatus for monitoring view filtering
    decision_status_map = {
        "APPROVED": "approved",
        "DECLINED": "declined",
        "REFERRED": "referred",
    }
    decision_status = decision_status_map.get(decision, "no_decision")

    result = await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": {
                "status": status,
                "finalDecision": decision,
                "decisionStatus": decision_status,
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


async def handle_conversation_summary_changed(
    db: AsyncIOMotorDatabase, event: dict[str, Any]
) -> None:
    """
    Handle conversationSummary_changed event.

    Fired by the conversation engine when any summary-level fields change
    (applicationNumber, status, customerIdString, etc.). Acts as an upsert
    so it can also serve as the conversation initialisation event when
    conversation_started is not received first.
    """
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"), "conversation_id"
    )

    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing conversationSummary_changed")

    payload = event.get("payload", {})
    if not isinstance(payload, dict):
        payload = {}

    update_doc: dict[str, Any] = {"updatedAt": datetime.utcnow()}

    # Sync applicationNumber (snake_case or camelCase from either level)
    app_number = (
        event.get("application_number")
        or event.get("applicationNumber")
        or payload.get("application_number")
        or payload.get("applicationNumber")
    )
    if app_number:
        update_doc["applicationNumber"] = app_number

    # Sync status if explicitly provided
    status = event.get("status") or payload.get("status")
    if status:
        update_doc["status"] = status

    # Sync customerIdString if provided
    customer_id = safe_str(
        event.get("usr") or event.get("user_id") or event.get("customer_id")
        or payload.get("usr") or payload.get("user_id") or payload.get("customer_id"),
        "customer_id",
    )
    if customer_id:
        update_doc["customerIdString"] = customer_id

    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": update_doc,
            "$setOnInsert": {
                "conversationId": conversation_id,
                "status": "active",
                "createdAt": datetime.utcnow(),
                "utterances": [],
                "assessments": {},
                "noticeboard": [],
                "version": 1,
            },
        },
        upsert=True,
    )

    log.info(
        "conversationSummary_changed processed",
        app_number=app_number,
        status=status,
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
# Credit Assessment & Post-Identity Handlers
# =============================================================================


async def handle_post_identity_risk_check(
    db: AsyncIOMotorDatabase, event: dict[str, Any]
) -> None:
    """Handle post_identity_risk_check event."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing post_identity_risk_check")

    payload = event.get("payload", {})
    risk_data = strip_dollar_keys(payload if isinstance(payload, dict) else event)

    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": {
                "assessments.postIdentityRisk": risk_data,
                "updatedAt": datetime.utcnow(),
            },
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )
    log.info("post_identity_risk_check processed")


async def handle_credit_assessment_complete(
    db: AsyncIOMotorDatabase, event: dict[str, Any]
) -> None:
    """Handle credit_assessment_complete event."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing credit_assessment_complete")

    payload = event.get("payload", {})
    assessment_data = strip_dollar_keys(payload if isinstance(payload, dict) else event)

    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": {
                "assessments.creditAssessmentComplete": assessment_data,
                "updatedAt": datetime.utcnow(),
            },
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )
    log.info("credit_assessment_complete processed")


# =============================================================================
# Statement Capture Flow Handlers
# =============================================================================


async def handle_statement_consent_initiated(
    db: AsyncIOMotorDatabase, event: dict[str, Any]
) -> None:
    """Handle statement_consent_initiated event."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing statement_consent_initiated")

    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": {
                "statementCapture.consentStatus": "initiated",
                "updatedAt": datetime.utcnow(),
            },
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )
    log.info("statement_consent_initiated processed")


async def handle_statement_consent_complete(
    db: AsyncIOMotorDatabase, event: dict[str, Any]
) -> None:
    """Handle statement_consent_complete event."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing statement_consent_complete")

    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": {
                "statementCapture.consentStatus": "complete",
                "updatedAt": datetime.utcnow(),
            },
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )
    log.info("statement_consent_complete processed")


async def handle_statement_consent_cancelled(
    db: AsyncIOMotorDatabase, event: dict[str, Any]
) -> None:
    """Handle statement_consent_cancelled event."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing statement_consent_cancelled")

    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": {
                "statementCapture.consentStatus": "cancelled",
                "updatedAt": datetime.utcnow(),
            },
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )
    log.info("statement_consent_cancelled processed")


async def handle_basiq_job_created(db: AsyncIOMotorDatabase, event: dict[str, Any]) -> None:
    """Handle basiq_job_created event."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing basiq_job_created")

    payload = event.get("payload", {})
    basiq_job_id = safe_str(
        (payload.get("jobId") if isinstance(payload, dict) else None)
        or event.get("jobId")
        or event.get("job_id"),
        "basiq_job_id",
    )

    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": {
                "statementCapture.basiqJobId": basiq_job_id,
                "updatedAt": datetime.utcnow(),
            },
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )
    log.info("basiq_job_created processed")


async def handle_statement_retrieval_complete(
    db: AsyncIOMotorDatabase, event: dict[str, Any]
) -> None:
    """Handle statement_retrieval_complete event."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing statement_retrieval_complete")

    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": {
                "statementCapture.retrievalComplete": True,
                "updatedAt": datetime.utcnow(),
            },
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )
    log.info("statement_retrieval_complete processed")


async def handle_affordability_report_complete(
    db: AsyncIOMotorDatabase, event: dict[str, Any]
) -> None:
    """Handle affordability_report_complete event."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing affordability_report_complete")

    payload = event.get("payload", {})
    report = strip_dollar_keys(payload if isinstance(payload, dict) else event)

    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": {
                "statementCapture.affordabilityReport": report,
                "updatedAt": datetime.utcnow(),
            },
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )
    log.info("affordability_report_complete processed")


async def handle_statement_checks_complete(
    db: AsyncIOMotorDatabase, event: dict[str, Any]
) -> None:
    """Handle statement_checks_complete event."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing statement_checks_complete")

    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": {
                "statementCapture.checksComplete": True,
                "updatedAt": datetime.utcnow(),
            },
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )
    log.info("statement_checks_complete processed")


# =============================================================================
# Helper Functions
# =============================================================================


async def _ensure_conversation_exists(
    db: AsyncIOMotorDatabase, conversation_id: str, event: dict[str, Any]
) -> None:
    """Ensure conversation document exists before updating (atomic upsert)."""
    customer_id = safe_str(event.get("usr") or event.get("user_id"), "customer_id")
    application_number = event.get("app_number") or event.get("application_number", "")

    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$setOnInsert": {
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
            },
        },
        upsert=True,
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
