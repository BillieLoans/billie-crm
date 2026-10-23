"""final_credit_decision → reporting.decision_event and ruleset version (BTB-504, BTB-505)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

import pytest

from billie_servicing.handlers.conversation import handle_final_decision
from billie_servicing.handlers.reporting import decision_key, decision_time, record_decision_event

if TYPE_CHECKING:
    from tests.conftest import MockPool

TABLE = "reporting.decision_event"


def _event(payload: dict, **envelope: object) -> dict:
    """A sanitized final_credit_decision envelope."""
    return {"cid": "CONV-RPT-001", "seq": 7, "payload": payload, **envelope}


@pytest.mark.asyncio
async def test_decision_is_recorded_with_its_provenance(mock_pool: MockPool) -> None:
    """Every field reporting needs lands on the event row."""
    await handle_final_decision(
        mock_pool,
        _event(
            {
                "application_number": "APP-1",
                "decision": "DECLINED",
                "reason": "CREDIT_ASSESSMENT:SERVICEABILITY",
                "retry_eligible": False,
                "ruleset_version": "0123456789abcdef",
                "build_sha": "sha-abc",
                "assessment_record_location": "s3://b/c/APP-1/AssessmentRecord/r.json",
            },
            event_id="evt-1",
        ),
    )
    [row] = mock_pool.inserts_into(TABLE)
    assert row["decision_key"] == "evt-1"
    assert row["event_id"] == "evt-1"
    assert row["conversation_id"] == "CONV-RPT-001"
    assert row["application_number"] == "APP-1"
    assert row["decision"] == "DECLINED"
    assert row["reason"] == "CREDIT_ASSESSMENT:SERVICEABILITY"
    assert row["retry_eligible"] is False
    assert row["ruleset_version"] == "0123456789abcdef"
    assert row["build_sha"] == "sha-abc"
    assert row["mock_origin"] is False
    assert row["assessment_record_location"].endswith("r.json")
    assert isinstance(row["decided_at"], datetime)
    [call] = mock_pool.calls_against(TABLE)
    assert "ON CONFLICT (decision_key) DO NOTHING" in call.sql


@pytest.mark.asyncio
async def test_ruleset_version_is_projected_onto_the_conversation(mock_pool: MockPool) -> None:
    """The conversation row carries the ruleset that made its decision."""
    await handle_final_decision(
        mock_pool,
        _event({"decision": "APPROVED", "ruleset_version": "aaaaaaaaaaaaaaaa"}),
    )
    assert mock_pool.last_insert("conversations")["decision_detail_ruleset_version"] == (
        "aaaaaaaaaaaaaaaa"
    )


@pytest.mark.asyncio
async def test_legacy_payload_does_not_wipe_the_ruleset(mock_pool: MockPool) -> None:
    """A payload without a ruleset version leaves the column untouched."""
    await handle_final_decision(mock_pool, _event({"decision": "APPROVED"}))
    assert "decision_detail_ruleset_version" not in mock_pool.last_insert("conversations")
    [row] = mock_pool.inserts_into(TABLE)
    assert row["ruleset_version"] is None
    assert row["build_sha"] is None


@pytest.mark.asyncio
async def test_null_ruleset_clears_the_conversation_column(mock_pool: MockPool) -> None:
    """A mock approval (ruleset null) must not keep an earlier real decision's version."""
    await handle_final_decision(
        mock_pool, _event({"decision": "APPROVED", "ruleset_version": None, "mock_origin": True})
    )
    insert = mock_pool.last_insert("conversations")
    assert "decision_detail_ruleset_version" in insert
    assert insert["decision_detail_ruleset_version"] is None


@pytest.mark.asyncio
async def test_producer_decided_at_is_used(mock_pool: MockPool) -> None:
    """The stamped decision time wins over the processing time."""
    await handle_final_decision(
        mock_pool,
        _event({"decision": "APPROVED", "decided_at": "2026-10-21T03:04:05.123456+00:00"}),
    )
    [row] = mock_pool.inserts_into(TABLE)
    assert row["decided_at"] == datetime(2026, 10, 21, 3, 4, 5, 123456, tzinfo=UTC)


def test_decision_time_reads_naive_as_utc_and_falls_back() -> None:
    """A naive stamp is UTC; an unparseable one falls back."""
    fallback = datetime(2026, 1, 1, tzinfo=UTC)
    assert decision_time({"decided_at": "2026-10-21T03:04:05"}, fallback) == datetime(
        2026, 10, 21, 3, 4, 5, tzinfo=UTC
    )
    assert decision_time({"decided_at": "nope"}, fallback) == fallback
    assert decision_time({}, fallback) == fallback


@pytest.mark.asyncio
async def test_reporting_failure_does_not_fail_the_projection(
    mock_pool: MockPool, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A broken reporting write is logged, and the conversation update stands."""
    from billie_servicing.handlers import conversation

    async def boom(*_args: object, **_kwargs: object) -> bool:
        raise RuntimeError("relation reporting.decision_event does not exist")

    monkeypatch.setattr(conversation, "record_decision_event", boom)
    await handle_final_decision(mock_pool, _event({"decision": "APPROVED"}))
    assert mock_pool.last_insert("conversations")["final_decision"] == "APPROVED"


@pytest.mark.asyncio
async def test_mock_approvals_are_marked(mock_pool: MockPool) -> None:
    """mock_origin decisions are flagged so reports can exclude them."""
    await handle_final_decision(
        mock_pool, _event({"decision": "APPROVED", "mock_origin": True}, event_id="e")
    )
    assert mock_pool.inserts_into(TABLE)[0]["mock_origin"] is True


@pytest.mark.asyncio
async def test_no_outcome_records_nothing(mock_pool: MockPool) -> None:
    """An event without a decision writes no reporting row."""
    await handle_final_decision(mock_pool, _event({}))
    assert mock_pool.inserts_into(TABLE) == []


def test_key_prefers_the_producer_event_id() -> None:
    """The producer id is shared by the live and archived copies."""
    assert decision_key({"event_id": "evt-9", "seq": 3}, "C", "APPROVED") == "evt-9"


def test_key_falls_back_for_events_without_an_id() -> None:
    """Older events key on conversation, sequence and outcome."""
    assert decision_key({"seq": 3}, "C", "APPROVED") == "C:3:APPROVED"
    assert decision_key({"event_id": "  ", "seq": 3}, "C", "DECLINED") == "C:3:DECLINED"


@pytest.mark.asyncio
async def test_non_boolean_retry_flag_is_dropped() -> None:
    """Only a real boolean is stored as retry_eligible."""
    target = AsyncMock()
    target.execute = AsyncMock(return_value="INSERT 0 1")
    await record_decision_event(
        target,
        {"seq": 1},
        {"retry_eligible": "yes"},
        conversation_id="C",
        decision="DECLINED",
    )
    args = target.execute.call_args.args
    assert args[7] is None  # retry_eligible


@pytest.mark.asyncio
async def test_reports_whether_a_row_was_written() -> None:
    """The command tag tells a new row from an already-recorded event."""
    target = AsyncMock()
    when = datetime(2026, 10, 21, tzinfo=UTC)
    target.execute = AsyncMock(return_value="INSERT 0 1")
    assert await record_decision_event(
        target, {}, {}, conversation_id="C", decision="APPROVED", decided_at=when
    )
    assert target.execute.call_args.args[-1] == when
    target.execute = AsyncMock(return_value="INSERT 0 0")
    assert not await record_decision_event(
        target, {}, {}, conversation_id="C", decision="APPROVED"
    )
