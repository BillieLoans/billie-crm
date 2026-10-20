"""final_credit_decision → decision_metadata projection + reasonless-decline warning (BTB-462)."""

import json

import pytest
from structlog.testing import capture_logs

from billie_servicing.handlers.conversation import handle_final_decision

WARNING_EVENT = "final_credit_decision DECLINED without reason"


def _metadata_writes(mock_pool) -> list[dict]:
    """Stored decision_metadata objects, one per replace-UPDATE, in order."""
    return [
        json.loads(c.values["decision_metadata"])
        for c in mock_pool.calls_against("conversations")
        if c.op == "UPDATE" and "SET decision_metadata = $1::jsonb" in c.sql
    ]


def _event(payload: dict) -> dict:
    return {"cid": "CONV-META-001", "payload": payload}


@pytest.mark.asyncio
async def test_decline_with_metadata_replaces_column(mock_pool):
    """Metadata replaces decision_metadata via a plain UPDATE."""
    await handle_final_decision(
        mock_pool,
        _event(
            {
                "application_number": "40089601-594",
                "decision": "DECLINED",
                "reason": "BUSINESS_ACCOUNT",
                "retry_eligible": True,
                "incident_ref": None,
                "decision_metadata": {
                    "component": "personal_account_check",
                    "account_names": ["Business Trans Acct"],
                },
            }
        ),
    )
    doc = mock_pool.last_insert("conversations")
    assert doc["decision_detail_reason"] == "BUSINESS_ACCOUNT"
    assert doc["decision_detail_retry_eligible"] is True
    assert _metadata_writes(mock_pool) == [
        {
            "component": "personal_account_check",
            "account_names": ["Business Trans Acct"],
        }
    ]


@pytest.mark.asyncio
async def test_incident_ref_is_folded_into_stored_metadata(mock_pool):
    """Top-level incident_ref is stored; absent/None leaves the key out."""
    await handle_final_decision(
        mock_pool,
        _event(
            {
                "decision": "DECLINED",
                "reason": "G5_TIMEOUT:serviceability",
                "incident_ref": "INC-G5-20261019-abcd",
                "decision_metadata": {"component": "g5_timeout_guard"},
            }
        ),
    )
    assert _metadata_writes(mock_pool) == [
        {"component": "g5_timeout_guard", "incident_ref": "INC-G5-20261019-abcd"}
    ]


@pytest.mark.asyncio
async def test_incident_ref_absent_is_omitted(mock_pool):
    """No incident_ref in the payload → no incident_ref key stored."""
    await handle_final_decision(
        mock_pool,
        _event({"decision": "DECLINED", "reason": "X", "decision_metadata": {"a": 1}}),
    )
    assert _metadata_writes(mock_pool) == [{"a": 1}]


@pytest.mark.asyncio
async def test_second_decision_replaces_stale_keys(mock_pool):
    """A later decision's stored object carries no keys from the earlier one."""
    await handle_final_decision(
        mock_pool,
        _event(
            {
                "decision": "DECLINED",
                "reason": "SYSTEM_FAILURE:account_conduct",
                "decision_metadata": {"component": "account_conduct", "error_type": "TimeoutError"},
            }
        ),
    )
    await handle_final_decision(
        mock_pool,
        _event(
            {
                "decision": "DECLINED",
                "reason": "CREDIT_ASSESSMENT:SERVICEABILITY",
                "decision_metadata": {"component": "serviceability", "reason_code": "SERVICEABILITY"},
            }
        ),
    )
    writes = _metadata_writes(mock_pool)
    assert len(writes) == 2
    assert "error_type" not in writes[1]
    assert writes[1] == {"component": "serviceability", "reason_code": "SERVICEABILITY"}


@pytest.mark.asyncio
async def test_metadata_written_after_upsert(mock_pool):
    """Ordering: the row must exist before the plain UPDATE."""
    await handle_final_decision(
        mock_pool,
        _event({"decision": "DECLINED", "reason": "X", "decision_metadata": {"a": 1}}),
    )
    ops = [c.op for c in mock_pool.calls_against("conversations")]
    assert ops.index("INSERT") < ops.index("UPDATE")


@pytest.mark.asyncio
async def test_legacy_redelivery_does_not_touch_metadata(mock_pool):
    """No decision_metadata in payload → no metadata write at all."""
    await handle_final_decision(mock_pool, _event({"decision": "DECLINED", "reason": "X"}))
    assert _metadata_writes(mock_pool) == []


@pytest.mark.asyncio
async def test_empty_metadata_object_is_not_written(mock_pool):
    """An empty dict is treated as absent (keeps NULL meaning 'nothing recorded')."""
    await handle_final_decision(
        mock_pool, _event({"decision": "DECLINED", "reason": "X", "decision_metadata": {}})
    )
    assert _metadata_writes(mock_pool) == []


@pytest.mark.asyncio
async def test_approved_writes_no_metadata_and_no_warning(mock_pool):
    """An APPROVED decision writes no metadata and logs no reasonless warning."""
    with capture_logs() as logs:
        await handle_final_decision(mock_pool, _event({"decision": "APPROVED"}))
    assert _metadata_writes(mock_pool) == []
    assert not [entry for entry in logs if entry.get("event") == WARNING_EVENT]


@pytest.mark.asyncio
async def test_reasonless_decline_logs_structured_warning(mock_pool):
    """A reasonless DECLINED is a producer contract breach — warn loudly."""
    with capture_logs() as logs:
        await handle_final_decision(
            mock_pool, _event({"application_number": "APP-1", "decision": "DECLINED"})
        )
    warnings = [entry for entry in logs if entry.get("event") == WARNING_EVENT]
    assert len(warnings) == 1
    assert warnings[0]["log_level"] == "warning"
    assert warnings[0]["conversation_id"] == "CONV-META-001"
    assert warnings[0]["application_number"] == "APP-1"
