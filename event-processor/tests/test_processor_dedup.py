"""Transactional-boundary tests for EventProcessor._process_message.

Regression for the dedup/ack ordering bug: the dedup key used to be written
*before* the handler ran, so a message whose handler failed could never be
retried — on redelivery the dedup key made it look like a duplicate and it was
ACK'd without ever being processed. The dedup key must be written only *after*
the handler succeeds.
"""

import sys
import types
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture
def make_processor(monkeypatch):
    # The notifications/aging Billie SDKs aren't installed in the local dev venv;
    # the processor only needs them inside _parse_event (which these tests bypass).
    # Stub any that are missing so the module imports cleanly.
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

    # Neutralise the URL/TLS guard so construction needs no real config.
    monkeypatch.setattr(procmod, "_check_tls_urls", lambda *a, **k: None)

    def _factory(handler):
        proc = procmod.EventProcessor(
            redis_url="redis://localhost:6379",
            database_uri="postgresql://localhost/test",
        )
        proc.redis = AsyncMock()
        proc.redis.exists = AsyncMock(return_value=0)
        proc.redis.set = AsyncMock()
        proc.redis.xack = AsyncMock()
        proc.pool = AsyncMock()
        proc.handlers = {"acct.test.v1": handler}
        # Bypass real SDK parsing — we only care about the dedup/ack flow.
        proc._parse_event = MagicMock(return_value=object())
        return proc

    return _factory


STREAM = "inbox:test"
MESSAGE = (b"msg-1", {b"msg_type": b"acct.test.v1"})


@pytest.mark.asyncio
async def test_dedup_written_after_successful_handler(make_processor):
    from billie_servicing.config import settings

    handler = AsyncMock()
    proc = make_processor(handler)

    await proc._process_message(MESSAGE, STREAM, delivery_count=1)

    handler.assert_awaited_once()
    proc.redis.set.assert_awaited_once_with(
        "dedup:inbox:test:msg-1", "1", ex=settings.dedup_ttl_seconds
    )
    proc.redis.xack.assert_awaited_once()


@pytest.mark.asyncio
async def test_failed_handler_writes_no_dedup_and_no_ack(make_processor):
    # The crux: a failed handler must leave the message retryable — no dedup key
    # (so the retry isn't suppressed as a duplicate) and no ACK (stays pending).
    handler = AsyncMock(side_effect=RuntimeError("boom"))
    proc = make_processor(handler)

    await proc._process_message(MESSAGE, STREAM, delivery_count=1)

    handler.assert_awaited_once()
    proc.redis.set.assert_not_awaited()
    proc.redis.xack.assert_not_awaited()


@pytest.mark.asyncio
async def test_already_processed_message_is_skipped(make_processor):
    handler = AsyncMock()
    proc = make_processor(handler)
    proc.redis.exists = AsyncMock(return_value=1)  # dedup key present => done before

    await proc._process_message(MESSAGE, STREAM, delivery_count=1)

    handler.assert_not_awaited()
    proc.redis.set.assert_not_awaited()
    proc.redis.xack.assert_awaited_once()
