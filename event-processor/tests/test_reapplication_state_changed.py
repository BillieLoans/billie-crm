"""reapplication_block.state.changed.v1 → customer-level block mirror (version-guarded).

Emitted by billieChat whenever the evaluated block decision changes — no customer
interaction needed. The CRM mirrors it onto ``customers.reapplication_block_*``
only when the event's ``state_version`` is newer than the stored one, and never
touches the conversation-level decline history or the clear audit stamps.
"""

from __future__ import annotations

import json

from billie_servicing.handlers.reapplication import (
    STATE_VERSION_GUARD,
    handle_reapplication_block_state_changed,
)

CANONICAL = "B81FC35E"


def _event(**overrides):
    payload = {
        "canonical_customer_id": CANONICAL,
        "state_version": 7,
        "blocked": True,
        "reason": "ACCOUNT_CONDUCT",
        "blocked_until": "2027-08-20T23:16:24+00:00",
        "source_application_number": "32B94F53-4CC",
        "source_account_id": None,
        "source_decided_at": "2026-08-20T23:16:24+00:00",
        "previous": {"reason": None, "blocked_until": None},
        "cause": {
            "event_type": "credit_assessment_accountConduct_result",
            "event_id": "evt-1",
            "conv": "c1",
        },
        "changed_at": "2026-08-20T23:16:25+00:00",
    }
    payload.update(overrides)
    return {
        "typ": "reapplication_block.state.changed.v1",
        "usr": payload["canonical_customer_id"],
        "conv": "c1",
        "seq": 4,
        "payload": payload,
    }


class TestBlocked:
    async def test_mirrors_current_decision(self, mock_pool):
        await handle_reapplication_block_state_changed(mock_pool, _event())
        row = mock_pool.last_upsert("customers")
        assert row["customer_id"] == CANONICAL
        assert row["reapplication_block_reason"] == "ACCOUNT_CONDUCT"
        assert row["reapplication_block_blocked_until"] is not None
        assert row["reapplication_block_application_number"] == "32B94F53-4CC"
        assert row["reapplication_block_blocked_at"] is not None
        assert row["reapplication_block_state_version"] == 7
        assert row["reapplication_block_state_changed_at"] is not None

    async def test_upsert_is_version_guarded(self, mock_pool):
        await handle_reapplication_block_state_changed(mock_pool, _event())
        sql = mock_pool.calls_against("customers")[-1].sql
        assert sql.endswith(f"WHERE {STATE_VERSION_GUARD}")
        assert "ON CONFLICT (customer_id)" in sql
        assert "< EXCLUDED.reapplication_block_state_version" in STATE_VERSION_GUARD
        assert "reapplication_block_state_changed_at IS NULL" in STATE_VERSION_GUARD
        assert "> customers.reapplication_block_state_changed_at" in STATE_VERSION_GUARD

    async def test_does_not_touch_clear_audit_or_conversations(self, mock_pool):
        await handle_reapplication_block_state_changed(mock_pool, _event())
        row = mock_pool.last_upsert("customers")
        assert "reapplication_block_clear_status" not in row
        assert "reapplication_block_cleared_at" not in row
        assert not mock_pool.has_call_against("conversations")


class TestUnblocked:
    async def test_nulls_current_state_but_keeps_blocked_at(self, mock_pool):
        await handle_reapplication_block_state_changed(
            mock_pool,
            _event(
                blocked=False,
                reason=None,
                blocked_until=None,
                source_application_number=None,
                previous={
                    "reason": "ACCOUNT_CONDUCT",
                    "blocked_until": "2027-08-20T23:16:24+00:00",
                },
            ),
        )
        row = mock_pool.last_upsert("customers")
        assert row["reapplication_block_reason"] is None
        assert row["reapplication_block_blocked_until"] is None
        assert row["reapplication_block_application_number"] is None
        assert "reapplication_block_blocked_at" not in row
        assert row["reapplication_block_state_version"] == 7
        assert row["reapplication_block_state_changed_at"] is not None

    async def test_blocked_false_ignores_stray_reason(self, mock_pool):
        """blocked=false with a reason attached must still read as unblocked."""
        await handle_reapplication_block_state_changed(mock_pool, _event(blocked=False))
        assert mock_pool.last_upsert("customers")["reapplication_block_reason"] is None


class TestGuards:
    async def test_missing_state_version_is_ignored(self, mock_pool):
        await handle_reapplication_block_state_changed(mock_pool, _event(state_version=None))
        assert not mock_pool.has_call_against("customers")

    async def test_non_integer_state_version_is_ignored(self, mock_pool):
        await handle_reapplication_block_state_changed(mock_pool, _event(state_version="seven"))
        assert not mock_pool.has_call_against("customers")

    async def test_no_customer_id_is_noop(self, mock_pool):
        event = _event()
        event["payload"]["canonical_customer_id"] = None
        event["usr"] = None
        await handle_reapplication_block_state_changed(mock_pool, event)
        assert not mock_pool.has_call_against("customers")

    async def test_guard_rejection_is_not_an_error(self, mock_pool):
        """asyncpg reports 'INSERT 0 0' when the version guard rejects the write —
        the handler logs at INFO and returns; nothing is raised or retried."""
        mock_pool.connection.execute.side_effect = None
        mock_pool.connection.execute.return_value = "INSERT 0 0"
        await handle_reapplication_block_state_changed(mock_pool, _event(state_version=3))
        assert mock_pool.connection.execute.await_count == 1  # attempted once, no retry

    async def test_resolves_merged_into_canonical(self, mock_pool):
        mock_pool.set_fetchval("CANON-1")  # customers.merged_into for the event's id
        await handle_reapplication_block_state_changed(mock_pool, _event())
        assert mock_pool.last_upsert("customers")["customer_id"] == "CANON-1"

    async def test_string_payload_parsed_defensively(self, mock_pool):
        event = _event()
        event["payload"] = json.dumps(event["payload"])
        await handle_reapplication_block_state_changed(mock_pool, event)
        assert mock_pool.last_upsert("customers") is not None
