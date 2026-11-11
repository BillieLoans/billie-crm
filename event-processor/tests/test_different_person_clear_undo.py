"""Undo of a "different person" clear on a verified-contact stop (BTB-569).

Support cleared a contact match as a different person, and the applicant then
turned out to be the earlier customer after all. The CRM sends
``reapplication_block.clear_revoke_authorized.v1``; billieChat answers with
``reapplication_block.clear_revoked.v1`` or ``clear_revoke_rejected.v1``. Both
answers, and the CRM's own request record, must land on the one stopped
conversation and never on the matched customer.

The two prod consumers deliver these in any order, so the statements order a
clear against an undo by billieChat's own ``cleared_at`` / ``revoked_at``.
The mock pool records SQL, so these tests pin the statements' conditions; the
columns they name are pinned against the real schema by
``tests/int/different-person-clear-undo-columns.int.spec.ts``.
"""

from __future__ import annotations

import json
from datetime import datetime

import pytest

from billie_servicing.handlers.reapplication import (
    handle_different_person_clear_revoke_requested,
    handle_reapplication_block_clear_revoke_rejected,
    handle_reapplication_block_clear_revoked,
    handle_reapplication_block_cleared,
)

MATCHED = "22F0652F"
STOPPED_CONV = "7d5ee9c2-dd6b-4091-8a3a-6c148a4c4142"
IS_CONTACT_MATCH = "reapplication_block_recognition->>'band' = 'verified_contact'"


def _conversation_updates(mock_pool) -> list:
    return [c for c in mock_pool.calls_against("conversations") if c.op == "UPDATE"]


def _customer_writes(mock_pool) -> list:
    """Every INSERT / UPDATE on customers (resolving a merged id is a read)."""
    return [c for c in mock_pool.calls_against("customers") if c.op != "SELECT"]


def _other_table_calls(mock_pool) -> list:
    return [c for c in mock_pool.calls if c.table not in (None, "conversations")]


def _revoked_event(**overrides: object) -> dict:
    payload = {
        "canonical_customer_id": MATCHED,
        "request_id": "req-undo-1",
        "operator_id": "ops-9",
        "justification": "Same person after all: matching licence on the new application",
        "revoked_reasons": ["DIFFERENT_PERSON"],
        "stopped_conversation_id": STOPPED_CONV,
        "contact_kinds": ["phone"],
        "revoked_at": "2026-11-12T03:00:00+00:00",
    }
    payload.update(overrides)
    return {
        "typ": "reapplication_block.clear_revoked.v1",
        "conv": "ops:block-clear:req-undo-1",
        "usr": MATCHED,
        "payload": payload,
    }


class TestClearRevoked:
    @pytest.mark.asyncio
    async def test_unclears_only_the_stopped_conversation(self, mock_pool) -> None:
        """The stop is uncleared again, with who undid it, when and why."""
        await handle_reapplication_block_clear_revoked(mock_pool, _revoked_event())

        updates = _conversation_updates(mock_pool)
        assert len(updates) == 1
        call = updates[0]
        assert "WHERE conversation_id = $1" in call.sql
        assert IS_CONTACT_MATCH in call.sql
        assert call.args[0] == STOPPED_CONV
        assert call.args[1] == "req-undo-1"
        assert call.args[2] == datetime.fromisoformat("2026-11-12T03:00:00+00:00")
        assert call.args[3] == "ops-9"
        assert call.args[4].startswith("Same person after all")
        assert "reapplication_block_clear_revoke_status = 'revoked'" in call.sql
        assert "reapplication_block_clear_revoke_rejection = NULL" in call.sql
        # The decline reason and the matched customer's id stay on the record.
        assert "reapplication_block_reason =" not in call.sql
        assert "reapplication_block_canonical_customer_id =" not in call.sql

    @pytest.mark.asyncio
    async def test_matched_customer_and_other_tables_are_untouched(self, mock_pool) -> None:
        """No write on the matched customer's row, the queue, or anything else."""
        await handle_reapplication_block_clear_revoked(mock_pool, _revoked_event())

        assert not _customer_writes(mock_pool)
        assert not _other_table_calls(mock_pool)

    @pytest.mark.asyncio
    async def test_only_a_clear_made_before_the_undo_is_removed(self, mock_pool) -> None:
        """A late undo must not un-clear a newer clear."""
        await handle_reapplication_block_clear_revoked(mock_pool, _revoked_event())

        sql = " ".join(_conversation_updates(mock_pool)[-1].sql.split())
        removes = (
            "(reapplication_block_clear_status = 'cleared' "
            "AND (reapplication_block_cleared_at IS NULL "
            "OR reapplication_block_cleared_at < $3::timestamptz))"
        )
        assert (
            f"reapplication_block_clear_status = CASE WHEN {removes} THEN NULL "
            "ELSE reapplication_block_clear_status END"
        ) in sql
        # The clear-audit columns are emptied on the same condition...
        assert (
            f"reapplication_block_cleared_at = CASE WHEN {removes} THEN NULL "
            "ELSE reapplication_block_cleared_at END"
        ) in sql
        # ...after the clear they held is filed as the undone clear.
        assert (
            f"reapplication_block_revoked_clear_at = CASE WHEN {removes} "
            "THEN reapplication_block_cleared_at ELSE NULL END"
        ) in sql
        assert (
            f"reapplication_block_revoked_clear_by = CASE WHEN {removes} "
            "THEN reapplication_block_cleared_by ELSE NULL END"
        ) in sql
        assert (
            f"reapplication_block_revoked_clear_justification = CASE WHEN {removes} "
            "THEN reapplication_block_clear_justification ELSE NULL END"
        ) in sql
        # The request id of the removed clear stays, so its own request record
        # arriving late cannot mark the stop pending again.
        assert "reapplication_block_clear_request_id =" not in sql

    @pytest.mark.asyncio
    async def test_newest_undo_wins_and_a_redelivery_is_a_no_op(self, mock_pool) -> None:
        """An undo no newer than the one on the row changes nothing."""
        await handle_reapplication_block_clear_revoked(mock_pool, _revoked_event())

        sql = " ".join(_conversation_updates(mock_pool)[-1].sql.split())
        assert (
            "AND (reapplication_block_clear_revoked_at IS NULL "
            "OR reapplication_block_clear_revoked_at < $3::timestamptz)"
        ) in sql

    @pytest.mark.asyncio
    async def test_falls_back_to_the_request_id_without_a_conversation(self, mock_pool) -> None:
        """An event naming no conversation is matched by the undo's request id."""
        await handle_reapplication_block_clear_revoked(
            mock_pool, _revoked_event(stopped_conversation_id=None)
        )

        call = _conversation_updates(mock_pool)[-1]
        assert "WHERE reapplication_block_clear_revoke_request_id = $1" in call.sql
        assert call.args[0] == "req-undo-1"
        assert IS_CONTACT_MATCH in call.sql

    @pytest.mark.asyncio
    @pytest.mark.parametrize("reasons", [None, [], ["SERVICEABILITY"], "DIFFERENT"])
    async def test_ignored_unless_it_names_different_person(
        self, mock_pool, reasons: object
    ) -> None:
        """Nothing else can be undone, and nothing reaches a customer row."""
        await handle_reapplication_block_clear_revoked(
            mock_pool, _revoked_event(revoked_reasons=reasons)
        )
        assert not mock_pool.calls

    @pytest.mark.asyncio
    async def test_ignored_when_it_names_neither_conversation_nor_request(self, mock_pool) -> None:
        """Nothing to find the row by: no write."""
        await handle_reapplication_block_clear_revoked(
            mock_pool, _revoked_event(stopped_conversation_id=None, request_id=None)
        )
        assert not mock_pool.calls

    @pytest.mark.asyncio
    @pytest.mark.parametrize("revoked_at", [None, "not a date"])
    async def test_missing_time_falls_back_to_now(self, mock_pool, revoked_at: object) -> None:
        """The undo is still applied, ordered by when it was seen."""
        await handle_reapplication_block_clear_revoked(
            mock_pool, _revoked_event(revoked_at=revoked_at)
        )
        stamped = _conversation_updates(mock_pool)[-1].args[2]
        assert isinstance(stamped, datetime) and stamped.tzinfo is not None

    @pytest.mark.asyncio
    async def test_string_payload_parsed_defensively(self, mock_pool) -> None:
        """The payload may arrive JSON-encoded."""
        event = _revoked_event()
        event["payload"] = json.dumps(event["payload"])
        await handle_reapplication_block_clear_revoked(mock_pool, event)
        assert _conversation_updates(mock_pool)[-1].args[0] == STOPPED_CONV


class TestClearedAfterAnUndo:
    """The other half of the ordering: ``cleared.v1`` against a recorded undo."""

    EVENT = {
        "typ": "reapplication_block.cleared.v1",
        "conv": "ops:block-clear:req-dp-1",
        "usr": MATCHED,
        "payload": {
            "canonical_customer_id": MATCHED,
            "request_id": "req-dp-1",
            "cleared_reasons": ["DIFFERENT_PERSON"],
            "cleared_at": "2026-11-11T09:00:00+00:00",
            "operator_id": "ops-7",
            "justification": "Recycled mobile number, different name and DOB",
            "prior_block_reason": "ACTIVE_LOAN",
            "stopped_conversation_id": STOPPED_CONV,
        },
    }

    STANDS = (
        "(reapplication_block_clear_revoked_at IS NULL OR $3::timestamptz IS NULL "
        "OR reapplication_block_clear_revoked_at < $3::timestamptz)"
    )

    @pytest.mark.asyncio
    async def test_a_clear_overtaken_by_an_undo_does_not_come_back(self, mock_pool) -> None:
        """A late or redelivered clear stands only if no undo was made at or after it."""
        await handle_reapplication_block_cleared(mock_pool, self.EVENT)

        sql = " ".join(_conversation_updates(mock_pool)[-1].sql.split())
        assert (
            f"reapplication_block_clear_status = CASE WHEN {self.STANDS} THEN 'cleared' "
            "WHEN reapplication_block_clear_status = 'pending' "
            "AND reapplication_block_clear_request_id = $2::text THEN NULL "
            "ELSE reapplication_block_clear_status END"
        ) in sql
        for column, value in [
            ("reapplication_block_cleared_at", "$3::timestamptz"),
            ("reapplication_block_cleared_by", "$4::text"),
            ("reapplication_block_clear_justification", "$5::text"),
            ("reapplication_block_clear_request_id", "$2::text"),
            ("reapplication_block_clear_rejection", "NULL"),
        ]:
            assert f"{column} = CASE WHEN {self.STANDS} THEN {value} ELSE {column} END" in sql

    @pytest.mark.asyncio
    async def test_an_overtaken_clear_is_filed_as_the_undone_clear(self, mock_pool) -> None:
        """The undo arrived first: the clear it removed is still kept on record."""
        await handle_reapplication_block_cleared(mock_pool, self.EVENT)

        sql = " ".join(_conversation_updates(mock_pool)[-1].sql.split())
        undone = (
            "(reapplication_block_clear_revoked_at >= $3::timestamptz "
            "AND (reapplication_block_revoked_clear_at IS NULL "
            "OR reapplication_block_revoked_clear_at <= $3::timestamptz))"
        )
        for column, value in [
            ("reapplication_block_revoked_clear_at", "$3::timestamptz"),
            ("reapplication_block_revoked_clear_by", "$4::text"),
            ("reapplication_block_revoked_clear_justification", "$5::text"),
        ]:
            assert f"{column} = CASE WHEN {undone} THEN {value} ELSE {column} END" in sql

    @pytest.mark.asyncio
    async def test_the_clear_never_writes_the_undo_record(self, mock_pool) -> None:
        """A new clear leaves who undid the earlier one, when and why."""
        await handle_reapplication_block_cleared(mock_pool, self.EVENT)

        sql = _conversation_updates(mock_pool)[-1].sql
        for column in (
            "reapplication_block_clear_revoke_status",
            "reapplication_block_clear_revoke_request_id",
            "reapplication_block_clear_revoked_at",
            "reapplication_block_clear_revoked_by",
            "reapplication_block_clear_revoke_justification",
        ):
            assert f"{column} =" not in sql
        assert not _customer_writes(mock_pool)


def _revoke_rejected_event(**overrides: object) -> dict:
    payload = {
        "canonical_customer_id": MATCHED,
        "request_id": "req-undo-2",
        "rejected_reasons": ["DIFFERENT_PERSON"],
        "rejection_code": "NOT_CLEARED",
        "detail": "no different-person clear is in effect for that conversation",
        "rejected_at": "2026-11-12T03:00:00+00:00",
        "stopped_conversation_id": STOPPED_CONV,
    }
    payload.update(overrides)
    return {
        "typ": "reapplication_block.clear_revoke_rejected.v1",
        "conv": "ops:block-clear:req-undo-2",
        "usr": MATCHED,
        "payload": payload,
    }


class TestClearRevokeRejected:
    @pytest.mark.asyncio
    async def test_records_the_refusal_and_leaves_the_clear(self, mock_pool) -> None:
        """Only the undo's own status, request id and reason are written."""
        await handle_reapplication_block_clear_revoke_rejected(
            mock_pool, _revoke_rejected_event()
        )

        assert not [c for c in mock_pool.calls_against("conversations") if c.op == "SELECT"]
        updates = _conversation_updates(mock_pool)
        assert len(updates) == 1
        call = updates[0]
        assert call.args[0] == STOPPED_CONV
        assert call.args[1] == "req-undo-2"
        assert call.args[2] == (
            "NOT_CLEARED: no different-person clear is in effect for that conversation"
        )
        assert call.args[3] == datetime.fromisoformat("2026-11-12T03:00:00+00:00")
        assert IS_CONTACT_MATCH in call.sql
        assert set(call.values) == {
            "reapplication_block_clear_revoke_status",
            "reapplication_block_clear_revoke_request_id",
            "reapplication_block_clear_revoke_rejection",
            "updated_at",
        }
        assert call.values["reapplication_block_clear_revoke_status"] == "rejected"
        assert not _customer_writes(mock_pool)
        assert not _other_table_calls(mock_pool)

    @pytest.mark.asyncio
    async def test_never_replaces_an_applied_undo_it_does_not_follow(self, mock_pool) -> None:
        """Not the same request's applied undo, nor one applied at or after it."""
        await handle_reapplication_block_clear_revoke_rejected(
            mock_pool, _revoke_rejected_event()
        )

        sql = " ".join(_conversation_updates(mock_pool)[-1].sql.split())
        assert (
            "AND (reapplication_block_clear_revoke_status IS DISTINCT FROM 'revoked' "
            "OR (reapplication_block_clear_revoke_request_id IS DISTINCT FROM $2::text "
            "AND reapplication_block_clear_revoked_at < $4::timestamptz))"
        ) in sql

    @pytest.mark.asyncio
    async def test_finds_the_conversation_by_request_when_none_is_named(self, mock_pool) -> None:
        """``MISSING_FIELDS`` for a missing conversation id names only the request."""
        mock_pool.set_fetchrow({"conversation_id": STOPPED_CONV})
        await handle_reapplication_block_clear_revoke_rejected(
            mock_pool,
            _revoke_rejected_event(
                stopped_conversation_id=None,
                rejection_code="MISSING_FIELDS",
                detail="stopped_conversation_id is required",
            ),
        )

        lookup = [c for c in mock_pool.calls_against("conversations") if c.op == "SELECT"][-1]
        assert lookup.args == ("req-undo-2",)
        assert "reapplication_block_clear_revoke_request_id = $1" in lookup.sql
        assert IS_CONTACT_MATCH in lookup.sql
        call = _conversation_updates(mock_pool)[-1]
        assert call.args[0] == STOPPED_CONV
        assert call.args[2] == "MISSING_FIELDS: stopped_conversation_id is required"

    @pytest.mark.asyncio
    async def test_nothing_is_written_when_no_conversation_is_waiting(self, mock_pool) -> None:
        """No conversation named and none waiting on the request: no write at all."""
        await handle_reapplication_block_clear_revoke_rejected(
            mock_pool, _revoke_rejected_event(stopped_conversation_id=None)
        )

        assert not _conversation_updates(mock_pool)
        assert not _customer_writes(mock_pool)

    @pytest.mark.asyncio
    async def test_code_without_detail_and_missing_time(self, mock_pool) -> None:
        """The code alone is kept; a missing time is passed as NULL."""
        await handle_reapplication_block_clear_revoke_rejected(
            mock_pool,
            _revoke_rejected_event(
                rejection_code="UNKNOWN_STOPPED_CONVERSATION", detail=None, rejected_at=None
            ),
        )
        call = _conversation_updates(mock_pool)[-1]
        assert call.args[2] == "UNKNOWN_STOPPED_CONVERSATION"
        assert call.args[3] is None


class TestClearRevokeRequested:
    EVENT = {
        "typ": "block_clear.different_person_revoke_requested.v1",
        "conv": "req-undo-3",
        "cause": "evt-1",
        "payload": {
            "conversationId": STOPPED_CONV,
            "canonicalCustomerId": MATCHED,
            "justification": "Same person after all",
            "requestedBy": "ops-9",
            "requestedByName": "Op Nine",
            "clearRequestId": "req-dp-1",
        },
    }

    @pytest.mark.asyncio
    async def test_marks_the_undo_pending_on_a_cleared_stop(self, mock_pool) -> None:
        """The request id is tied to the row; the clear stays in effect."""
        await handle_different_person_clear_revoke_requested(mock_pool, self.EVENT)

        updates = _conversation_updates(mock_pool)
        assert len(updates) == 1
        call = updates[0]
        assert call.args[:2] == (STOPPED_CONV, "req-undo-3")
        assert set(call.values) == {
            "reapplication_block_clear_revoke_status",
            "reapplication_block_clear_revoke_request_id",
            "reapplication_block_clear_revoke_rejection",
            "updated_at",
        }
        assert call.values["reapplication_block_clear_revoke_status"] == "pending"
        assert call.values["reapplication_block_clear_revoke_request_id"] == "req-undo-3"
        # Only a contact-match stop, only while cleared, never twice for one
        # request (so never after that request's own answer).
        assert IS_CONTACT_MATCH in call.sql
        assert "reapplication_block_clear_status = 'cleared'" in call.sql
        assert "reapplication_block_clear_revoke_request_id IS DISTINCT FROM $2" in call.sql
        assert not mock_pool.calls_against("customers")

    @pytest.mark.asyncio
    async def test_string_payload_parsed_defensively(self, mock_pool) -> None:
        """The payload may arrive JSON-encoded."""
        event = dict(self.EVENT, payload=json.dumps(self.EVENT["payload"]))
        await handle_different_person_clear_revoke_requested(mock_pool, event)
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
        await handle_different_person_clear_revoke_requested(mock_pool, event)
        assert not mock_pool.calls_against("conversations")


def test_undo_events_are_registered(monkeypatch) -> None:
    """setup_handlers wires the undo request record and both of billieChat's answers."""
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
    from billie_servicing.handlers import reapplication
    from billie_servicing.main import setup_handlers

    monkeypatch.setattr(procmod, "_check_tls_urls", lambda *a, **k: None)
    proc = procmod.EventProcessor(
        redis_url="redis://localhost:6379",
        database_uri="postgresql://localhost/test",
    )
    setup_handlers(proc)
    assert proc.handlers["block_clear.different_person_revoke_requested.v1"] is (
        reapplication.handle_different_person_clear_revoke_requested
    )
    assert proc.handlers["reapplication_block.clear_revoked.v1"] is (
        reapplication.handle_reapplication_block_clear_revoked
    )
    assert proc.handlers["reapplication_block.clear_revoke_rejected.v1"] is (
        reapplication.handle_reapplication_block_clear_revoke_rejected
    )
