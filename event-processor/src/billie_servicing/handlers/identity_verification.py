"""Identity verification archival handlers (PR #67).

* ``identity_verification.report.archived.v1`` — emitted by identityRiskAgent
  after KYC artifacts (report PDF and/or raw response JSON) land in S3. The S3
  locations are stored on the conversation (joined by ``application_number``)
  and a compact "report available" mirror lands on the canonical customer row.
* ``mirror_lab_verification`` — called from ``handle_assessment`` when an
  ``identityRisk_assessment`` payload carries the optional ``lab_verification``
  block; mirrors the verbatim LAB EVS summary onto the customer row so the
  servicing view reads one row.

``identity_verification.report.archive_failed.v1`` is ledger-only (not routed
to the CRM) — deliberately unhandled. A failed download stays recoverable via
the ``requestId`` captured here.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog

from ..db import coerce_date, upsert, upsert_conversation
from .identity import resolve_canonical_customer_id
from .sanitize import parse_payload, safe_str

logger = structlog.get_logger()


def _artifact(payload: dict[str, Any], key: str) -> dict[str, Any]:
    """Return the ``report`` / ``raw_response`` block — each independently nullable."""
    value = payload.get(key)
    return value if isinstance(value, dict) else {}


async def handle_identity_report_archived(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Handle ``identity_verification.report.archived.v1``."""
    payload = parse_payload(event)
    application_number = safe_str(payload.get("application_number"), "application_number")
    lab_request_id = payload.get("lab_request_id")
    report = _artifact(payload, "report")
    raw_response = _artifact(payload, "raw_response")

    log = logger.bind(
        application_number=application_number,
        lab_request_id=lab_request_id,
    )
    log.info("Processing identity_verification.report.archived.v1")

    # The event joins on application_number (no conversation id in the payload).
    conversation_id = None
    if application_number:
        conversation_id = await pool.fetchval(
            "SELECT conversation_id FROM conversations "
            "WHERE application_number = $1 ORDER BY updated_at DESC LIMIT 1",
            application_number,
        )

    if conversation_id:
        await upsert_conversation(
            pool,
            conversation_id=str(conversation_id),
            set_values={
                "identity_verification_report_lab_request_id": str(lab_request_id)
                if lab_request_id is not None
                else None,
                "identity_verification_report_provider_reference": payload.get(
                    "provider_reference"
                ),
                "identity_verification_report_report_file_location": report.get(
                    "file_location"
                ),
                "identity_verification_report_report_file_name": report.get("file_name"),
                "identity_verification_report_raw_response_file_location": raw_response.get(
                    "file_location"
                ),
                "identity_verification_report_raw_response_file_name": raw_response.get(
                    "file_name"
                ),
                "identity_verification_report_archived_at": coerce_date(
                    payload.get("archived_at")
                ),
            },
        )
    else:
        log.warning("No conversation found for archived identity report")

    # Customer-level mirror: flag the report as available on the canonical row.
    customer_id = safe_str(payload.get("customer_id") or event.get("usr"), "customer_id")
    canonical_id = await resolve_canonical_customer_id(pool, customer_id or None)
    if canonical_id:
        now = datetime.now(UTC)
        await upsert(
            pool,
            "customers",
            conflict_columns=["customer_id"],
            values={
                "customer_id": canonical_id,
                "identity_verification_report_archived": bool(report or raw_response),
                "identity_verification_archived_at": coerce_date(payload.get("archived_at")),
                "identity_verification_lab_request_id": str(lab_request_id)
                if lab_request_id is not None
                else None,
                "identity_verification_provider_reference": payload.get("provider_reference"),
                "updated_at": now,
                "created_at": now,
            },
            insert_only_columns=["created_at"],
        )
    else:
        log.warning("Archived identity report without customer id — no customer mirror")

    log.info("Identity verification report archival recorded")


async def mirror_lab_verification(
    pool: asyncpg.Pool, customer_id: str | None, lab: dict[str, Any]
) -> None:
    """Mirror an ``identityRisk_assessment.lab_verification`` block onto the customer.

    The full verbatim block stays in ``conversations.assessments_identity_risk``
    (stored whole by ``handle_assessment``); this lifts the summary the customer
    details view shows. Field names mirror the LAB EVS API response.
    """
    canonical_id = await resolve_canonical_customer_id(pool, customer_id)
    if not canonical_id:
        logger.warning("lab_verification block without customer id — no customer mirror")
        return

    request_id = lab.get("requestId")
    now = datetime.now(UTC)
    await upsert(
        pool,
        "customers",
        conflict_columns=["customer_id"],
        values={
            "customer_id": canonical_id,
            "identity_verification_overall_result": lab.get("overallResult"),
            "identity_verification_provider": lab.get("provider"),
            "identity_verification_provider_reference": lab.get("providerReference"),
            "identity_verification_lab_request_id": str(request_id)
            if request_id is not None
            else None,
            "identity_verification_checked_at": coerce_date(lab.get("requestDateTime")),
            "updated_at": now,
            "created_at": now,
        },
        insert_only_columns=["created_at"],
    )
    logger.info(
        "Mirrored lab verification onto customer",
        customer_id=canonical_id,
        overall_result=lab.get("overallResult"),
    )
