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

A verified-contact stop (BTB-569, ``recognition.band == "verified_contact"``)
is the exception: the applicant shares a code-verified email or mobile with an
earlier blocked customer but is not proven to be them, so only the
conversation projection is written and nothing is moved onto that customer.
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


# BTB-569. ``recognition.band`` on a blocked event whose only link to the
# earlier customer is a code-verified email or mobile (billieChat's
# verified_contact_block.RECOGNITION_BAND). The applicant has proven control of
# a contact, not who they are, so nothing of theirs may be moved onto, or
# written on, the customer the contact matched.
VERIFIED_CONTACT_BAND = "verified_contact"

# The clear reason an operator names to say the stopped applicant is not the
# earlier customer. Not a block reason: it clears one contact match and leaves
# the earlier customer blocked.
DIFFERENT_PERSON = "DIFFERENT_PERSON"

# SQL guards. A contact-match stop keeps the matched customer's id in
# ``reapplication_block_canonical_customer_id`` (information only), so every
# statement keyed on that column must say which kind of stop it means.
_IS_CONTACT_MATCH_STOP = (
    f"reapplication_block_recognition->>'band' = '{VERIFIED_CONTACT_BAND}'"
)
_NOT_CONTACT_MATCH_STOP = (
    "reapplication_block_recognition->>'band' IS DISTINCT FROM "
    f"'{VERIFIED_CONTACT_BAND}'"
)


def is_verified_contact_stop(payload: dict[str, Any]) -> bool:
    """True when a blocked event is a verified-contact match (BTB-569)."""
    recognition = payload.get("recognition")
    return isinstance(recognition, dict) and recognition.get("band") == VERIFIED_CONTACT_BAND


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

    if is_verified_contact_stop(payload):
        # BTB-569: the stop is a shared email or mobile, not proven identity.
        # The application stays on its own customer. The matched customer's id
        # is kept on the conversation above as a reference only; their row is
        # not written (their own block is already mirrored there by
        # state.changed, and this application is not theirs), and the journey
        # is not re-attributed, whatever the reason.
        log.info(
            "Verified-contact stop recorded on the conversation only",
            matched_customer_id=payload.get("canonical_customer_id"),
        )
        return

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

    Conversations are stamped by canonical customer id (not by conversation_id),
    because billieChat sets ``conv = "ops:block-clear:{request_id}"`` on these
    events — a synthetic ops key, not a real conversation id.  Using
    ``update_by_key`` on ``reapplication_block_canonical_customer_id`` clears
    all blocked conversations for the canonical in one pass; 0 matches is
    harmless (no phantom INSERT).
    """
    payload = parse_payload(event)
    request_id = safe_str(payload.get("request_id"), "request_id")

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

    if DIFFERENT_PERSON in cleared_reasons:
        await _record_different_person_cleared(
            pool,
            request_id=request_id,
            stopped_conversation_id=safe_str(
                payload.get("stopped_conversation_id"), "stopped_conversation_id"
            ),
            cleared_at=cleared_at,
            operator_id=operator_id,
            justification=justification,
            canonical=canonical,
        )
        return

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

        # Conversation audit trail — update all blocked conversations for this
        # canonical (keyed by reapplication_block_canonical_customer_id, which
        # handle_reapplication_blocked populates). UPDATE not upsert: 0 matches
        # is harmless; no phantom row is inserted for the ops:block-clear:… conv.
        conv_values: dict[str, Any] = {
            "reapplication_block_clear_status": "cleared",
            "reapplication_block_cleared_at": cleared_at,
            "reapplication_block_cleared_by": operator_id,
            "reapplication_block_clear_justification": justification,
            "reapplication_block_clear_request_id": request_id,
            "updated_at": now,
        }
        if reason_is_gone:
            conv_values["reapplication_block_reason"] = None
        # Not a contact-match stop of someone else's application (BTB-569):
        # that record is cleared only by its own "different person" clear.
        await update_by_key(
            pool,
            "conversations",
            key_column="reapplication_block_canonical_customer_id",
            key_value=canonical,
            values=conv_values,
            extra_where=_NOT_CONTACT_MATCH_STOP,
        )
    else:
        log.warning("Cleared event without resolvable customer id — no customer mirror")

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

    Like ``handle_reapplication_block_cleared``, conversations are stamped by
    canonical customer id (not conversation_id) because billieChat sets
    ``conv = "ops:block-clear:{request_id}"`` on these events.
    """
    payload = parse_payload(event)
    request_id = safe_str(payload.get("request_id"), "request_id")

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

    # Combine rejection_code + detail so operators see both the machine code
    # and the human-readable explanation in the request row.
    rejection_code = payload.get("rejection_code")
    detail = payload.get("detail")
    approval_reason = (
        f"{rejection_code}: {detail or ''}" if rejection_code else detail
    )

    # BTB-569: a refused "different person" clear belongs to one stopped
    # conversation, not to the customer its contact matched.
    if await _record_different_person_rejected(
        pool,
        request_id=request_id,
        stopped_conversation_id=safe_str(
            payload.get("stopped_conversation_id"), "stopped_conversation_id"
        ),
        named=DIFFERENT_PERSON in (payload.get("rejected_reasons") or []),
        rejection=approval_reason,
    ):
        return

    # Flip the queue row to "rejected" and record the reason.
    if request_id:
        await update_by_key(
            pool,
            "reapplication_block_clear_requests",
            key_column="request_id",
            key_value=request_id,
            values={
                "status": "rejected",
                "approval_details_reason": approval_reason,
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

        # Update all blocked conversations for this canonical — same pattern as
        # the cleared handler; UPDATE not upsert to avoid phantom rows.
        await update_by_key(
            pool,
            "conversations",
            key_column="reapplication_block_canonical_customer_id",
            key_value=canonical,
            values={"reapplication_block_clear_status": "rejected", "updated_at": now},
            extra_where=_NOT_CONTACT_MATCH_STOP,
        )
    else:
        log.warning("Rejected event without resolvable customer id — no customer mirror")

    log.info("Re-application block clear rejected")


# =============================================================================
# "Clear: different person" for a verified-contact stop (BTB-569)
# =============================================================================
#
# One stopped application is cleared, never a customer: billieChat writes an
# exclusion for the (contact, customer) pair that stop recorded and leaves the
# earlier customer's block as it is. So all three writers below touch exactly
# one conversation row, the stopped one, and no customer row.
#
#   requested (CRM, internal stream)   -> clear_status "pending" + who and why
#   cleared   (billieChat)             -> "cleared"  + who, when, why
#   rejected  (billieChat)             -> "rejected" + billieChat's reason


async def handle_different_person_clear_requested(
    pool: asyncpg.Pool, parsed_event: dict[str, Any]
) -> None:
    """Handle ``block_clear.different_person_requested.v1`` (CRM internal).

    The CRM publishes this next to the ``clear_authorized`` command it sends
    billieChat. It records who asked and why on the stopped conversation, and
    ties the request id to it: billieChat's rejection names only the request,
    so this is how a rejection finds the conversation.

    Never moves a record backwards: a conversation already cleared stays
    cleared, and a redelivery after this request's own answer arrived (the
    answer stamps the same request id) changes nothing.
    """
    payload = parse_payload(parsed_event)
    request_id = safe_str(parsed_event.get("conv", ""), "request_id")
    conversation_id = safe_str(payload.get("conversationId"), "conversation_id")
    log = logger.bind(request_id=request_id, conversation_id=conversation_id)
    log.info("Processing block_clear.different_person_requested.v1")
    if not (request_id and conversation_id):
        log.warning("different-person clear request without request or conversation id")
        return

    status = await pool.execute(
        f"""
        UPDATE conversations
        SET reapplication_block_clear_status = 'pending',
            reapplication_block_clear_request_id = $2,
            reapplication_block_cleared_by = $3,
            reapplication_block_clear_justification = $4,
            reapplication_block_clear_rejection = NULL,
            updated_at = $5
        WHERE conversation_id = $1
          AND {_IS_CONTACT_MATCH_STOP}
          AND reapplication_block_clear_status IS DISTINCT FROM 'cleared'
          AND reapplication_block_clear_request_id IS DISTINCT FROM $2
        """,
        conversation_id,
        request_id,
        safe_str(payload.get("requestedBy"), "requested_by") or None,
        payload.get("justification"),
        datetime.now(UTC),
    )
    log.info("Different-person clear request recorded", update_status=status)


async def _record_different_person_cleared(
    pool: asyncpg.Pool,
    *,
    request_id: str,
    stopped_conversation_id: str,
    cleared_at: object,
    operator_id: object,
    justification: object,
    canonical: str | None,
) -> None:
    """``cleared.v1`` with ``cleared_reasons: ["DIFFERENT_PERSON"]``.

    Stamps who cleared the stopped conversation, when and why. The block
    reason stays on it: the application was declined for that reason and the
    earlier customer is still blocked for it (``prior_block_reason``), so the
    customer row and that customer's own conversations are not touched.
    """
    log = logger.bind(
        request_id=request_id,
        stopped_conversation_id=stopped_conversation_id,
        matched_customer_id=canonical,
    )
    log.info("Processing reapplication_block.cleared.v1 (different person)")
    values: dict[str, Any] = {
        "reapplication_block_clear_status": "cleared",
        "reapplication_block_cleared_at": cleared_at,
        "reapplication_block_cleared_by": operator_id,
        "reapplication_block_clear_justification": justification,
        "reapplication_block_clear_request_id": request_id,
        "reapplication_block_clear_rejection": None,
        "updated_at": datetime.now(UTC),
    }
    if stopped_conversation_id:
        key_column, key_value = "conversation_id", stopped_conversation_id
    elif request_id:
        # billieChat always names the conversation; the request id (stamped by
        # the CRM's own request event) is the fallback if it ever does not.
        key_column, key_value = "reapplication_block_clear_request_id", request_id
    else:
        log.warning("different-person cleared event names no conversation or request")
        return
    status = await update_by_key(
        pool,
        "conversations",
        key_column=key_column,
        key_value=key_value,
        values=values,
        extra_where=_IS_CONTACT_MATCH_STOP,
    )
    log.info("Verified-contact stop cleared as a different person", update_status=status)


async def _record_different_person_rejected(
    pool: asyncpg.Pool,
    *,
    request_id: str,
    stopped_conversation_id: str,
    named: bool,
    rejection: str | None,
) -> bool:
    """``clear_rejected.v1`` for a "different person" clear, if it is one.

    Returns True when the rejection belongs to a different-person clear and
    has been dealt with, so the caller must not treat it as a rejected clear
    of a customer's block.

    It is one when the event names ``DIFFERENT_PERSON`` in
    ``rejected_reasons`` (billieChat's ``MISSING_FIELDS`` for a missing
    conversation id, and ``UNKNOWN_STOPPED_CONVERSATION``), or when the
    request id is one a contact-match conversation is waiting on (billieChat's
    earliest ``MISSING_FIELDS`` check names no reasons at all).

    The rejection event carries no conversation id today, so the conversation
    is found by the request id the CRM's request event stamped. A cleared
    conversation is never turned back to rejected.
    """
    log = logger.bind(request_id=request_id, rejection=rejection)
    conversation_id = stopped_conversation_id
    if not conversation_id and request_id:
        row = await pool.fetchrow(
            "SELECT conversation_id FROM conversations "
            "WHERE reapplication_block_clear_request_id = $1 "
            f"AND {_IS_CONTACT_MATCH_STOP} LIMIT 1",
            request_id,
        )
        conversation_id = (row["conversation_id"] if row else None) or ""
    if not conversation_id:
        if named:
            # Its request event has not been projected (or was lost). Nothing
            # to stamp, and it must not fall through to the customer's row.
            log.warning("Different-person clear rejected, no conversation waiting on it")
        return named

    status = await update_by_key(
        pool,
        "conversations",
        key_column="conversation_id",
        key_value=conversation_id,
        values={
            "reapplication_block_clear_status": "rejected",
            "reapplication_block_clear_request_id": request_id or None,
            "reapplication_block_clear_rejection": rejection,
            "updated_at": datetime.now(UTC),
        },
        extra_where=(
            f"{_IS_CONTACT_MATCH_STOP} "
            "AND reapplication_block_clear_status IS DISTINCT FROM 'cleared'"
        ),
    )
    log.info(
        "Different-person clear rejected",
        stopped_conversation_id=conversation_id,
        update_status=status,
    )
    return True


async def handle_reapplication_block_auto_cleared(
    pool: asyncpg.Pool, event: dict[str, Any]
) -> None:
    """Handle ``reapplication_block.auto_cleared.v1``.

    Emitted by billieChat's reapplicationBlock service when a customer's LAST
    open loan is repaid, so the ACTIVE_LOAN eligibility condition no longer
    applies. Unlike the operator-driven ``cleared`` flow, this fires
    automatically on repayment — for ANY customer closing a loan — so it must be
    a precise no-op for anyone not currently shown as ACTIVE_LOAN blocked.

    Only the CUSTOMER-level "currently blocked" mirror is touched:
    * ``residual_block_reason`` is None → the person is no longer blocked at all;
      NULL ``reapplication_block_reason`` so the servicing banner clears.
    * a residual reason (e.g. PRIOR_DEFAULT still blocks) → correct the banner to
      that reason instead of clearing.

    The conversation-level "why was THIS application declined" record is left
    untouched — that decline was correct at the time and is audit history.

    Guarded ``WHERE reapplication_block_reason = 'ACTIVE_LOAN'`` so it never
    inserts a phantom row, never stamps customers who were never blocked, and
    never overrides a higher-precedence reason already shown.
    """
    payload = parse_payload(event)
    customer_id = (
        safe_str(
            payload.get("canonical_customer_id") or event.get("usr"),
            "customer_id",
        )
        or None
    )
    canonical = await resolve_canonical_customer_id(pool, customer_id)
    residual = payload.get("residual_block_reason")  # None = fully unblocked
    cleared_at = coerce_date(payload.get("cleared_at"))

    log = logger.bind(canonical_customer_id=canonical, residual_block_reason=residual)
    log.info("Processing reapplication_block.auto_cleared.v1")

    if not canonical:
        log.warning("auto_cleared event without resolvable customer id — no-op")
        return

    status = await pool.execute(
        """
        UPDATE customers
        SET reapplication_block_reason = $2,
            reapplication_block_clear_status = 'auto_cleared',
            reapplication_block_cleared_at = $3,
            updated_at = $4
        WHERE customer_id = $1
          AND reapplication_block_reason = 'ACTIVE_LOAN'
        """,
        canonical,
        residual,
        cleared_at,
        datetime.now(UTC),
    )
    log.info("Re-application ACTIVE_LOAN block auto-cleared", update_status=status)


# Guard for the customer-level block mirror. The version clause orders events
# within one projection epoch so the two unordered prod consumers converge on
# the newest state; the changed_at clause lets a new epoch (a Redis rebuild or
# merge fold restarts the document at v1) or a late `drop` event after a merge
# be superseded instead of wedging the row forever (spec: Race analysis).
STATE_VERSION_GUARD = (
    "COALESCE(customers.reapplication_block_state_version, 0) "
    "< EXCLUDED.reapplication_block_state_version "
    "OR customers.reapplication_block_state_changed_at IS NULL "
    "OR EXCLUDED.reapplication_block_state_changed_at "
    "> customers.reapplication_block_state_changed_at"
)


# billieChat answers the CRM's manual set on this synthetic conversation, and
# carries the command's own conv into state.changed's ``cause.conv``.
MANUAL_SET_CONV_PREFIX = "ops:block-set:"


def _manual_set_request_id(payload: dict[str, Any], reason: str | None) -> str | None:
    """The CRM manual-set request that produced this MANUAL_ADMIN state, else None.

    BTB-517. A manual block's reason code (``credit_review_hold`` …) arrives on
    ``manual_set_applied.v1``; state.changed carries no reason code, only what
    caused it. Binding the mirrored block to the causing request lets the CRM
    show the code for exactly the block that set raised. Any other cause — a
    conversation kill (which emits no ``manual_set_applied``), a merge, an
    unblock or another reason — unbinds it, so an older set's code can never
    describe a block something else raised.
    """
    if reason != "MANUAL_ADMIN":
        return None
    cause = payload.get("cause")
    conv = cause.get("conv") if isinstance(cause, dict) else None
    if not isinstance(conv, str) or not conv.startswith(MANUAL_SET_CONV_PREFIX):
        return None
    return conv[len(MANUAL_SET_CONV_PREFIX) :] or None


async def unbind_manual_block(pool: asyncpg.Pool, customer_id: str | None) -> None:
    """Forget which CRM manual set raised this customer's block (BTB-517, R23).

    Called on ``conversation.killed.v1``. A kill can raise its own MANUAL_ADMIN
    block over a manual-set one; when both are permanent billieChat's decision
    does not move, so no state.changed arrives to unbind the set, and the
    servicing view would keep naming the set's reason (say "cancelled before
    disbursement") on what is now a kill block. The kill event does not say
    whether it asked for a block, so every kill unbinds: the label then falls
    back to "Manually blocked (staff)", which is never wrong. A later manual set
    binds again through its own state.changed, in whatever order they arrive.

    Update only, on the canonical row: never creates a customer.
    """
    canonical = await resolve_canonical_customer_id(pool, customer_id)
    if not canonical:
        return
    await pool.execute(
        "UPDATE customers SET reapplication_block_manual_block_request_id = NULL, "
        "updated_at = NOW() WHERE customer_id = $1 "
        "AND reapplication_block_manual_block_request_id IS NOT NULL",
        canonical,
    )


async def handle_reapplication_block_manual_set_applied(
    pool: asyncpg.Pool, event: dict[str, Any]
) -> None:
    """Handle ``reapplication_block.manual_set_applied.v1`` (BTB-517).

    billieChat applied a manual block the CRM asked for with
    ``reapplication_block.manual_set.v1``. Records the request id and its reason
    code on the canonical customer. The block itself (reason, until, version) is
    not written here: ``state.changed.v1`` stays its only writer. The code is
    shown only while the block ``state.changed`` bound to this request is the
    one in force (see ``_manual_set_request_id``).

    Idempotent: a redelivery, or billieChat's replay of the same request, writes
    the same values.
    """
    payload = parse_payload(event)
    request_id = safe_str(payload.get("request_id"), "request_id") or None
    customer_id = (
        safe_str(payload.get("canonical_customer_id") or event.get("usr"), "customer_id")
        or None
    )
    log = logger.bind(customer_id=customer_id, request_id=request_id)
    log.info("Processing reapplication_block.manual_set_applied.v1")
    if not request_id:
        log.warning("manual_set_applied without request_id — ignored")
        return

    canonical = await resolve_canonical_customer_id(pool, customer_id)
    if not canonical:
        log.warning("manual_set_applied without resolvable customer id — no customer mirror")
        return

    now = datetime.now(UTC)
    await upsert(
        pool,
        "customers",
        conflict_columns=["customer_id"],
        values={
            "customer_id": canonical,
            "reapplication_block_manual_set_request_id": request_id,
            "reapplication_block_manual_set_reason_code": safe_str(
                payload.get("reason_code"), "reason_code"
            )
            or None,
            "updated_at": now,
            "created_at": now,
        },
        insert_only_columns=["created_at"],
    )
    log.info("Manual block set recorded", canonical_customer_id=canonical)


async def handle_reapplication_block_manual_set_rejected(
    pool: asyncpg.Pool, event: dict[str, Any]
) -> None:
    """Handle ``reapplication_block.manual_set_rejected.v1`` (BTB-517).

    billieChat refused a manual set (``MISSING_FIELDS``, ``INVALID_REASON``,
    ``INVALID_EXPIRY``, ``WOULD_SHORTEN_ACTIVE_BLOCK``). Records which request
    was refused and why, so the supervisor who asked sees it. The block and the
    last applied set are left alone: a refused set changes nothing.
    """
    payload = parse_payload(event)
    request_id = safe_str(payload.get("request_id"), "request_id") or None
    customer_id = (
        safe_str(payload.get("canonical_customer_id") or event.get("usr"), "customer_id")
        or None
    )
    rejection_code = safe_str(payload.get("rejection_code"), "rejection_code") or None
    detail = safe_str(payload.get("detail"), "detail") or None
    log = logger.bind(
        customer_id=customer_id, request_id=request_id, rejection_code=rejection_code
    )
    log.info("Processing reapplication_block.manual_set_rejected.v1")
    if not request_id:
        log.warning("manual_set_rejected without request_id — ignored")
        return

    canonical = await resolve_canonical_customer_id(pool, customer_id)
    if not canonical:
        log.warning("manual_set_rejected without resolvable customer id — no customer mirror")
        return

    rejection = ": ".join(part for part in (rejection_code, detail) if part) or None
    now = datetime.now(UTC)
    await upsert(
        pool,
        "customers",
        conflict_columns=["customer_id"],
        values={
            "customer_id": canonical,
            "reapplication_block_manual_set_rejected_request_id": request_id,
            "reapplication_block_manual_set_rejection": rejection,
            "updated_at": now,
            "created_at": now,
        },
        insert_only_columns=["created_at"],
    )
    log.info("Manual block set rejection recorded", canonical_customer_id=canonical)


async def handle_reapplication_block_state_changed(
    pool: asyncpg.Pool, event: dict[str, Any]
) -> None:
    """Handle ``reapplication_block.state.changed.v1``.

    Emitted by billieChat's reapplicationBlock service whenever the evaluated
    block decision for a canonical customer changes — a decline recorded, a loan
    closed, a manual clear applied, an identity merge, or the one-off backfill.
    No customer interaction is required, so a customer declined today shows as
    blocked in the servicing view today (spec: 2026-08-22 state-changed design).

    This becomes the authoritative writer of the customer-level "currently
    blocked" mirror (``reason`` / ``blocked_until`` / ``blocked_at`` /
    ``application_number``) from Phase 2; until then the legacy handlers
    (``handle_reapplication_blocked``, ``handle_reapplication_block_cleared``,
    ``handle_reapplication_block_auto_cleared``) still write these columns
    without a version. It never touches the clear-audit stamps
    (``clear_status`` / ``cleared_at`` — owned by the cleared/auto_cleared
    handlers) nor the conversation-level "why was THIS application halted"
    record (owned by ``handle_reapplication_blocked``).

    Guarded: ``state_version`` is the projection's CAS version and orders
    events within one projection epoch, so arrival order across the two prod
    consumers does not matter; ``changed_at`` lets a newer emission from a new
    epoch (or after a merge) supersede a higher stale version. A rejected
    (stale) write is logged at INFO and is not an error. ``state_version``,
    ``blocked``, and ``changed_at`` are required contract fields, validated in
    that order before any DB access — fail fast on malformed input rather than
    spend a round trip resolving the canonical customer id first. A missing or
    non-integer ``state_version``, a missing ``blocked``, or a missing/
    unparseable ``changed_at`` is rejected the same way (logged at WARNING,
    handler returns).
    """
    payload = parse_payload(event)
    customer_id = (
        safe_str(
            payload.get("canonical_customer_id") or event.get("usr"),
            "customer_id",
        )
        or None
    )
    raw_version = payload.get("state_version")

    log = logger.bind(
        customer_id=customer_id,
        state_version=raw_version,
        blocked=payload.get("blocked"),
    )
    log.info("Processing reapplication_block.state.changed.v1")

    try:
        state_version = int(raw_version)
    except (TypeError, ValueError):
        log.warning("state.changed event without an integer state_version — ignored")
        return

    if "blocked" not in payload:
        log.warning("state.changed event without `blocked` — ignored")
        return
    blocked = bool(payload["blocked"])
    reason = payload.get("reason") if blocked else None
    log = log.bind(blocked=blocked, reason=reason)

    changed_at = coerce_date(payload.get("changed_at"))
    if not isinstance(changed_at, datetime):
        log.warning("state.changed event without a parseable changed_at — ignored")
        return

    canonical = await resolve_canonical_customer_id(pool, customer_id)
    if not canonical:
        log.warning("state.changed event without resolvable customer id — no customer mirror")
        return
    log = log.bind(canonical_customer_id=canonical)

    now = datetime.now(UTC)
    values: dict[str, Any] = {
        "customer_id": canonical,
        "reapplication_block_state_version": state_version,
        "reapplication_block_state_changed_at": changed_at,
        "reapplication_block_reason": reason,
        # BTB-517: which CRM manual set (if any) raised the block shown now.
        # Written in this same version-guarded upsert, so it moves only with
        # the block itself.
        "reapplication_block_manual_block_request_id": _manual_set_request_id(
            payload, reason
        ),
        "reapplication_block_blocked_until": (
            coerce_date(payload.get("blocked_until")) if blocked else None
        ),
        "reapplication_block_application_number": (
            payload.get("source_application_number") if blocked else None
        ),
        "updated_at": now,
        "created_at": now,
    }
    if blocked:
        # When the block became effective in the mirror. The fact's own time is
        # source_decided_at (kept on the conversation record). Retained on
        # unblock as audit, so it is simply not written then.
        values["reapplication_block_blocked_at"] = changed_at

    tag = await upsert(
        pool,
        "customers",
        conflict_columns=["customer_id"],
        values=values,
        insert_only_columns=["created_at"],
        update_where=STATE_VERSION_GUARD,
    )
    if str(tag).endswith(" 0"):
        log.info("Stale reapplication_block.state.changed ignored (stored version is newer)")
        return
    log.info("Re-application block state mirrored")
