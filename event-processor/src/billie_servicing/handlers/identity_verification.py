"""Identity verification archival handlers (PR #67, LAB API v1 2026-09).

* ``identity_verification.attempt.v1`` (spec 2026-09-15) — one per LAB verify
  call, including a first attempt that led to the one-document step-up. Merged
  per attempt key into ``conversations.identity_verification_attempts`` (a
  jsonb object keyed by LAB request id, or ``attempt-<n>`` without one).
* ``identity_verification.report.archived.v1`` — emitted by identityRiskAgent
  after KYC artifacts (per-check report PDFs and/or raw response JSON) land in
  S3. The S3 locations are stored on the conversation (joined by
  ``application_number``) and a compact "report available" mirror lands on the
  canonical customer row.
* ``mirror_lab_verification`` — called from ``handle_assessment`` when an
  ``identityRisk_assessment`` payload carries the optional ``lab_verification``
  block; mirrors a summary onto the customer row so the servicing view reads
  one row. Two block shapes are accepted (old events replay from the ledger):
  the legacy EVS block (``requestId`` / ``overallResult`` / ``pepResult``) and
  the LAB Identity Verification API v1 ``Verification`` envelope (``id`` /
  ``verificationNumber`` / ``result.checks[]``). The full verbatim block stays
  in ``conversations.assessments_identity_risk``.

``identity_verification.report.archive_failed.v1`` is ledger-only (not routed
to the CRM) — deliberately unhandled. A failed download stays recoverable via
the ``requestId`` captured here.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog

from ..db import coerce_date, merge_jsonb_entry, upsert, upsert_conversation
from .identity import resolve_canonical_customer_id
from .sanitize import parse_payload, safe_str

logger = structlog.get_logger()


def _artifact(payload: dict[str, Any], key: str) -> dict[str, Any]:
    """Return the ``report`` / ``raw_response`` block — each independently nullable."""
    value = payload.get(key)
    return value if isinstance(value, dict) else {}


ATTEMPT_FIELDS = (
    "attempt_number",
    "step_up",
    "step_up_requested",
    "document_types",
    "decision",
    "identity_verification_failed",
    "screening_hit",
    "pep_result",
    "sanctions_result",
    "lab_verification",
    "lab_request_id",
    "checked_at",
)

ATTEMPTS_COLUMN = "identity_verification_attempts"

# Monotonic guard for the conversation-level "latest report" columns: attempt
# 1's artifacts are archived too now, and the two prod machines may deliver
# the archived events out of order — an older archive must never overwrite
# the pointers of a newer one.
REPORT_ARCHIVED_AT_GUARD = (
    "EXCLUDED.identity_verification_report_archived_at IS NULL "
    "OR conversations.identity_verification_report_archived_at IS NULL "
    "OR EXCLUDED.identity_verification_report_archived_at "
    ">= conversations.identity_verification_report_archived_at"
)
CUSTOMER_ARCHIVED_AT_GUARD = (
    "EXCLUDED.identity_verification_archived_at IS NULL "
    "OR customers.identity_verification_archived_at IS NULL "
    "OR EXCLUDED.identity_verification_archived_at "
    ">= customers.identity_verification_archived_at"
)


def attempt_key(lab_request_id: str | int | None, attempt_number: int | str | None) -> str:
    """Attempt entry key: the LAB request id, else ``attempt-<n>`` (mock mode)."""
    if lab_request_id not in (None, ""):
        return str(lab_request_id)
    return f"attempt-{attempt_number}"


async def handle_identity_attempt(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Handle ``identity_verification.attempt.v1`` (spec 2026-09-15).

    Merges the attempt INTO its entry (never replaces it) so the archived
    handler's artifact pointers survive whichever order the two events land.
    """
    # Imported here: conversation.py imports mirror_lab_verification from this
    # module, so a top-level import would be circular.
    from .conversation import _ensure_conversation_exists

    payload = parse_payload(event)
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id",
    )
    if not conversation_id:
        logger.warning("identity_verification.attempt.v1 without conversation id — skipped")
        return
    entry = {field: payload.get(field) for field in ATTEMPT_FIELDS}
    key = attempt_key(payload.get("lab_request_id"), payload.get("attempt_number"))
    async with pool.acquire() as conn, conn.transaction():
        await _ensure_conversation_exists(conn, conversation_id, event)
        await merge_jsonb_entry(
            conn,
            "conversations",
            column=ATTEMPTS_COLUMN,
            key_column="conversation_id",
            key_value=conversation_id,
            entry_key=key,
            patch=entry,
            bump_version=True,
        )
    logger.info(
        "Identity verification attempt recorded",
        conversation_id=conversation_id,
        attempt=key,
        attempt_number=entry.get("attempt_number"),
        step_up_requested=entry.get("step_up_requested"),
    )


async def handle_identity_report_archived(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Handle ``identity_verification.report.archived.v1``."""
    payload = parse_payload(event)
    application_number = safe_str(payload.get("application_number"), "application_number")
    lab_request_id = payload.get("lab_request_id")
    report = _artifact(payload, "report")
    screening_report = _artifact(payload, "screening_report")
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
                "identity_verification_report_verification_number": payload.get(
                    "verification_number"
                ),
                "identity_verification_report_screening_report_file_location": (
                    screening_report.get("file_location")
                ),
                "identity_verification_report_screening_report_file_name": (
                    screening_report.get("file_name")
                ),
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
            update_where=REPORT_ARCHIVED_AT_GUARD,
        )
        # Spec 2026-09-15: the artifacts also belong to ONE attempt — merged
        # under the LAB request id so the attempt row can link its report.
        if lab_request_id not in (None, ""):
            await merge_jsonb_entry(
                pool,
                "conversations",
                column=ATTEMPTS_COLUMN,
                key_column="conversation_id",
                key_value=str(conversation_id),
                entry_key=str(lab_request_id),
                patch={
                    "report_file_location": report.get("file_location"),
                    "report_file_name": report.get("file_name"),
                    # LAB API v1 archives a separate per-check screening PDF.
                    "screening_report_file_location": screening_report.get("file_location"),
                    "screening_report_file_name": screening_report.get("file_name"),
                    "raw_response_file_location": raw_response.get("file_location"),
                    "raw_response_file_name": raw_response.get("file_name"),
                    "archived_at": payload.get("archived_at"),
                    "attempt_number": payload.get("attempt_number"),
                    "step_up": payload.get("step_up"),
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
                "identity_verification_report_archived": bool(
                    report or screening_report or raw_response
                ),
                "identity_verification_archived_at": coerce_date(payload.get("archived_at")),
                "identity_verification_lab_request_id": str(lab_request_id)
                if lab_request_id is not None
                else None,
                "identity_verification_provider_reference": payload.get("provider_reference"),
                "updated_at": now,
                "created_at": now,
            },
            insert_only_columns=["created_at"],
            update_where=CUSTOMER_ARCHIVED_AT_GUARD,
        )
    else:
        log.warning("Archived identity report without customer id — no customer mirror")

    log.info("Identity verification report archival recorded")


def _first_check(lab: dict[str, Any], check_type: str) -> dict[str, Any]:
    """The ``result.checks[]`` entry for ``check_type`` (``{}`` when absent)."""
    result = lab.get("result")
    checks = result.get("checks") if isinstance(result, dict) else None
    for check in checks or []:
        if isinstance(check, dict) and check.get("checkType") == check_type:
            return check
    return {}


def _screening_result(lab: dict[str, Any], category: str) -> str | None:
    """``pep`` / ``sanctions`` verdict from the first screening provider."""
    for provider in _first_check(lab, "screening").get("providers") or []:
        if not isinstance(provider, dict):
            continue
        detail = provider.get("detail")
        block = detail.get(category) if isinstance(detail, dict) else None
        if isinstance(block, dict) and block.get("result") is not None:
            return str(block["result"])
    return None


# Monotonic guard for the customer identity mirror: two prod machines process
# the inbox concurrently and dedup is not exactly-once (event-processor
# AGENTS.md), so a replayed OLDER verification (legacy or v1) must never
# overwrite the columns of a NEWER one. Rows without a checked_at on either
# side are always written (legacy events lacking requestDateTime).
CHECKED_AT_GUARD = (
    "EXCLUDED.identity_verification_checked_at IS NULL "
    "OR customers.identity_verification_checked_at IS NULL "
    "OR EXCLUDED.identity_verification_checked_at "
    ">= customers.identity_verification_checked_at"
)


def is_lab_v1_block(lab: dict[str, Any]) -> bool:
    """True for a LAB Identity Verification API v1 ``Verification`` envelope."""
    return "id" in lab and "result" in lab


def lab_summary_columns(lab: dict[str, Any]) -> dict[str, Any]:
    """Customer-row summary columns for either ``lab_verification`` shape."""
    if is_lab_v1_block(lab):
        providers = lab.get("provider") or []
        first = providers[0] if providers and isinstance(providers[0], dict) else {}
        result = lab.get("result") if isinstance(lab.get("result"), dict) else {}
        identity = _first_check(lab, "identity")
        screening = _first_check(lab, "screening")
        return {
            "identity_verification_overall_result": result.get("outcome"),
            "identity_verification_provider": first.get("name"),
            "identity_verification_provider_reference": first.get("reference"),
            "identity_verification_lab_request_id": str(lab["id"]) if lab.get("id") else None,
            "identity_verification_checked_at": coerce_date(lab.get("createdAt")),
            "identity_verification_verification_number": lab.get("verificationNumber"),
            "identity_verification_identity_outcome": identity.get("outcome"),
            "identity_verification_screening_outcome": screening.get("outcome"),
            "identity_verification_pep_result": _screening_result(lab, "pep"),
            "identity_verification_sanctions_result": _screening_result(lab, "sanctions"),
        }
    request_id = lab.get("requestId")
    return {
        "identity_verification_overall_result": lab.get("overallResult"),
        "identity_verification_provider": lab.get("provider"),
        "identity_verification_provider_reference": lab.get("providerReference"),
        "identity_verification_lab_request_id": str(request_id)
        if request_id is not None
        else None,
        "identity_verification_checked_at": coerce_date(lab.get("requestDateTime")),
        "identity_verification_pep_result": lab.get("pepResult"),
        "identity_verification_sanctions_result": lab.get("sanctionsResult"),
    }


async def mirror_lab_verification(
    pool: asyncpg.Pool, customer_id: str | None, lab: dict[str, Any]
) -> None:
    """Mirror an ``identityRisk_assessment.lab_verification`` block onto the customer.

    The full verbatim block stays in ``conversations.assessments_identity_risk``
    (stored whole by ``handle_assessment``); this lifts the summary the customer
    details view shows. See ``lab_summary_columns`` for both block shapes.
    """
    canonical_id = await resolve_canonical_customer_id(pool, customer_id)
    if not canonical_id:
        logger.warning("lab_verification block without customer id — no customer mirror")
        return

    summary = lab_summary_columns(lab)
    now = datetime.now(UTC)
    tag = await upsert(
        pool,
        "customers",
        conflict_columns=["customer_id"],
        values={
            "customer_id": canonical_id,
            **summary,
            "updated_at": now,
            "created_at": now,
        },
        insert_only_columns=["created_at"],
        update_where=CHECKED_AT_GUARD,
    )
    if str(tag).endswith(" 0"):
        logger.info(
            "Stale lab_verification ignored (stored verification is newer)",
            customer_id=canonical_id,
        )
        return
    logger.info(
        "Mirrored lab verification onto customer",
        customer_id=canonical_id,
        overall_result=summary.get("identity_verification_overall_result"),
        shape="v1" if is_lab_v1_block(lab) else "legacy",
    )
