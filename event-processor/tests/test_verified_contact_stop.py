"""Verified-contact stop and its "different person" clear (BTB-569).

billieChat stops a new applicant who code-verifies an email or mobile that an
earlier, currently blocked customer also verified. The blocked event is the
usual ``application.reapplication_blocked.v1`` with
``recognition.band == "verified_contact"``. A shared contact is not proof of
identity, so the CRM must leave the stopped application on its own customer.

Support clears a wrong match with ``reasons: ["DIFFERENT_PERSON"]``; billieChat
answers with the ordinary cleared / clear_rejected events, which must land on
the one stopped conversation and never on the matched customer.
"""

from __future__ import annotations

import pytest

from billie_servicing.handlers.reapplication import (
    handle_different_person_clear_requested,
    handle_reapplication_block_clear_rejected,
    handle_reapplication_block_cleared,
    handle_reapplication_blocked,
    is_verified_contact_stop,
)

JOURNEY = "NEWJOURNEY1"
MATCHED = "22F0652F"
STOPPED_CONV = "7d5ee9c2-dd6b-4091-8a3a-6c148a4c4142"

# The payload billieChat's verified_contact_block.stop_application emits.
CONTACT_STOP_PAYLOAD = {
    "application_number": "A3CD3461-11F",
    "conversation_id": STOPPED_CONV,
    "journey_customer_id": JOURNEY,
    "canonical_customer_id": MATCHED,
    "reason": "ACTIVE_LOAN",
    "message_variant": "ACTIVE_LOAN",
    "stop_message": "Sorry, we can't help right now.",
    "source_application_number": "871CE08C-8B6",
    "source_account_id": "acct-1",
    "source_decided_at": "2026-06-10T01:02:21.110306+00:00",
    "blocked_until": None,
    "blocked_at": "2026-11-11T07:08:40.123456+00:00",
    "disposition_kind": "block",
    "manual_review_candidate": False,
    "login_prompt": False,
    "recognition": {
        "band": "verified_contact",
        "posterior": None,
        "case_id": None,
        "candidates": [],
        "matched_contact_kinds": ["phone"],
    },
}


def _blocked_event(**overrides: object) -> dict:
    payload = dict(CONTACT_STOP_PAYLOAD)
    payload.update(overrides)
    return {
        "typ": "application.reapplication_blocked.v1",
        "usr": JOURNEY,
        "payload": payload,
    }


def _conversation_updates(mock_pool) -> list:
    return [c for c in mock_pool.calls_against("conversations") if c.op == "UPDATE"]


def _customer_writes(mock_pool) -> list:
    """Every INSERT / UPDATE on customers (resolving a merged id is a read)."""
    return [c for c in mock_pool.calls_against("customers") if c.op != "SELECT"]


class TestIsVerifiedContactStop:
    def test_true_for_the_verified_contact_band(self) -> None:
        """The band billieChat sets marks the stop."""
        assert is_verified_contact_stop(CONTACT_STOP_PAYLOAD)

    @pytest.mark.parametrize(
        "recognition",
        [None, {}, {"band": None}, {"band": "review"}, "verified_contact", ["verified_contact"]],
    )
    def test_false_for_anything_else(self, recognition: object) -> None:
        """A scored, logged-in or legacy block is not a contact match."""
        assert not is_verified_contact_stop({"recognition": recognition})


class TestContactMatchStopIsNotReattributed:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "reason",
        ["ACTIVE_LOAN", "PRIOR_DEFAULT", "PRIOR_SERIOUS_ARREARS", "SERVICEABILITY"],
    )
    async def test_journey_stays_on_its_own_customer(self, mock_pool, reason: str) -> None:
        """No record is moved under the matched customer, whatever the reason.

        ACTIVE_LOAN / PRIOR_DEFAULT / PRIOR_SERIOUS_ARREARS re-attribute a
        proven block; on a contact match they must not.
        """
        mock_pool.set_fetchval_sequence([None, "canon-ref", "alias-ref"])
        await handle_reapplication_blocked(mock_pool, _blocked_event(reason=reason))

        assert not mock_pool.updates_to("conversations")
        assert not mock_pool.calls_against("applications")
        assert not mock_pool.calls_against("loan_accounts")
        # No merged_into tombstone on the journey's customer, and no write of
        # any kind on the matched customer's row.
        assert not mock_pool.calls_against("customers")

    @pytest.mark.asyncio
    async def test_block_is_still_recorded_on_the_conversation(self, mock_pool) -> None:
        """The application shows as blocked for the reason, under its own customer."""
        await handle_reapplication_blocked(mock_pool, _blocked_event())

        conv = mock_pool.last_insert("conversations")
        assert conv["conversation_id"] == STOPPED_CONV
        assert conv["reapplication_block_reason"] == "ACTIVE_LOAN"
        assert conv["application_number"] == "A3CD3461-11F"
        # The row is seeded under the journey, never under the matched customer.
        assert conv["customer_id_string"] == JOURNEY
        # The matched customer is kept as a reference, with the band that says
        # identity was not proven.
        assert conv["reapplication_block_canonical_customer_id"] == MATCHED
        assert '"band": "verified_contact"' in conv["reapplication_block_recognition"]

    @pytest.mark.asyncio
    async def test_proven_block_with_the_same_reason_still_reattributes(self, mock_pool) -> None:
        """Without the band the existing behaviour is unchanged."""
        mock_pool.set_fetchval_sequence([None, "canon-ref", "alias-ref"])
        event = _blocked_event(
            recognition={"band": None, "posterior": None, "case_id": None, "candidates": []}
        )
        await handle_reapplication_blocked(mock_pool, event)

        moved = [
            c
            for c in _conversation_updates(mock_pool)
            if c.values.get("customer_id_string") == MATCHED
        ]
        assert moved and moved[-1].where["customer_id_string"] == JOURNEY
        mirror = mock_pool.last_insert("customers")
        assert mirror["customer_id"] == MATCHED
        assert mirror["reapplication_block_reason"] == "ACTIVE_LOAN"


def _cleared_event(**overrides: object) -> dict:
    payload = {
        "canonical_customer_id": MATCHED,
        "request_id": "req-dp-1",
        "cleared_reasons": ["DIFFERENT_PERSON"],
        "skipped_reasons": [],
        "cleared_at": "2026-11-11T09:00:00+00:00",
        "operator_id": "ops-7",
        "justification": "Recycled mobile number, different name and DOB",
        "version": 4,
        # The matched customer is STILL blocked for this reason.
        "prior_block_reason": "ACTIVE_LOAN",
        "approval": None,
        "stopped_conversation_id": STOPPED_CONV,
        "contact_kinds": ["phone"],
    }
    payload.update(overrides)
    return {
        "typ": "reapplication_block.cleared.v1",
        "conv": "ops:block-clear:req-dp-1",
        "usr": MATCHED,
        "payload": payload,
    }


class TestDifferentPersonCleared:
    @pytest.mark.asyncio
    async def test_stamps_only_the_stopped_conversation(self, mock_pool) -> None:
        """Who, when and why land on the stopped conversation and nowhere else."""
        await handle_reapplication_block_cleared(mock_pool, _cleared_event())

        updates = _conversation_updates(mock_pool)
        assert len(updates) == 1
        call = updates[0]
        assert "WHERE conversation_id = " in call.sql
        assert STOPPED_CONV in call.args
        assert "reapplication_block_recognition->>'band' = 'verified_contact'" in call.sql
        assert call.values["reapplication_block_clear_status"] == "cleared"
        assert call.values["reapplication_block_cleared_by"] == "ops-7"
        assert call.values["reapplication_block_clear_justification"] == (
            "Recycled mobile number, different name and DOB"
        )
        assert call.values["reapplication_block_clear_request_id"] == "req-dp-1"
        assert call.values["reapplication_block_cleared_at"] is not None
        assert call.values["reapplication_block_clear_rejection"] is None
        # The decline reason stays on the application's record.
        assert "reapplication_block_reason" not in call.values

    @pytest.mark.asyncio
    @pytest.mark.parametrize("prior", ["ACTIVE_LOAN", None])
    async def test_matched_customer_is_untouched(self, mock_pool, prior: str | None) -> None:
        """The matched customer stays blocked: no mirror write, no queue row.

        ``prior_block_reason`` None would read as "the reason is gone" to the
        ordinary clear and NULL the customer's block; it must not here.
        """
        await handle_reapplication_block_cleared(
            mock_pool, _cleared_event(prior_block_reason=prior)
        )

        assert not mock_pool.inserts_into("customers")
        assert not mock_pool.updates_to("customers")
        assert not mock_pool.updates_to("reapplication_block_clear_requests")

    @pytest.mark.asyncio
    async def test_falls_back_to_the_request_id_without_a_conversation(self, mock_pool) -> None:
        """A cleared event naming no conversation is matched by its request id."""
        await handle_reapplication_block_cleared(
            mock_pool, _cleared_event(stopped_conversation_id=None)
        )

        call = _conversation_updates(mock_pool)[-1]
        assert "WHERE reapplication_block_clear_request_id = " in call.sql
        assert not mock_pool.inserts_into("customers")


class TestOrdinaryClearSkipsContactMatchStops:
    @pytest.mark.asyncio
    async def test_cleared_excludes_contact_match_conversations(self, mock_pool) -> None:
        """Clearing the matched customer's own block does not stamp a stranger's
        stopped application as cleared."""
        event = {
            "typ": "reapplication_block.cleared.v1",
            "usr": MATCHED,
            "payload": {
                "canonical_customer_id": MATCHED,
                "request_id": "req-1",
                "cleared_reasons": ["SERVICEABILITY"],
                "prior_block_reason": "SERVICEABILITY",
                "cleared_at": "2026-06-28T01:00:00+00:00",
                "operator_id": "ops-1",
            },
        }
        await handle_reapplication_block_cleared(mock_pool, event)

        call = _conversation_updates(mock_pool)[-1]
        assert "WHERE reapplication_block_canonical_customer_id = " in call.sql
        assert "IS DISTINCT FROM 'verified_contact'" in call.sql
        # The ordinary path is otherwise unchanged.
        assert mock_pool.last_upsert("customers")["reapplication_block_reason"] is None
        assert mock_pool.last_update("reapplication_block_clear_requests")["status"] == "approved"

    @pytest.mark.asyncio
    async def test_rejected_excludes_contact_match_conversations(self, mock_pool) -> None:
        """An ordinary rejection keeps its behaviour and skips contact-match stops."""
        event = {
            "typ": "reapplication_block.clear_rejected.v1",
            "usr": MATCHED,
            "payload": {
                "canonical_customer_id": MATCHED,
                "request_id": "req-2",
                "rejected_reasons": ["PRIOR_DEFAULT"],
                "rejection_code": "APPROVAL_REQUIRED",
                "detail": "needs approval",
            },
        }
        await handle_reapplication_block_clear_rejected(mock_pool, event)

        call = _conversation_updates(mock_pool)[-1]
        assert "IS DISTINCT FROM 'verified_contact'" in call.sql
        assert mock_pool.last_upsert("customers")["reapplication_block_clear_status"] == "rejected"
        assert mock_pool.last_update("reapplication_block_clear_requests")["status"] == "rejected"


def _rejected_event(**overrides: object) -> dict:
    payload = {
        "canonical_customer_id": MATCHED,
        "request_id": "req-dp-2",
        "rejected_reasons": ["DIFFERENT_PERSON"],
        "rejection_code": "UNKNOWN_STOPPED_CONVERSATION",
        "detail": "no verified-contact stop is recorded for that conversation "
        "against this customer",
        "rejected_at": "2026-11-11T09:00:00+00:00",
    }
    payload.update(overrides)
    return {
        "typ": "reapplication_block.clear_rejected.v1",
        "conv": "ops:block-clear:req-dp-2",
        "usr": MATCHED,
        "payload": payload,
    }


class TestDifferentPersonRejected:
    @pytest.mark.asyncio
    async def test_stamps_the_conversation_waiting_on_the_request(self, mock_pool) -> None:
        """billieChat names only the request; the conversation is found by it."""
        mock_pool.set_fetchrow({"conversation_id": STOPPED_CONV})
        await handle_reapplication_block_clear_rejected(mock_pool, _rejected_event())

        lookup = [c for c in mock_pool.calls_against("conversations") if c.op == "SELECT"][-1]
        assert lookup.args == ("req-dp-2",)
        call = _conversation_updates(mock_pool)[-1]
        assert "WHERE conversation_id = " in call.sql
        assert STOPPED_CONV in call.args
        assert "IS DISTINCT FROM 'cleared'" in call.sql
        assert call.values["reapplication_block_clear_status"] == "rejected"
        assert call.values["reapplication_block_clear_request_id"] == "req-dp-2"
        assert call.values["reapplication_block_clear_rejection"].startswith(
            "UNKNOWN_STOPPED_CONVERSATION: no verified-contact stop"
        )
        # Nothing on the matched customer or the approvals queue.
        assert not _customer_writes(mock_pool)
        assert not mock_pool.updates_to("reapplication_block_clear_requests")

    @pytest.mark.asyncio
    async def test_uses_the_conversation_id_when_the_event_carries_one(self, mock_pool) -> None:
        """If billieChat echoes stopped_conversation_id, no lookup is needed."""
        await handle_reapplication_block_clear_rejected(
            mock_pool,
            _rejected_event(
                stopped_conversation_id=STOPPED_CONV,
                rejection_code="MISSING_FIELDS",
                detail="stopped_conversation_id is required for a DIFFERENT_PERSON clear",
            ),
        )

        assert not [c for c in mock_pool.calls_against("conversations") if c.op == "SELECT"]
        call = _conversation_updates(mock_pool)[-1]
        assert STOPPED_CONV in call.args
        assert call.values["reapplication_block_clear_rejection"].startswith("MISSING_FIELDS: ")

    @pytest.mark.asyncio
    async def test_unmatched_named_rejection_never_reaches_the_customer(self, mock_pool) -> None:
        """No conversation waiting on it: nothing is stamped, least of all the
        matched customer's row."""
        await handle_reapplication_block_clear_rejected(mock_pool, _rejected_event())

        assert not _conversation_updates(mock_pool)
        assert not _customer_writes(mock_pool)
        assert not mock_pool.updates_to("reapplication_block_clear_requests")

    @pytest.mark.asyncio
    async def test_rejection_naming_no_reasons_is_matched_by_request(self, mock_pool) -> None:
        """billieChat's first MISSING_FIELDS check sends ``rejected_reasons: []``."""
        mock_pool.set_fetchrow({"conversation_id": STOPPED_CONV})
        await handle_reapplication_block_clear_rejected(
            mock_pool,
            _rejected_event(rejected_reasons=[], rejection_code="MISSING_FIELDS", detail="x"),
        )

        assert _conversation_updates(mock_pool)[-1].values[
            "reapplication_block_clear_status"
        ] == "rejected"
        assert not _customer_writes(mock_pool)


class TestDifferentPersonClearRequested:
    EVENT = {
        "typ": "block_clear.different_person_requested.v1",
        "conv": "req-dp-3",
        "cause": "evt-1",
        "payload": {
            "conversationId": STOPPED_CONV,
            "canonicalCustomerId": MATCHED,
            "justification": "Different person, shared family email",
            "requestedBy": "ops-7",
            "requestedByName": "Op Seven",
        },
    }

    @pytest.mark.asyncio
    async def test_marks_the_stopped_conversation_pending(self, mock_pool) -> None:
        """Who asked and why are recorded, and the request id is tied to the row."""
        await handle_different_person_clear_requested(mock_pool, self.EVENT)

        call = _conversation_updates(mock_pool)[-1]
        assert call.values["reapplication_block_clear_status"] == "pending"
        assert call.args[:4] == (
            STOPPED_CONV,
            "req-dp-3",
            "ops-7",
            "Different person, shared family email",
        )
        # Only a contact-match stop, never over a clear, never twice for one request.
        assert "reapplication_block_recognition->>'band' = 'verified_contact'" in call.sql
        assert "reapplication_block_clear_status IS DISTINCT FROM 'cleared'" in call.sql
        assert "reapplication_block_clear_request_id IS DISTINCT FROM $2" in call.sql
        assert not mock_pool.calls_against("customers")

    @pytest.mark.asyncio
    async def test_string_payload_parsed_defensively(self, mock_pool) -> None:
        """The payload may arrive JSON-encoded."""
        import json

        event = dict(self.EVENT, payload=json.dumps(self.EVENT["payload"]))
        await handle_different_person_clear_requested(mock_pool, event)
        assert _conversation_updates(mock_pool)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("missing", ["conv", "conversationId"])
    async def test_ignored_without_request_or_conversation(self, mock_pool, missing: str) -> None:
        """Nothing to tie together: no write."""
        event = dict(self.EVENT, payload=dict(self.EVENT["payload"]))
        if missing == "conv":
            event["conv"] = ""
        else:
            event["payload"].pop("conversationId")
        await handle_different_person_clear_requested(mock_pool, event)
        assert not mock_pool.calls_against("conversations")


def test_request_event_is_registered(monkeypatch) -> None:
    """setup_handlers wires the CRM's own different-person request event."""
    import sys
    import types

    if "billie_notifications_events" not in sys.modules:
        parent = types.ModuleType("billie_notifications_events")
        submod = types.ModuleType("billie_notifications_events.parser")
        submod.parse_notification_event = lambda *a, **k: None
        parent.parser = submod
        monkeypatch.setitem(sys.modules, "billie_notifications_events", parent)
        monkeypatch.setitem(sys.modules, "billie_notifications_events.parser", submod)
    if "billie_aging_events" not in sys.modules:
        aging = types.ModuleType("billie_aging_events")
        aging.parse_aging_event = lambda *a, **k: None
        monkeypatch.setitem(sys.modules, "billie_aging_events", aging)

    import billie_servicing.processor as procmod
    from billie_servicing.main import setup_handlers

    monkeypatch.setattr(procmod, "_check_tls_urls", lambda *a, **k: None)
    proc = procmod.EventProcessor(
        redis_url="redis://localhost:6379",
        database_uri="postgresql://localhost/test",
    )
    setup_handlers(proc)
    assert "block_clear.different_person_requested.v1" in proc.handlers
