"""Tests for the ClickSend inbound handler (B1).

marketing_client.log_interaction is mocked, so no gRPC is needed; the mock_pool
fixture stands in for the contacts-projection lookup.
"""

import json
from unittest.mock import AsyncMock

from billie_servicing import marketing_client
from billie_servicing.handlers.clicksend import handle_clicksend_inbound, normalise_au_mobile


def _event(payload: dict) -> dict:
    return {"typ": "clicksend.inbound.received.v1", "payload": json.dumps(payload)}


def test_normalise_au_mobile_variants():
    assert normalise_au_mobile("0412 345 678") == "+61412345678"
    assert normalise_au_mobile("+61 412 345 678") == "+61412345678"
    assert normalise_au_mobile("61412345678") == "+61412345678"
    assert normalise_au_mobile("412345678") == "+61412345678"
    assert normalise_au_mobile("not a number") is None
    assert normalise_au_mobile("+61123") is None  # too short
    assert normalise_au_mobile("") is None
    assert normalise_au_mobile(None) is None


async def test_inbound_resolves_contact_and_logs(mock_pool, monkeypatch):
    log = AsyncMock(return_value="ev-1")
    monkeypatch.setattr(marketing_client, "log_interaction", log)
    mock_pool.set_fetchval("c-1")

    await handle_clicksend_inbound(
        mock_pool,
        _event(
            {
                "from": "0412345678",
                "body": "yes please",
                "message_id": "IN-1",
                "timestamp": 1722580202,
                "to": "+61400000000",
            }
        ),
    )

    log.assert_awaited_once()
    kw = log.call_args.kwargs
    assert kw["contact_id"] == "c-1"
    assert kw["kind"] == "message_in"
    assert kw["channel"] == "sms"
    assert kw["direction"] == "inbound"
    assert kw["body"] == "yes please"
    assert kw["source_system"] == "clicksend"
    assert kw["idempotency_key"] == "clicksend:IN-1"
    assert kw["occurred_at"].startswith("2024-")  # unix ts coerced to ISO
    assert json.loads(kw["metadata_json"])["to"] == "+61400000000"


async def test_inbound_no_matching_contact_skips(mock_pool, monkeypatch):
    log = AsyncMock()
    monkeypatch.setattr(marketing_client, "log_interaction", log)
    mock_pool.set_fetchval(None)  # no contact for this mobile

    await handle_clicksend_inbound(mock_pool, _event({"from": "0412345678", "body": "hi"}))
    log.assert_not_awaited()


async def test_inbound_unnormalisable_sender_skips(mock_pool, monkeypatch):
    log = AsyncMock()
    monkeypatch.setattr(marketing_client, "log_interaction", log)
    mock_pool.set_fetchval("c-1")

    await handle_clicksend_inbound(mock_pool, _event({"from": "garbage", "body": "hi"}))
    log.assert_not_awaited()
