"""CRM manual block set (BTB-517): billieChat's replies, and which block they label.

The CRM publishes ``reapplication_block.manual_set.v1``; billieChat answers on
``inbox:billie-servicing`` with ``manual_set_applied.v1`` or
``manual_set_rejected.v1``. ``state.changed.v1`` stays the only writer of the
customer's block (reason / until / version). The replies only record the set's
outcome, so the servicing view can say "Manual block — credit review hold" and
tell the supervisor when a request was refused.

A reason code is shown only for the block that set produced. ``state.changed``
binds the mirrored block to the set's request id (its ``cause.conv`` is
``ops:block-set:{request_id}``) and unbinds it for any other cause, such as a
conversation kill, a merge or an unblock. The label needs the binding and the
applied reply to name the same request, so an older set's code can never
describe a block that something else raised.
"""

from __future__ import annotations

import json
import sys
import types

import pytest

from billie_servicing.handlers.reapplication import (
    STATE_VERSION_GUARD,
    handle_reapplication_block_manual_set_applied,
    handle_reapplication_block_manual_set_rejected,
    handle_reapplication_block_state_changed,
)

CANONICAL = "B81FC35E"

# The customer's block itself: written by state.changed only.
AUTHORITATIVE_COLUMNS = {
    "reapplication_block_reason",
    "reapplication_block_blocked_until",
    "reapplication_block_blocked_at",
    "reapplication_block_application_number",
    "reapplication_block_state_version",
    "reapplication_block_state_changed_at",
    "reapplication_block_manual_block_request_id",
}


def _applied(**overrides):
    payload = {
        "canonical_customer_id": CANONICAL,
        "request_id": "req-1",
        "reason_code": "credit_review_hold",
        "note": "Credit file under review.",
        "operator_id": "7",
        "operator_name": "Sam Supervisor",
        "blocked_at": "2026-10-30T04:40:00+00:00",
        "expires_at": None,
        "version": 12,
    }
    payload.update(overrides)
    return {
        "typ": "reapplication_block.manual_set_applied.v1",
        "usr": CANONICAL,
        "conv": f"ops:block-set:{payload['request_id']}",
        "cls": "msg",
        "payload": payload,
    }


def _rejected(**overrides):
    payload = {
        "canonical_customer_id": CANONICAL,
        "request_id": "req-2",
        "rejection_code": "WOULD_SHORTEN_ACTIVE_BLOCK",
        "detail": "an active manual block runs until cleared; ending it sooner is a clear",
        "rejected_at": "2026-10-30T04:41:00+00:00",
    }
    payload.update(overrides)
    return {
        "typ": "reapplication_block.manual_set_rejected.v1",
        "usr": CANONICAL,
        "conv": f"ops:block-set:{payload['request_id']}",
        "cls": "msg",
        "payload": payload,
    }


def _state_changed(*, conv: str, event_type: str, blocked: bool = True, reason="MANUAL_ADMIN"):
    return {
        "typ": "reapplication_block.state.changed.v1",
        "usr": CANONICAL,
        "conv": conv,
        "payload": {
            "canonical_customer_id": CANONICAL,
            "state_version": 12,
            "blocked": blocked,
            "reason": reason if blocked else None,
            "blocked_until": None,
            "source_application_number": None,
            "source_account_id": None,
            "source_decided_at": None,
            "previous": {"reason": "ACTIVE_LOAN", "blocked_until": None},
            "cause": {"event_type": event_type, "event_id": "evt-c", "conv": conv},
            "changed_at": "2026-10-30T04:40:01+00:00",
        },
    }


class TestApplied:
    async def test_records_the_request_and_its_reason_code(self, mock_pool):
        await handle_reapplication_block_manual_set_applied(mock_pool, _applied())
        row = mock_pool.last_upsert("customers")
        assert row["customer_id"] == CANONICAL
        assert row["reapplication_block_manual_set_request_id"] == "req-1"
        assert row["reapplication_block_manual_set_reason_code"] == "credit_review_hold"

    async def test_never_writes_the_block_itself(self, mock_pool):
        await handle_reapplication_block_manual_set_applied(mock_pool, _applied())
        row = mock_pool.last_upsert("customers")
        assert not AUTHORITATIVE_COLUMNS & set(row)
        assert "reapplication_block_manual_set_rejection" not in row

    async def test_redelivery_writes_the_same_values(self, mock_pool):
        await handle_reapplication_block_manual_set_applied(mock_pool, _applied())
        first = mock_pool.last_upsert("customers")
        await handle_reapplication_block_manual_set_applied(mock_pool, _applied())
        second = mock_pool.last_upsert("customers")
        for column in (
            "reapplication_block_manual_set_request_id",
            "reapplication_block_manual_set_reason_code",
        ):
            assert first[column] == second[column]

    async def test_lands_on_the_canonical_row(self, mock_pool):
        mock_pool.set_fetchval("CANON-1")  # merged_into for the event's id
        await handle_reapplication_block_manual_set_applied(mock_pool, _applied())
        assert mock_pool.last_upsert("customers")["customer_id"] == "CANON-1"

    async def test_without_a_request_id_records_nothing(self, mock_pool):
        await handle_reapplication_block_manual_set_applied(mock_pool, _applied(request_id=None))
        assert not mock_pool.has_call_against("customers")

    async def test_without_a_customer_records_nothing(self, mock_pool):
        event = _applied(canonical_customer_id=None)
        event["usr"] = None
        await handle_reapplication_block_manual_set_applied(mock_pool, event)
        assert not mock_pool.has_call_against("customers")


class TestRejected:
    async def test_records_which_request_was_refused_and_why(self, mock_pool):
        await handle_reapplication_block_manual_set_rejected(mock_pool, _rejected())
        row = mock_pool.last_upsert("customers")
        assert row["customer_id"] == CANONICAL
        assert row["reapplication_block_manual_set_rejected_request_id"] == "req-2"
        assert row["reapplication_block_manual_set_rejection"] == (
            "WOULD_SHORTEN_ACTIVE_BLOCK: an active manual block runs until cleared; "
            "ending it sooner is a clear"
        )

    async def test_leaves_the_block_and_the_applied_set_alone(self, mock_pool):
        """A refused set must not unlabel the block an earlier set put in place."""
        await handle_reapplication_block_manual_set_rejected(mock_pool, _rejected())
        row = mock_pool.last_upsert("customers")
        assert not AUTHORITATIVE_COLUMNS & set(row)
        assert "reapplication_block_manual_set_request_id" not in row
        assert "reapplication_block_manual_set_reason_code" not in row

    async def test_code_without_detail(self, mock_pool):
        await handle_reapplication_block_manual_set_rejected(
            mock_pool, _rejected(rejection_code="INVALID_EXPIRY", detail=None)
        )
        assert mock_pool.last_upsert("customers")["reapplication_block_manual_set_rejection"] == (
            "INVALID_EXPIRY"
        )

    async def test_without_a_request_id_records_nothing(self, mock_pool):
        await handle_reapplication_block_manual_set_rejected(mock_pool, _rejected(request_id=None))
        assert not mock_pool.has_call_against("customers")


def _binding(mock_pool):
    return mock_pool.last_upsert("customers")["reapplication_block_manual_block_request_id"]


class TestStateChangedBindsTheBlock:
    async def test_a_block_raised_by_a_manual_set_is_bound_to_that_request(self, mock_pool):
        await handle_reapplication_block_state_changed(
            mock_pool,
            _state_changed(
                conv="ops:block-set:req-1", event_type="reapplication_block.manual_set.v1"
            ),
        )
        row = mock_pool.last_upsert("customers")
        assert row["reapplication_block_reason"] == "MANUAL_ADMIN"
        assert row["reapplication_block_manual_block_request_id"] == "req-1"

    async def test_a_block_raised_by_a_conversation_kill_is_unbound(self, mock_pool):
        """The kill path emits no manual_set_applied: no older set's code may label it."""
        await handle_reapplication_block_state_changed(
            mock_pool,
            _state_changed(conv="conv-abc", event_type="conversation.kill.requested.v1"),
        )
        row = mock_pool.last_upsert("customers")
        assert row["reapplication_block_reason"] == "MANUAL_ADMIN"
        assert "reapplication_block_manual_block_request_id" in row
        assert row["reapplication_block_manual_block_request_id"] is None

    async def test_a_block_carried_by_a_merge_is_unbound(self, mock_pool):
        await handle_reapplication_block_state_changed(
            mock_pool,
            _state_changed(conv="identity:merge:1", event_type="customer.identity.merged.v1"),
        )
        assert _binding(mock_pool) is None

    async def test_unblocked_is_unbound(self, mock_pool):
        await handle_reapplication_block_state_changed(
            mock_pool,
            _state_changed(
                conv="ops:block-set:req-1",
                event_type="reapplication_block.manual_set.v1",
                blocked=False,
            ),
        )
        assert _binding(mock_pool) is None

    async def test_another_reason_is_unbound(self, mock_pool):
        await handle_reapplication_block_state_changed(
            mock_pool,
            _state_changed(
                conv="ops:block-set:req-1",
                event_type="reapplication_block.manual_set.v1",
                reason="IDENTITY_CONFLICT",
            ),
        )
        assert _binding(mock_pool) is None

    async def test_an_empty_request_id_is_unbound(self, mock_pool):
        await handle_reapplication_block_state_changed(
            mock_pool,
            _state_changed(conv="ops:block-set:", event_type="reapplication_block.manual_set.v1"),
        )
        assert _binding(mock_pool) is None

    async def test_the_binding_moves_with_the_version_guard(self, mock_pool):
        """Bound in the same guarded upsert: a stale state.changed rebinds nothing."""
        await handle_reapplication_block_state_changed(
            mock_pool,
            _state_changed(
                conv="ops:block-set:req-1", event_type="reapplication_block.manual_set.v1"
            ),
        )
        calls = [c for c in mock_pool.calls_against("customers") if c.op == "INSERT"]
        assert len(calls) == 1
        assert calls[0].sql.endswith(f"WHERE {STATE_VERSION_GUARD}")
        assert "reapplication_block_manual_block_request_id = EXCLUDED." in calls[0].sql


@pytest.fixture
def make_processor(monkeypatch):
    # Same SDK stubbing as test_processor_routing: the local venv may lack the
    # notifications/aging SDKs the processor imports at module load.
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

    monkeypatch.setattr(procmod, "_check_tls_urls", lambda *a, **k: None)
    return procmod.EventProcessor(
        redis_url="redis://localhost:6379",
        database_uri="postgresql://localhost/test",
    )


@pytest.mark.parametrize(
    "event", [_applied(), _rejected()], ids=["applied", "rejected"]
)
def test_replies_parse_as_plain_envelopes(make_processor, event):
    """Agent-emitted JSON payloads: the handler gets a dict, like state.changed."""
    wire = {**event, "payload": json.dumps(event["payload"])}
    parsed = make_processor._parse_event(event["typ"], wire)
    assert isinstance(parsed, dict)
    assert parsed["payload"]["request_id"] == event["payload"]["request_id"]


def test_reply_handlers_registered(make_processor):
    from billie_servicing.main import setup_handlers

    proc = make_processor
    setup_handlers(proc)
    assert "reapplication_block.manual_set_applied.v1" in proc.handlers
    assert "reapplication_block.manual_set_rejected.v1" in proc.handlers
