"""Unhandled-event skip regression for EventProcessor._process_message.

The external stream `inbox:billie-servicing` carries many event types the CRM
does not consume. Such events should hit the "No handler registered" path and
be ACK'd (skipped) cleanly.

Regression (BTB demo): the handler lookup happened *after* `_parse_event`, and
`_parse_event` routes any `customer.*` type into the typed customers SDK, which
is a strict allowlist (`parse_customer_message`). An unhandled customer-domain
event like `customer.contact.verified.v1` therefore raised
`UnsupportedEventTypeError` during parse — before the no-handler skip could run —
so the message was retried and finally moved to the DLQ instead of being
skipped. The handler lookup must happen *before* parsing.
"""

import json
import sys
import types
from unittest.mock import AsyncMock

import pytest


@pytest.fixture
def make_processor(monkeypatch):
    # notifications/aging SDKs aren't in the local dev venv; the customers SDK
    # IS installed, and this test exercises the real customers-SDK parse path.
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

    proc = procmod.EventProcessor(
        redis_url="redis://localhost:6379",
        database_uri="postgresql://localhost/test",
    )
    proc.redis = AsyncMock()
    proc.redis.exists = AsyncMock(return_value=0)
    proc.redis.set = AsyncMock()
    proc.redis.xack = AsyncMock()
    proc.redis.xadd = AsyncMock()  # DLQ writes go here — must NOT be called
    proc.pool = AsyncMock()
    proc.handlers = {}  # nothing registered for the incoming type
    # NOTE: _parse_event is the REAL method — this test proves the routing/parse
    # order, so it must not be stubbed.
    return proc


STREAM = "inbox:billie-servicing"


def _customer_event(event_type: str):
    """A realistic Redis message for an unhandled customer-domain event."""
    envelope = {
        "conv": "c1",
        "agt": "customerService",
        "usr": "4A8C91AB",
        "seq": "0",
        "cls": "obs",
        "typ": event_type,
        "msg_type": event_type,
        "payload": json.dumps({"customer_id": "CUST-1"}),
    }
    fields = {k.encode(): v.encode() for k, v in envelope.items()}
    return (b"msg-1", fields)


@pytest.mark.asyncio
async def test_unhandled_customer_event_is_skipped_not_dlqd(make_processor):
    proc = make_processor

    # delivery_count well under max_retries: a crash here would simply leave the
    # message pending (no ack), not DLQ — so asserting ACK is what proves the skip.
    await proc._process_message(
        _customer_event("customer.contact.verified.v1"), STREAM, delivery_count=1
    )

    # Skipped cleanly: ACK'd exactly once, never sent to the DLQ.
    proc.redis.xack.assert_awaited_once()
    proc.redis.xadd.assert_not_awaited()
    # No dedup key for a skipped (unhandled) event.
    proc.redis.set.assert_not_awaited()
