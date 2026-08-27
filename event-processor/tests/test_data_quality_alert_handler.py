"""BTB-307 phase 1 — the ME001 data-quality alert's operator surface.

billieChat's shadow gate publishes ``credit_assessment.data_quality_alert.v1``
(routed to the CRM inbox). Without a handler the processor acks-and-drops it
("no handler registered") and the shadow phase produces zero
operator-visible data — the alert must land on the conversation record.
"""

from __future__ import annotations

import json

import pytest

from billie_servicing.handlers.conversation import handle_data_quality_alert


def _event(payload_as_string: bool = False) -> dict:
    payload = {
        "application_number": "APP-DQ-1",
        "mode": "shadow",
        "gate": "me001_implausibility",
        "earned_source_count": 36,
        "benefit_source_count": 1,
        "threshold": 6,
        "sources": [{"payer": "name:j n bennett", "credits": 4, "total": 289.0}],
        "source_count_total": 36,
        "report_location": "s3://bucket/APP-DQ-1/affordability.json",
        "counts_note": "earned = PAY-frame sources ...",
    }
    return {
        "cid": "conv-dq-1",
        "usr": "cust-dq-1",
        "msg_type": "credit_assessment.data_quality_alert.v1",
        "payload": json.dumps(payload) if payload_as_string else payload,
    }


def _alert_json(mock_pool) -> dict:
    updates = [
        c
        for c in mock_pool.calls_against("conversations")
        if c.op == "UPDATE" and "data_quality_alert" in c.values
    ]
    assert updates, "expected an UPDATE setting conversations.data_quality_alert"
    raw = updates[-1].values["data_quality_alert"]
    return json.loads(raw) if isinstance(raw, str) else raw


class TestDataQualityAlertHandler:
    @pytest.mark.asyncio
    async def test_stores_alert_on_the_conversation(self, mock_pool) -> None:
        """The full alert payload lands in conversations.data_quality_alert
        keyed by conversation_id."""
        await handle_data_quality_alert(mock_pool, _event())
        data = _alert_json(mock_pool)
        assert data["earned_source_count"] == 36
        assert data["gate"] == "me001_implausibility"
        assert data["report_location"].endswith("affordability.json")
        updates = [
            c
            for c in mock_pool.calls_against("conversations")
            if c.op == "UPDATE" and "data_quality_alert" in c.values
        ]
        assert updates[-1].where.get("conversation_id") == "conv-dq-1"

    @pytest.mark.asyncio
    async def test_string_payload_is_parsed(self, mock_pool) -> None:
        """Stream payloads arrive JSON-encoded — the handler decodes them."""
        await handle_data_quality_alert(mock_pool, _event(payload_as_string=True))
        assert _alert_json(mock_pool)["threshold"] == 6

    @pytest.mark.asyncio
    async def test_missing_conversation_is_upserted_first(self, mock_pool) -> None:
        """An alert may beat the conversation projection — the row is
        ensured before the merge (same pattern as the assessment
        handlers)."""
        await handle_data_quality_alert(mock_pool, _event())
        inserts = [
            c
            for c in mock_pool.calls_against("conversations")
            if c.op == "INSERT"
        ]
        assert inserts, "conversation row must be ensured before the update"
