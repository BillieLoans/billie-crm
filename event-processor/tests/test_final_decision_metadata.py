"""final_credit_decision → decision_metadata projection + reasonless-decline warning (BTB-462)."""

import pytest
from structlog.testing import capture_logs

from billie_servicing.handlers.conversation import handle_final_decision

WARNING_EVENT = "final_credit_decision DECLINED without reason"


def _event(payload: dict) -> dict:
    return {"cid": "CONV-META-001", "payload": payload}


@pytest.mark.asyncio
async def test_decline_with_metadata_merges_jsonb(mock_pool):
    """Metadata lands in decision_metadata via merge_jsonb (additive)."""
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
    merges = mock_pool.jsonb_merges("conversations", "decision_metadata")
    assert merges == [
        {
            "component": "personal_account_check",
            "account_names": ["Business Trans Acct"],
        }
    ]


@pytest.mark.asyncio
async def test_metadata_written_after_upsert(mock_pool):
    """Ordering: the row must exist before the plain UPDATE merge."""
    await handle_final_decision(
        mock_pool,
        _event({"decision": "DECLINED", "reason": "X", "decision_metadata": {"a": 1}}),
    )
    ops = [c.op for c in mock_pool.calls_against("conversations")]
    assert ops.index("INSERT") < ops.index("UPDATE")


@pytest.mark.asyncio
async def test_legacy_redelivery_does_not_touch_metadata(mock_pool):
    """No decision_metadata in payload → no merge call at all."""
    await handle_final_decision(mock_pool, _event({"decision": "DECLINED", "reason": "X"}))
    assert mock_pool.jsonb_merges("conversations", "decision_metadata") == []


@pytest.mark.asyncio
async def test_empty_metadata_object_is_not_written(mock_pool):
    """An empty dict is treated as absent (keeps NULL meaning 'nothing recorded')."""
    await handle_final_decision(
        mock_pool, _event({"decision": "DECLINED", "reason": "X", "decision_metadata": {}})
    )
    assert mock_pool.jsonb_merges("conversations", "decision_metadata") == []


@pytest.mark.asyncio
async def test_approved_writes_no_metadata_and_no_warning(mock_pool):
    """An APPROVED decision writes no metadata and logs no reasonless warning."""
    with capture_logs() as logs:
        await handle_final_decision(mock_pool, _event({"decision": "APPROVED"}))
    assert mock_pool.jsonb_merges("conversations", "decision_metadata") == []
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
