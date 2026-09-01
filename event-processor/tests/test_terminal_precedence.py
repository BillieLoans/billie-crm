"""The terminal-state ladder: hard_end > cancelled > expired.

Prod 2026-08-28: conversation 2cf3919d took a customer decline at 01:37 and a
system session_timeout for the SAME application at 02:36, because the decline
path never cleared the offer-expiry timer. The same hazard applies to a killed
conversation with a live offer — and there, a downgrade would mask a fraud stop
(fraud auto-stop is ENFORCING in prod: 0283068c, 8bd3d09f).
"""
import json

import pytest

from billie_servicing.handlers.cancellation import terminal_rank
from billie_servicing.handlers.conversation import (
    handle_conversation_killed,
    handle_final_decision,
)

CONV = "9a1fe3c2-0d6b-4091-8a3a-6c148a4c4142"


class TestTerminalRank:
    def test_ladder_order(self):
        assert terminal_rank("hard_end") > terminal_rank("cancelled")
        assert terminal_rank("cancelled") > terminal_rank("expired")
        assert terminal_rank("expired") > terminal_rank("approved")

    @pytest.mark.parametrize(
        "status", ["active", "paused", "soft_end", "approved", "declined", None, ""]
    )
    def test_non_terminal_statuses_rank_zero(self, status):
        assert terminal_rank(status) == 0


def _kill_event(reason_category):
    return {
        "typ": "conversation.killed.v1",
        "conv": CONV,
        "usr": "CUST1",
        "payload": {
            "request_id": "req-9",
            "conversation_id": CONV,
            "application_number": "APP-1",
            "reason_category": reason_category,
            "note": "n",
            "actor": "user:42",
            "killed_at": "2026-08-28T05:00:00+00:00",
        },
    }


def _row(status=None, record=None):
    return {"status": status, "cancellation_record": json.dumps(record) if record else None}


class TestKillProjection:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("category", ["fraud_abuse", "operational", "compliance"])
    async def test_operator_and_fraud_kills_stay_hard_end(self, mock_pool, category):
        mock_pool.set_fetchrow(_row(status="active"))
        await handle_conversation_killed(mock_pool, _kill_event(category))
        update = mock_pool.last_update("conversations")
        assert update["status"] == "hard_end"
        assert "cancellation_record" not in update

    @pytest.mark.asyncio
    async def test_customer_request_projects_as_cancelled(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="active"))
        await handle_conversation_killed(mock_pool, _kill_event("customer_request"))
        update = mock_pool.last_update("conversations")
        assert update["status"] == "cancelled"
        record = json.loads(update["cancellation_record"])
        assert record["category"] == "customer_declined"
        assert record["reason"] == "customer_request"
        assert record["source_event"] == "conversation.killed.v1"

    @pytest.mark.asyncio
    async def test_customer_request_still_writes_the_kill_record(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="active"))
        await handle_conversation_killed(mock_pool, _kill_event("customer_request"))
        record = json.loads(mock_pool.last_update("conversations")["kill_record"])
        assert record["actor"] == "user:42"

    @pytest.mark.asyncio
    async def test_customer_request_does_not_downgrade_a_fraud_kill(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="hard_end"))
        await handle_conversation_killed(mock_pool, _kill_event("customer_request"))
        assert mock_pool.last_update("conversations") is None

    @pytest.mark.asyncio
    async def test_fraud_kill_overrides_an_earlier_cancellation(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="cancelled", record={"category": "customer_declined"}))
        await handle_conversation_killed(mock_pool, _kill_event("fraud_abuse"))
        assert mock_pool.last_update("conversations")["status"] == "hard_end"


class TestFinalDecisionDoesNotClobber:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("terminal", ["cancelled", "expired", "hard_end"])
    async def test_redelivered_decision_keeps_terminal_status(self, mock_pool, terminal):
        """At-least-once redelivery must not reset a terminal conversation to
        approved — that is the original bug, and for hard_end it would unmask a
        fraud stop.

        ``upsert_conversation`` always lists ``status`` in the INSERT half with
        its default (only a brand-new row takes it), so the projection semantics
        live in the ON CONFLICT SET clause — that is what must omit status.
        """
        mock_pool.set_fetchrow(_row(status=terminal))
        await handle_final_decision(
            mock_pool,
            {"typ": "final_credit_decision", "conv": CONV, "payload": {"decision": "APPROVED"}},
        )
        upserts = [c for c in mock_pool.calls_against("conversations") if c.op == "INSERT"]
        assert len(upserts) == 1
        assert "status = EXCLUDED.status" not in upserts[0].sql
        assert upserts[0].values["decision_status"] == "approved"
        assert upserts[0].values["final_decision"] == "APPROVED"

    @pytest.mark.asyncio
    async def test_decision_sets_status_when_not_terminal(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="active"))
        await handle_final_decision(
            mock_pool,
            {"typ": "final_credit_decision", "conv": CONV, "payload": {"decision": "APPROVED"}},
        )
        upserts = [c for c in mock_pool.calls_against("conversations") if c.op == "INSERT"]
        assert "status = EXCLUDED.status" in upserts[0].sql
        assert upserts[0].values["status"] == "approved"
