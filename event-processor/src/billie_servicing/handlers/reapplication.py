"""Re-application block handler (BTB-135).

Consumes ``application.reapplication_blocked.v1`` — emitted by
customerLiaisonAgent the moment the BTB-85 re-application block halts an
application, before the customer-facing stop message. Fire-once per
application (delivery is at-least-once; the writes below are idempotent
upserts keyed on natural ids).

Two projections:

* ``conversations.reapplication_block_*`` — the rich "why was this declined"
  shown on the application details view.
* ``customers.reapplication_block_*`` — a compact mirror on the canonical
  customer row so the servicing view can flag "blocked until …" without
  scanning conversations.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog

from ..db import coerce_date, update_by_key, upsert, upsert_conversation
from .identity import _merge_identity, resolve_canonical_customer_id
from .sanitize import parse_payload, safe_str

logger = structlog.get_logger()

# Block reasons that reflect a confident match to a single canonical identity —
# only these re-attribute the blocked journey's records onto the canonical
# customer so the app surfaces in the canonical's application list. DEFAULT-DENY
# everything else (PEP, ID_VERIFICATION, SERVICEABILITY, ACCOUNT_CONDUCT,
# IDENTITY_CONFLICT and any unknown future value): record the block only.
# IDENTITY_CONFLICT is excluded on purpose — strong-vs-strong means the canonical
# is ambiguous, so auto-merging could attribute an application to the WRONG
# person. Mis-merging two people in the servicing view is worse than a missing
# app; start conservative and expand this allowlist deliberately.
#
# PRIOR_SERIOUS_ARREARS (BTB-154) is account-history-derived — it fires off the
# resolved canonical's own prior closed-loan aging (ever reached late_arrears /
# default, then cured), the same confident single-identity basis as
# PRIOR_DEFAULT — so it re-attributes too.
_REATTRIBUTE_BLOCK_REASONS = frozenset(
    {"ACTIVE_LOAN", "PRIOR_DEFAULT", "PRIOR_SERIOUS_ARREARS"}
)


async def handle_reapplication_blocked(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Handle ``application.reapplication_blocked.v1``."""
    payload = parse_payload(event)
    conversation_id = safe_str(
        payload.get("conversation_id") or event.get("cid") or event.get("conv"),
        "conversation_id",
    )
    application_number = safe_str(payload.get("application_number"), "application_number")
    reason = payload.get("reason")

    # A halt is one of two kinds — "block" (a confirmed eligibility block) or
    # "review" (held as a probable returning customer, carrying the
    # identity-recognition match context). The recognition blob is projected
    # verbatim into a jsonb column; asyncpg has no dict→jsonb codec, so serialise
    # it to a JSON string here (None stays NULL — older events omit it).
    recognition = payload.get("recognition")
    recognition_json = json.dumps(recognition) if recognition is not None else None

    log = logger.bind(
        conversation_id=conversation_id,
        application_number=application_number,
        reason=reason,
    )
    log.info("Processing application.reapplication_blocked.v1")

    if conversation_id:
        await upsert_conversation(
            pool,
            conversation_id=conversation_id,
            set_values={
                "reapplication_block_reason": reason,
                "reapplication_block_message_variant": payload.get("message_variant"),
                "reapplication_block_stop_message": payload.get("stop_message"),
                "reapplication_block_source_application_number": payload.get(
                    "source_application_number"
                ),
                "reapplication_block_source_account_id": payload.get("source_account_id"),
                "reapplication_block_source_decided_at": coerce_date(
                    payload.get("source_decided_at")
                ),
                # blocked_until null = permanent (PEP, PRIOR_DEFAULT,
                # IDENTITY_CONFLICT) or ongoing-state (ACTIVE_LOAN).
                "reapplication_block_blocked_until": coerce_date(payload.get("blocked_until")),
                "reapplication_block_blocked_at": coerce_date(payload.get("blocked_at")),
                "reapplication_block_canonical_customer_id": payload.get(
                    "canonical_customer_id"
                ),
                # Halt kind + the identity-recognition match context.
                "reapplication_block_disposition_kind": payload.get("disposition_kind"),
                "reapplication_block_manual_review_candidate": payload.get(
                    "manual_review_candidate"
                ),
                "reapplication_block_recognition": recognition_json,
            },
            # Identifying columns only seed a fresh row — never overwrite an
            # existing one (identity merges may have re-pointed customer_id_string).
            insert_only_values={
                "application_number": application_number or "",
                "customer_id_string": payload.get("journey_customer_id")
                or event.get("usr")
                or None,
            },
        )
    else:
        log.warning("Re-application block event without conversation id")

    # Customer-level mirror on the canonical row.
    customer_id = safe_str(
        payload.get("canonical_customer_id")
        or payload.get("journey_customer_id")
        or event.get("usr"),
        "customer_id",
    )
    canonical_id = await resolve_canonical_customer_id(pool, customer_id or None)
    if canonical_id:
        now = datetime.now(UTC)
        await upsert(
            pool,
            "customers",
            conflict_columns=["customer_id"],
            values={
                "customer_id": canonical_id,
                "reapplication_block_reason": reason,
                "reapplication_block_blocked_until": coerce_date(payload.get("blocked_until")),
                "reapplication_block_blocked_at": coerce_date(payload.get("blocked_at")),
                "reapplication_block_application_number": application_number or None,
                "updated_at": now,
                "created_at": now,
            },
            insert_only_columns=["created_at"],
        )
    else:
        log.warning("Re-application block event without customer id — no customer mirror")

    # Surface the blocked application under the canonical customer. A blocked
    # returning customer never gets a customer.identity.linked.v1 (halted
    # journeys stay evidence-only upstream), so without this the conversation /
    # application stays under the journey id — invisible in the canonical's
    # application list. Reuse _merge_identity (the same UPDATE-by-alias the
    # linked/merged path uses) so re-attribution semantics and idempotency stay
    # identical. Runs AFTER the conversation seed above so that row is moved too.
    journey_id = (
        safe_str(payload.get("journey_customer_id") or event.get("usr"), "journey_customer_id")
        or None
    )
    block_canonical_id = (
        safe_str(payload.get("canonical_customer_id"), "canonical_customer_id") or None
    )
    if (
        reason in _REATTRIBUTE_BLOCK_REASONS
        and journey_id
        and block_canonical_id
        and block_canonical_id != journey_id
    ):
        # Idempotent: _merge_identity UPDATEs WHERE customer_id_string =
        # journey_id, so a redelivery finds the rows already on the canonical and
        # matches nothing. CRM-local attribution only — no write-back to the
        # upstream identity:canonical / identity:aliases keys.
        await _merge_identity(
            pool,
            canonical_id=block_canonical_id,
            alias_id=journey_id,
            kind="reapplication_blocked",
        )
        log.info(
            "Re-attributed blocked journey records to canonical",
            journey_customer_id=journey_id,
            canonical_customer_id=block_canonical_id,
        )
    elif reason not in _REATTRIBUTE_BLOCK_REASONS:
        log.debug("Block reason not in re-attribution allowlist — block recorded only")

    log.info("Re-application block recorded")


async def handle_reapplication_block_cleared(
    pool: asyncpg.Pool, event: dict[str, Any]
) -> None:
    """Handle ``reapplication_block.cleared.v1``.

    Emitted by billieChat's customerLiaisonAgent after an operator-authorised
    clear is applied.  Projects the outcome back into three CRM tables:

    * ``customers`` — compact mirror so the servicing view stops showing "blocked".
    * ``conversations`` — operator audit trail (who cleared, why, request id).
    * ``reapplication_block_clear_requests`` — flips the queue row to "approved".

    §14 nuance: only NULL ``reapplication_block_reason`` when the previously-
    blocking reason is confirmed gone (``prior_block_reason`` is absent OR in
    ``cleared_reasons``).  When a higher-precedence reason still blocks, stamp
    the audit fields but leave the reason column untouched.
    """
    payload = parse_payload(event)
    request_id = safe_str(payload.get("request_id"), "request_id")
    conversation_id = (
        safe_str(
            payload.get("conversation_id") or event.get("cid") or event.get("conv"),
            "conversation_id",
        )
        or None
    )

    customer_id = (
        safe_str(
            payload.get("canonical_customer_id") or event.get("usr"),
            "customer_id",
        )
        or None
    )
    canonical = await resolve_canonical_customer_id(pool, customer_id)

    # §14: is the previously-blocking reason now gone?
    cleared_reasons: list[str] = payload.get("cleared_reasons") or []
    prior = payload.get("prior_block_reason")
    reason_is_gone = prior is None or prior in cleared_reasons

    cleared_at = coerce_date(payload.get("cleared_at"))
    operator_id = payload.get("operator_id")
    justification = payload.get("justification")

    log = logger.bind(
        canonical_customer_id=canonical,
        request_id=request_id,
        prior_block_reason=prior,
        reason_is_gone=reason_is_gone,
    )
    log.info("Processing reapplication_block.cleared.v1")

    now = datetime.now(UTC)

    # Customer-level mirror.
    if canonical:
        customer_values: dict[str, Any] = {
            "customer_id": canonical,
            "reapplication_block_clear_status": "cleared",
            "reapplication_block_cleared_at": cleared_at,
            "updated_at": now,
            "created_at": now,
        }
        if reason_is_gone:
            # NULL the reason so the servicing view stops showing "blocked".
            customer_values["reapplication_block_reason"] = None
        await upsert(
            pool,
            "customers",
            conflict_columns=["customer_id"],
            values=customer_values,
            insert_only_columns=["created_at"],
        )
    else:
        log.warning("Cleared event without resolvable customer id — no customer mirror")

    # Conversation audit trail.
    if conversation_id:
        conv_values: dict[str, Any] = {
            "reapplication_block_clear_status": "cleared",
            "reapplication_block_cleared_at": cleared_at,
            "reapplication_block_cleared_by": operator_id,
            "reapplication_block_clear_justification": justification,
            "reapplication_block_clear_request_id": request_id or None,
        }
        if reason_is_gone:
            conv_values["reapplication_block_reason"] = None
        await upsert_conversation(
            pool,
            conversation_id=conversation_id,
            set_values=conv_values,
        )
    else:
        log.info("Cleared event has no conversation_id — customer mirror only")

    # Flip the queue row to "approved" so the operator sees it was applied.
    if request_id:
        await update_by_key(
            pool,
            "reapplication_block_clear_requests",
            key_column="request_id",
            key_value=request_id,
            values={
                "status": "approved",
                "updated_at": now,
            },
        )

    log.info("Re-application block cleared")


async def handle_reapplication_block_clear_rejected(
    pool: asyncpg.Pool, event: dict[str, Any]
) -> None:
    """Handle ``reapplication_block.clear_rejected.v1``.

    Emitted by billieChat when the clear was not authorised (e.g. a
    single-operator attempt for a reason that requires maker-checker, or an
    explicit rejection by the approver).  Stamps a "rejected" status so the
    operator can see the failure in the queue and on the customer / conversation
    views.
    """
    payload = parse_payload(event)
    request_id = safe_str(payload.get("request_id"), "request_id")
    conversation_id = (
        safe_str(
            payload.get("conversation_id") or event.get("cid") or event.get("conv"),
            "conversation_id",
        )
        or None
    )

    customer_id = (
        safe_str(
            payload.get("canonical_customer_id") or event.get("usr"),
            "customer_id",
        )
        or None
    )
    canonical = await resolve_canonical_customer_id(pool, customer_id)

    log = logger.bind(canonical_customer_id=canonical, request_id=request_id)
    log.info("Processing reapplication_block.clear_rejected.v1")

    now = datetime.now(UTC)

    # Flip the queue row to "rejected" and record the reason.
    if request_id:
        await update_by_key(
            pool,
            "reapplication_block_clear_requests",
            key_column="request_id",
            key_value=request_id,
            values={
                "status": "rejected",
                "approval_details_reason": payload.get("detail"),
                "updated_at": now,
            },
        )

    # Stamp clear_status on the customer row so the servicing view shows it.
    if canonical:
        await upsert(
            pool,
            "customers",
            conflict_columns=["customer_id"],
            values={
                "customer_id": canonical,
                "reapplication_block_clear_status": "rejected",
                "updated_at": now,
                "created_at": now,
            },
            insert_only_columns=["created_at"],
        )
    else:
        log.warning("Rejected event without resolvable customer id — no customer mirror")

    # Mirror onto conversation if present.
    if conversation_id:
        await upsert_conversation(
            pool,
            conversation_id=conversation_id,
            set_values={
                "reapplication_block_clear_status": "rejected",
            },
        )

    log.info("Re-application block clear rejected")
