"""Tests for the conversation.killed.v1 projection handler."""
import json

import pytest

from billie_servicing.handlers.conversation import handle_conversation_killed

CONV = "9a1fe3c2-0d6b-4091-8a3a-6c148a4c4142"

KILLED_PAYLOAD = {
    "request_id": "req-9",
    "conversation_id": CONV,
    "application_number": "APP-1",
    "customer_id": "CUST1",
    "reason_category": "fraud_abuse",
    "note": "live abuse",
    "actor": "user:42",
    "killed_at": "2026-08-24T05:00:00+00:00",
}


def _event(payload=None):
    return {"typ": "conversation.killed.v1", "usr": "CUST1", "conv": CONV,
            "payload": dict(payload or KILLED_PAYLOAD)}


class TestConversationKilled:
    @pytest.mark.asyncio
    async def test_sets_hard_end_and_kill_record(self, mock_pool):
        mock_pool.set_fetchrow({"status": "active", "cancellation_record": None})
        await handle_conversation_killed(mock_pool, _event())
        updates = [c for c in mock_pool.calls_against("conversations")
                   if c.op == "UPDATE" and "kill_record" in c.values]
        assert len(updates) == 1
        call = updates[0]
        assert call.values["status"] == "hard_end"
        record = json.loads(call.args[1])
        assert record["actor"] == "user:42"
        assert record["reason_category"] == "fraud_abuse"
        assert record["request_id"] == "req-9"
        assert record["killed_at"] == "2026-08-24T05:00:00+00:00"
        assert call.where.get("conversation_id") == CONV

    @pytest.mark.asyncio
    async def test_update_only_and_version_bump(self, mock_pool):
        mock_pool.set_fetchrow({"status": "active", "cancellation_record": None})
        await handle_conversation_killed(mock_pool, _event())
        updates = [c for c in mock_pool.calls if c.op == "UPDATE"]
        assert len(updates) == 1
        assert "version = COALESCE(version, 1) + 1" in updates[0].sql
        assert not mock_pool.inserts_into("conversations")

    @pytest.mark.asyncio
    async def test_unknown_conversation_skips(self, mock_pool):
        """Update-only: a kill for a conversation the CRM never saw writes nothing."""
        mock_pool.set_fetchrow(None)
        await handle_conversation_killed(mock_pool, _event())
        assert not mock_pool.updates_to("conversations")

    @pytest.mark.asyncio
    async def test_missing_conversation_id_skips(self, mock_pool):
        payload = dict(KILLED_PAYLOAD)
        payload.pop("conversation_id")
        event = {"typ": "conversation.killed.v1", "payload": payload}
        await handle_conversation_killed(mock_pool, event)
        assert not mock_pool.calls


class TestLinguistClose:
    """billieChat's summariser reports a linguist ``e="Y"`` close as the same
    ``conversation.killed.v1`` fact an operator kill produces, with a system
    actor and reason_category ``conversation_policy`` (PROD 2026-09-07,
    application 999549AA-6C1 — the conversation stayed "Active" with no
    reason because nothing routable carried the close). This pins the
    contract: it lands ``hard_end`` (not ``cancelled``) and keeps the note.
    """

    LINGUIST_PAYLOAD = {
        "request_id": "linguist-end:%s:2" % CONV,
        "conversation_id": CONV,
        "application_number": "999549AA-6C1",
        "customer_id": "4ECFB177",
        "reason_category": "conversation_policy",
        "note": "Customer asks about internal workings.",
        "actor": "system:customerLiaisonAgent",
        "killed_at": "2026-09-07T04:39:55+00:00",
    }

    @pytest.mark.asyncio
    async def test_linguist_close_lands_hard_end_with_the_reason(self, mock_pool):
        mock_pool.set_fetchrow({"status": "active", "cancellation_record": None})
        await handle_conversation_killed(mock_pool, _event(self.LINGUIST_PAYLOAD))
        updates = [c for c in mock_pool.calls_against("conversations")
                   if c.op == "UPDATE" and "kill_record" in c.values]
        assert len(updates) == 1
        call = updates[0]
        assert call.values["status"] == "hard_end"
        record = json.loads(call.args[1])
        assert record["actor"] == "system:customerLiaisonAgent"
        assert record["reason_category"] == "conversation_policy"
        assert record["note"] == "Customer asks about internal workings."
        assert record["request_id"] == "linguist-end:%s:2" % CONV

    @pytest.mark.asyncio
    async def test_linguist_close_redelivery_is_idempotent(self, mock_pool):
        """Same (conversation, seq) request id twice → the second write is a no-op."""
        mock_pool.set_fetchrow({"status": "hard_end", "cancellation_record": None,
                                "kill_record": json.dumps(self.LINGUIST_PAYLOAD)})
        await handle_conversation_killed(mock_pool, _event(self.LINGUIST_PAYLOAD))
        # A hard_end row re-receiving a hard_end kill may be re-written with an
        # identical record; what must never happen is a downgrade or an insert.
        for values in mock_pool.updates_to("conversations"):
            assert values.get("status") in (None, "hard_end")
        assert not mock_pool.inserts_into("conversations")

