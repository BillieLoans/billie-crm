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


class TestOptOutDetection:
    def test_keywords_match_case_insensitively(self):
        from billie_servicing.handlers.clicksend import is_opt_out

        assert is_opt_out("STOP")
        assert is_opt_out("stop")
        assert is_opt_out("Stop please")
        assert is_opt_out("UNSUBSCRIBE")
        assert is_opt_out("opt out")
        assert is_opt_out(None, keyword="STOP")
        assert not is_opt_out("please stop sending me these")  # mid-sentence
        assert not is_opt_out("what time do you open?")
        assert not is_opt_out("")
        assert not is_opt_out(None)


async def test_stop_reply_withdraws_consent(mock_pool, monkeypatch):
    # Spam Act: a STOP reply must actually withdraw consent, automatically.
    log = AsyncMock(return_value="ev-1")
    consent = AsyncMock(return_value="ev-2")
    monkeypatch.setattr(marketing_client, "log_interaction", log)
    monkeypatch.setattr(marketing_client, "set_consent", consent)
    mock_pool.set_fetchval("c-1")

    await handle_clicksend_inbound(
        mock_pool, _event({"from": "0403320117", "body": "STOP", "message_id": "M-1"})
    )

    assert log.await_args.kwargs["kind"] == "message_in"
    kwargs = consent.await_args.kwargs
    assert kwargs["granted"] is False
    assert kwargs["method"] == "sms_stop_reply"
    assert "M-1" in kwargs["evidence"]


async def test_normal_reply_does_not_touch_consent(mock_pool, monkeypatch):
    log = AsyncMock(return_value="ev-1")
    consent = AsyncMock(return_value="ev-2")
    monkeypatch.setattr(marketing_client, "log_interaction", log)
    monkeypatch.setattr(marketing_client, "set_consent", consent)
    mock_pool.set_fetchval("c-1")

    await handle_clicksend_inbound(
        mock_pool, _event({"from": "0403320117", "body": "thanks!", "message_id": "M-2"})
    )

    log.assert_awaited_once()
    consent.assert_not_awaited()
