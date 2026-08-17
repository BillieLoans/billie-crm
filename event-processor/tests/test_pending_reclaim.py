"""Tests for steady-state pending-entry reclaim and stale-consumer cleanup.

Prod observation 2026-08-17: `_process_pending_messages` drains pending
entries only at startup / after a Redis reconnect. A message that fails
mid-run (handler exception with delivery_count < max_retries) stays pending
forever — XREADGROUP with ">" never redelivers it. Prod had 4 customer
events stranded since Aug 5/12/16 because the machines hadn't restarted
since Aug 4. The processor needs a periodic reclaim pass so failed messages
retry (and eventually DLQ) without waiting for a deploy.

The consumer group had also accumulated 46 consumers, all but two dead
(names are pid+timestamp so every restart mints a new one) — startup should
delete consumers that are long-idle with nothing pending.
"""

import sys
import time
import types
from unittest.mock import AsyncMock, MagicMock

import pytest

from billie_servicing.config import settings


@pytest.fixture
def make_processor(monkeypatch):
    # Same SDK stubbing as test_processor_dedup — the local venv may lack the
    # notifications/aging SDKs; these tests never touch _parse_event.
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

    def _factory():
        proc = procmod.EventProcessor(
            redis_url="redis://localhost:6379",
            database_uri="postgresql://localhost/test",
        )
        proc.redis = AsyncMock()
        proc.pool = AsyncMock()
        proc._process_message = AsyncMock()
        return proc

    return _factory


STREAM = "inbox:test"


class TestReclaimStalePending:
    @pytest.mark.asyncio
    async def test_reclaims_and_processes_stale_pending(self, make_processor):
        proc = make_processor()
        proc.redis.xpending_range = AsyncMock(
            return_value=[
                {
                    "message_id": b"1786922669966-0",
                    "consumer": b"processor-old",
                    "time_since_delivered": 9_000_000,
                    "times_delivered": 1,
                }
            ]
        )
        claimed_msg = (b"1786922669966-0", {b"typ": b"customer.changed.v1"})
        proc.redis.xclaim = AsyncMock(return_value=[claimed_msg])

        count = await proc._reclaim_stale_pending(STREAM)

        assert count == 1
        # Only entries already idle past the threshold may be considered.
        _, kwargs = proc.redis.xpending_range.call_args
        assert kwargs.get("idle") == settings.pending_min_idle_ms
        # The claim itself must re-check idleness (race with the other machine).
        _, claim_kwargs = proc.redis.xclaim.call_args
        assert claim_kwargs.get("min_idle_time") == settings.pending_min_idle_ms
        proc._process_message.assert_awaited_once_with(claimed_msg, STREAM, 1)

    @pytest.mark.asyncio
    async def test_no_claim_when_nothing_stale(self, make_processor):
        proc = make_processor()
        proc.redis.xpending_range = AsyncMock(return_value=[])
        proc.redis.xclaim = AsyncMock()

        count = await proc._reclaim_stale_pending(STREAM)

        assert count == 0
        proc.redis.xclaim.assert_not_awaited()
        proc._process_message.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_lost_claim_race_skips_processing(self, make_processor):
        """The other live consumer may claim the entry first — XCLAIM then
        returns nothing and we must not process."""
        proc = make_processor()
        proc.redis.xpending_range = AsyncMock(
            return_value=[
                {
                    "message_id": b"1-0",
                    "consumer": b"other",
                    "time_since_delivered": 9_000_000,
                    "times_delivered": 2,
                }
            ]
        )
        proc.redis.xclaim = AsyncMock(return_value=[])

        count = await proc._reclaim_stale_pending(STREAM)

        assert count == 0
        proc._process_message.assert_not_awaited()


class TestMaybeReclaimPending:
    @pytest.mark.asyncio
    async def test_skips_before_interval_elapsed(self, make_processor):
        proc = make_processor()
        proc.redis.xpending_range = AsyncMock(return_value=[])
        proc._last_pending_reclaim = time.monotonic()

        await proc._maybe_reclaim_pending()

        proc.redis.xpending_range.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_runs_for_both_streams_after_interval(self, make_processor):
        proc = make_processor()
        proc.redis.xpending_range = AsyncMock(return_value=[])
        proc._last_pending_reclaim = (
            time.monotonic() - settings.pending_reclaim_interval_seconds - 1
        )

        await proc._maybe_reclaim_pending()

        streams = [c.args[0] for c in proc.redis.xpending_range.await_args_list]
        assert settings.inbox_stream in streams
        assert settings.internal_stream in streams
        # The stamp advances so the next loop iteration skips.
        proc.redis.xpending_range.reset_mock()
        await proc._maybe_reclaim_pending()
        proc.redis.xpending_range.assert_not_awaited()


class TestCleanupStaleConsumers:
    @pytest.mark.asyncio
    async def test_deletes_only_long_idle_consumers_with_no_pending(
        self, make_processor
    ):
        proc = make_processor()
        stale_idle = settings.stale_consumer_max_idle_ms + 1
        proc.redis.xinfo_consumers = AsyncMock(
            return_value=[
                {"name": b"processor-old-empty", "pending": 0, "idle": stale_idle},
                {"name": b"processor-old-pending", "pending": 2, "idle": stale_idle},
                {"name": b"processor-fresh", "pending": 0, "idle": 1000},
            ]
        )
        proc.redis.xgroup_delconsumer = AsyncMock()

        await proc._cleanup_stale_consumers(STREAM)

        proc.redis.xgroup_delconsumer.assert_awaited_once_with(
            STREAM, settings.consumer_group, "processor-old-empty"
        )

    @pytest.mark.asyncio
    async def test_never_deletes_own_consumer(self, make_processor):
        proc = make_processor()
        stale_idle = settings.stale_consumer_max_idle_ms + 1
        proc.redis.xinfo_consumers = AsyncMock(
            return_value=[
                {"name": proc.consumer_id.encode(), "pending": 0, "idle": stale_idle},
            ]
        )
        proc.redis.xgroup_delconsumer = AsyncMock()

        await proc._cleanup_stale_consumers(STREAM)

        proc.redis.xgroup_delconsumer.assert_not_awaited()
