"""Conversation event handlers.

Handles all chat/conversation events (ported from worker.ts):
- conversation_started
- user_input / assistant_response
- applicationDetail_changed
- identityRisk_assessment / credit_assessment_serviceability_result / credit_assessment_accountConduct_result
- noticeboard_post / noticeboard_updated
- final_credit_decision
- conversation_summary / conversationSummary_changed
- post_identity_risk_checks_complete
- credit_assessment_complete
- statement_consent_* / basiq_job_created / statement_retrieval_complete / affordability_report_complete / statement_checks_complete
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg
import structlog

from ..config import settings
from ..db import merge_jsonb, upsert, upsert_conversation
from .sanitize import safe_str, strip_dollar_keys

logger = structlog.get_logger()


# Mapping from event-typed assessment_key to flattened jsonb column on conversations.
_ASSESSMENT_COLUMNS = {
    "identityRisk": "assessments_identity_risk",
    "serviceability": "assessments_serviceability",
    "accountConduct": "assessments_account_conduct",
    "postIdentityRisk": "assessments_post_identity_risk",
    "creditAssessmentComplete": "assessments_credit_assessment_complete",
}


async def _resolve_customer_link(pool_or_conn: Any, customer_id: str | None) -> Any | None:
    if not customer_id:
        return None
    return await pool_or_conn.fetchval(
        "SELECT id FROM customers WHERE customer_id = $1", customer_id
    )


async def _get_conversation_parent_id(target: Any, conversation_id: str) -> Any | None:
    return await target.fetchval(
        "SELECT id FROM conversations WHERE conversation_id = $1", conversation_id
    )


def _now() -> datetime:
    return datetime.now(timezone.utc)


# =============================================================================
# Conversation lifecycle
# =============================================================================


async def handle_conversation_started(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Initialise a conversation projection row."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    customer_id = safe_str(event.get("usr") or event.get("user_id"), "customer_id")
    application_number = event.get("app_number") or event.get("application_number", "")

    payload = event.get("payload", {})
    if isinstance(payload, dict):
        application_number = application_number or payload.get("application_number", "")

    log = logger.bind(
        conversation_id=conversation_id,
        customer_id=customer_id,
        application_number=application_number,
    )
    log.info("Processing conversation_started")

    customer_ref_id = await _resolve_customer_link(pool, customer_id)
    started_at = event.get("timestamp") or _now()
    if isinstance(started_at, str):
        try:
            started_at = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        except ValueError:
            started_at = _now()

    await upsert_conversation(
        pool,
        conversation_id=conversation_id,
        set_values={
            "customer_id_id": customer_ref_id,
            "customer_id_string": customer_id or None,
            "application_number": application_number or "",
            "status": "active",
        },
        insert_only_values={"started_at": started_at},
    )

    log.info("Conversation created")


async def handle_conversation_summary_changed(
    pool: asyncpg.Pool, event: dict[str, Any]
) -> None:
    """Project conversationSummary_changed — acts as init when conversation_started missed."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing conversationSummary_changed")

    payload = event.get("payload", {})
    if not isinstance(payload, dict):
        payload = {}

    app_number = (
        event.get("application_number")
        or event.get("applicationNumber")
        or payload.get("application_number")
        or payload.get("applicationNumber")
    )
    status = event.get("status") or payload.get("status")
    customer_id = safe_str(
        event.get("usr") or event.get("user_id") or event.get("customer_id")
        or payload.get("usr") or payload.get("user_id") or payload.get("customer_id"),
        "customer_id",
    )

    set_values: dict[str, Any] = {}
    if app_number:
        set_values["application_number"] = app_number
    if status:
        set_values["status"] = status
    if customer_id:
        set_values["customer_id_string"] = customer_id
        ref = await _resolve_customer_link(pool, customer_id)
        if ref:
            set_values["customer_id_id"] = ref

    if not set_values:
        log.info("conversationSummary_changed produced no updates")
        return

    await upsert_conversation(
        pool, conversation_id=conversation_id, set_values=set_values
    )
    log.info("conversationSummary_changed processed", app_number=app_number, status=status)


# =============================================================================
# Utterances (child table)
# =============================================================================


async def _ensure_conversation_exists(
    target: Any, conversation_id: str, event: dict[str, Any]
) -> Any | None:
    """Make sure a conversations row exists; return its uuid id."""
    customer_id = safe_str(event.get("usr") or event.get("user_id"), "customer_id")
    application_number = event.get("app_number") or event.get("application_number", "")

    await target.execute(
        """
        INSERT INTO conversations
          (conversation_id, customer_id_string, application_number, status,
           started_at, updated_at, created_at, version)
        VALUES ($1, $2, $3, 'active', NOW(), NOW(), NOW(), 1)
        ON CONFLICT (conversation_id) DO NOTHING
        """,
        conversation_id,
        customer_id or None,
        application_number or "",
    )
    return await _get_conversation_parent_id(target, conversation_id)


async def handle_utterance(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Append an utterance row to conversations_utterances and bump version."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    event_type = event.get("msg_type") or event.get("typ") or event.get("event_type", "")
    log = logger.bind(conversation_id=conversation_id, event_type=event_type)
    log.info("Processing utterance")

    username = "customer" if event_type == "user_input" else "assistant"

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

    if isinstance(created_at, str):
        try:
            created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        except ValueError:
            created_at = _now()
    if not created_at:
        created_at = _now()

    prev_seq = event.get("prev_seq") or event.get("seq")

    async with pool.acquire() as conn:
        async with conn.transaction():
            parent_id = await _ensure_conversation_exists(conn, conversation_id, event)
            if parent_id is None:
                log.warning("Conversation parent id missing after ensure")
                return

            # Cap utterances per conversation (oldest evicted) — matches the
            # $slice: -max_utterances behaviour from the Mongo version.
            await conn.execute(
                """
                WITH evicted AS (
                  SELECT id FROM conversations_utterances
                  WHERE _parent_id = $1
                  ORDER BY _order ASC
                  OFFSET $2
                )
                DELETE FROM conversations_utterances WHERE id IN (SELECT id FROM evicted)
                """,
                parent_id,
                settings.max_utterances - 1,
            )

            next_order = (
                await conn.fetchval(
                    "SELECT COALESCE(MAX(_order), -1) + 1 FROM conversations_utterances "
                    "WHERE _parent_id = $1",
                    parent_id,
                )
                or 0
            )

            await conn.execute(
                """
                INSERT INTO conversations_utterances
                  (id, _order, _parent_id, username, utterance, rationale,
                   created_at, answer_input_type, prev_seq, end_conversation, additional_data)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
                """,
                str(uuid.uuid4()),
                next_order,
                parent_id,
                username,
                utterance_text,
                rationale,
                created_at,
                answer_input_type,
                prev_seq,
                bool(end_conversation),
                json.dumps(additional_data) if additional_data is not None else None,
            )

            await conn.execute(
                """
                UPDATE conversations SET
                  last_utterance_time = $1,
                  updated_at = NOW(),
                  version = COALESCE(version, 1) + 1
                WHERE id = $2
                """,
                created_at,
                parent_id,
            )

    log.info("Utterance added", username=username)


# =============================================================================
# Application detail changed (touches conversations + applications + customers)
# =============================================================================


async def handle_application_detail_changed(
    pool: asyncpg.Pool, event: dict[str, Any]
) -> None:
    """Project applicationDetail_changed onto conversations + applications."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing applicationDetail_changed")

    payload = event.get("payload", {})
    payload_dict = payload if isinstance(payload, dict) else {}

    # Resolve a customer_id from event.customer or payload.customer
    resolved_customer_id: str | None = None
    customer_data = event.get("customer")
    if isinstance(customer_data, dict):
        cid = safe_str(
            customer_data.get("customer_id") or event.get("customer_id"), "customer_id"
        )
        if cid:
            await _sync_customer(pool, cid, customer_data)
            resolved_customer_id = cid
    if isinstance(payload_dict.get("customer"), dict):
        cd = payload_dict["customer"]
        cid = safe_str(cd.get("customer_id") or cd.get("customerId"), "customer_id")
        if cid:
            await _sync_customer(pool, cid, cd)
            resolved_customer_id = resolved_customer_id or cid

    application_number = (
        event.get("application_number")
        or event.get("applicationNumber")
        or payload_dict.get("application_number")
        or payload_dict.get("applicationNumber")
    )

    # Build conversation update
    set_values: dict[str, Any] = {}
    if resolved_customer_id:
        set_values["customer_id_string"] = resolved_customer_id
        ref = await _resolve_customer_link(pool, resolved_customer_id)
        if ref:
            set_values["customer_id_id"] = ref
    if application_number:
        set_values["application_number"] = application_number

    # Merge ALL leftover application data into application_data jsonb
    source = (
        strip_dollar_keys(payload_dict)
        if payload_dict
        else {
            k: v
            for k, v in event.items()
            if k not in {"typ", "agt", "timestamp", "customer", "payload"}
        }
    )
    app_patch = {k: v for k, v in source.items() if v is not None}

    async with pool.acquire() as conn:
        async with conn.transaction():
            if set_values:
                await upsert_conversation(
                    conn, conversation_id=conversation_id, set_values=set_values
                )
            else:
                # Still need to ensure the row exists for the merge.
                await _ensure_conversation_exists(conn, conversation_id, event)

            if app_patch:
                await merge_jsonb(
                    conn,
                    "conversations",
                    column="application_data",
                    key_column="conversation_id",
                    key_value=conversation_id,
                    patch=app_patch,
                    bump_version=True,
                )

            if application_number:
                await _upsert_application(
                    conn, application_number, resolved_customer_id, payload_dict
                )


async def _upsert_application(
    target: Any,
    application_number: str,
    customer_id_string: str | None,
    payload: dict[str, Any],
) -> None:
    """Upsert into applications. customer_id_id is nullable so we can land
    the row even if the customer projection hasn't arrived yet."""
    customer_ref_id = await _resolve_customer_link(target, customer_id_string)
    now = _now()

    values: dict[str, Any] = {
        "application_number": application_number,
        "updated_at": now,
        "created_at": now,
        "version": 1,
    }
    if customer_ref_id:
        values["customer_id_id"] = customer_ref_id

    field_map = [
        ("loanAmount", "loan_amount", lambda v: float(v) if v is not None else None),
        ("loanPurpose", "loan_purpose", lambda v: v),
        ("loanTerm", "loan_term", lambda v: int(v) if v is not None else None),
        ("customerAttestationAcceptance", "customer_attestation_acceptance", bool),
        ("statementCaptureConsentProvided", "statement_capture_consent_provided", bool),
        ("productOfferAcceptance", "product_offer_acceptance", bool),
    ]
    for sdk_key, column, coerce in field_map:
        if payload.get(sdk_key) is not None:
            values[column] = coerce(payload[sdk_key])

    await upsert(
        target,
        "applications",
        conflict_columns=["application_number"],
        values=values,
        insert_only_columns=["created_at", "version"],
    )

    logger.bind(application_number=application_number).info("Application upserted")


async def _sync_customer(target: Any, customer_id: str, customer_data: dict[str, Any]) -> None:
    """Sync customer data to customers table from a chat event payload.

    Mirrors the original behaviour of stamping basic customer fields when a
    chat event drops customer info — even partial data is enough to render
    a name in the CRM until the proper customer.changed.v1 event arrives.
    """
    log = logger.bind(customer_id=customer_id)

    first_name = customer_data.get("first_name") or customer_data.get("firstName", "")
    last_name = customer_data.get("last_name") or customer_data.get("lastName", "")
    full_name = f"{first_name} {last_name}".strip()
    if not full_name:
        full_name = (
            customer_data.get("full_name")
            or customer_data.get("name")
            or f"Customer {customer_id}"
        )

    now = _now()
    values: dict[str, Any] = {
        "customer_id": customer_id,
        "full_name": full_name,
        "updated_at": now,
        "created_at": now,
    }
    if first_name:
        values["first_name"] = first_name
    if last_name:
        values["last_name"] = last_name
    preferred = customer_data.get("preferred_name") or customer_data.get("preferredName")
    if preferred:
        values["preferred_name"] = preferred

    email = (
        customer_data.get("email")
        or customer_data.get("email_address")
        or customer_data.get("emailAddress")
    )
    if email:
        values["email_address"] = email
    phone = (
        customer_data.get("phone")
        or customer_data.get("mobile_phone_number")
        or customer_data.get("mobilePhoneNumber")
    )
    if phone:
        values["mobile_phone_number"] = phone
    dob = customer_data.get("date_of_birth") or customer_data.get("dateOfBirth")
    if dob:
        values["date_of_birth"] = dob

    addr = customer_data.get("residential_address") or customer_data.get("residentialAddress")
    if isinstance(addr, dict):
        suburb = addr.get("suburb") or addr.get("city")
        values.update(
            {
                "residential_address_street_number": addr.get("street_number")
                or addr.get("streetNumber"),
                "residential_address_street_name": addr.get("street_name")
                or addr.get("streetName"),
                "residential_address_street_type": addr.get("street_type")
                or addr.get("streetType"),
                "residential_address_unit_number": addr.get("unit_number")
                or addr.get("unitNumber"),
                "residential_address_suburb": suburb,
                "residential_address_city": suburb,
                "residential_address_state": addr.get("state"),
                "residential_address_postcode": addr.get("postcode"),
                "residential_address_country": addr.get("country") or "Australia",
                "residential_address_full_address": addr.get("full_address")
                or addr.get("fullAddress"),
            }
        )

    await upsert(
        target,
        "customers",
        conflict_columns=["customer_id"],
        values=values,
        insert_only_columns=["created_at"],
    )
    log.info("Customer synced from conversation")


# =============================================================================
# Assessments (flattened to per-column jsonb)
# =============================================================================


async def _set_assessment(
    pool: asyncpg.Pool, conversation_id: str, column: str, data: dict[str, Any]
) -> None:
    payload_json = json.dumps(data)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _ensure_conversation_exists(conn, conversation_id, {})
            await conn.execute(
                f"UPDATE conversations SET {column} = $1::jsonb, updated_at = NOW(), "
                "version = COALESCE(version, 1) + 1 WHERE conversation_id = $2",
                payload_json,
                conversation_id,
            )


async def handle_assessment(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Handle identityRisk_assessment / credit_assessment_serviceability_result /
    credit_assessment_accountConduct_result.
    """
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    event_type = event.get("msg_type") or event.get("typ") or event.get("event_type", "")
    log = logger.bind(conversation_id=conversation_id, event_type=event_type)
    log.info("Processing assessment")

    assessment_map = {
        "identityRisk_assessment": "identityRisk",
        "credit_assessment_serviceability_result": "serviceability",
        "credit_assessment_accountConduct_result": "accountConduct",
    }
    key = assessment_map.get(event_type)
    if not key:
        log.warning("Unknown assessment type")
        return
    column = _ASSESSMENT_COLUMNS[key]

    payload = event.get("payload", {})
    raw = payload if isinstance(payload, dict) else event
    data = strip_dollar_keys(raw)
    if "file_location" in data and "s3Key" not in data:
        data["s3Key"] = data["file_location"]

    await _set_assessment(pool, conversation_id, column, data)
    log.info("Assessment updated", assessment_key=key)


async def handle_post_identity_risk_check(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing post_identity_risk_check")
    payload = event.get("payload", {})
    data = strip_dollar_keys(payload if isinstance(payload, dict) else event)
    await _set_assessment(pool, conversation_id, _ASSESSMENT_COLUMNS["postIdentityRisk"], data)
    log.info("post_identity_risk_check processed")


async def handle_credit_assessment_complete(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing credit_assessment_complete")
    payload = event.get("payload", {})
    data = strip_dollar_keys(payload if isinstance(payload, dict) else event)
    await _set_assessment(
        pool, conversation_id, _ASSESSMENT_COLUMNS["creditAssessmentComplete"], data
    )
    log.info("credit_assessment_complete processed")


# =============================================================================
# Noticeboard (child table append)
# =============================================================================


async def handle_noticeboard_updated(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing noticeboard_updated")

    payload = event.get("payload", {})
    payload_dict = payload if isinstance(payload, dict) else {}

    agent_name = payload_dict.get("agent_name") or "unknown"
    content = payload_dict.get("post") or ""
    timestamp = payload_dict.get("timestamp") or _now()
    if isinstance(timestamp, str):
        try:
            timestamp = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError:
            timestamp = _now()
    topic = agent_name.split("::")[-1] if "::" in agent_name else agent_name

    async with pool.acquire() as conn:
        async with conn.transaction():
            parent_id = await _ensure_conversation_exists(conn, conversation_id, event)
            if parent_id is None:
                return

            # Cap noticeboard entries — match Mongo $slice semantics.
            await conn.execute(
                """
                WITH evicted AS (
                  SELECT id FROM conversations_noticeboard
                  WHERE _parent_id = $1
                  ORDER BY _order ASC
                  OFFSET $2
                )
                DELETE FROM conversations_noticeboard WHERE id IN (SELECT id FROM evicted)
                """,
                parent_id,
                settings.max_noticeboard_entries - 1,
            )

            next_order = (
                await conn.fetchval(
                    "SELECT COALESCE(MAX(_order), -1) + 1 FROM conversations_noticeboard "
                    "WHERE _parent_id = $1",
                    parent_id,
                )
                or 0
            )
            await conn.execute(
                "INSERT INTO conversations_noticeboard (id, _order, _parent_id, agent_name, topic, content, timestamp) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7)",
                str(uuid.uuid4()),
                next_order,
                parent_id,
                agent_name,
                topic,
                content,
                timestamp,
            )

            await conn.execute(
                "UPDATE conversations SET updated_at = NOW(), version = COALESCE(version, 1) + 1 WHERE id = $1",
                parent_id,
            )

    log.info("Noticeboard updated", agent_name=agent_name)


# =============================================================================
# Final decision
# =============================================================================


async def handle_final_decision(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
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

    status_map = {"APPROVED": "approved", "DECLINED": "declined", "REFERRED": "referred"}
    status = status_map.get(decision, "hard_end")
    decision_status = status_map.get(decision, "no_decision")

    await upsert_conversation(
        pool,
        conversation_id=conversation_id,
        set_values={
            "status": status,
            "final_decision": decision,
            "decision_status": decision_status,
        },
    )
    log.info("Final decision recorded", status=status)


# =============================================================================
# Conversation summary
# =============================================================================


async def handle_conversation_summary(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing conversation_summary")

    payload = event.get("payload", {})
    if isinstance(payload, dict):
        purpose = payload.get("purpose", "")
        facts = payload.get("facts", []) or []
    else:
        purpose = event.get("purpose", "")
        facts = event.get("facts", []) or []

    async with pool.acquire() as conn:
        async with conn.transaction():
            await upsert_conversation(
                conn, conversation_id=conversation_id, set_values={"purpose": purpose}
            )
            parent_id = await _get_conversation_parent_id(conn, conversation_id)
            if parent_id is None:
                return
            # Replace the facts list wholesale (matches Mongo $set semantics).
            await conn.execute(
                "DELETE FROM conversations_facts WHERE _parent_id = $1", parent_id
            )
            for i, fact in enumerate(facts):
                await conn.execute(
                    "INSERT INTO conversations_facts (id, _order, _parent_id, fact) "
                    "VALUES ($1, $2, $3, $4)",
                    str(uuid.uuid4()),
                    i,
                    parent_id,
                    fact,
                )

    log.info("Conversation summary updated", purpose=purpose, num_facts=len(facts))


# =============================================================================
# Statement-capture handlers (all merge a single key into statement_capture jsonb)
# =============================================================================


async def _set_statement_capture(
    pool: asyncpg.Pool, conversation_id: str, patch: dict[str, Any]
) -> None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _ensure_conversation_exists(conn, conversation_id, {})
            await merge_jsonb(
                conn,
                "conversations",
                column="statement_capture",
                key_column="conversation_id",
                key_value=conversation_id,
                patch=patch,
            )


async def handle_statement_consent_initiated(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    logger.bind(conversation_id=conversation_id).info("Processing statement_consent_initiated")
    await _set_statement_capture(pool, conversation_id, {"consentStatus": "initiated"})


async def handle_statement_consent_complete(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    logger.bind(conversation_id=conversation_id).info("Processing statement_consent_complete")
    await _set_statement_capture(pool, conversation_id, {"consentStatus": "complete"})


async def handle_statement_consent_cancelled(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    logger.bind(conversation_id=conversation_id).info("Processing statement_consent_cancelled")
    await _set_statement_capture(pool, conversation_id, {"consentStatus": "cancelled"})


async def handle_basiq_job_created(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    payload = event.get("payload", {})
    basiq_job_id = safe_str(
        (payload.get("jobId") if isinstance(payload, dict) else None)
        or event.get("jobId")
        or event.get("job_id"),
        "basiq_job_id",
    )
    logger.bind(conversation_id=conversation_id, basiq_job_id=basiq_job_id).info(
        "Processing basiq_job_created"
    )
    await _set_statement_capture(pool, conversation_id, {"basiqJobId": basiq_job_id})


async def handle_statement_retrieval_complete(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    logger.bind(conversation_id=conversation_id).info("Processing statement_retrieval_complete")
    await _set_statement_capture(pool, conversation_id, {"retrievalComplete": True})


async def handle_affordability_report_complete(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    payload = event.get("payload", {})
    report = strip_dollar_keys(payload if isinstance(payload, dict) else event)
    logger.bind(conversation_id=conversation_id).info("Processing affordability_report_complete")
    await _set_statement_capture(pool, conversation_id, {"affordabilityReport": report})


async def handle_statement_checks_complete(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    logger.bind(conversation_id=conversation_id).info("Processing statement_checks_complete")
    await _set_statement_capture(pool, conversation_id, {"checksComplete": True})
