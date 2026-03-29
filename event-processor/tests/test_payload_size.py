"""
Tests for event payload size limiting (M9: Unbounded Event Payload Sizes).

Verifies that the processor rejects oversized payloads and routes them
to the dead letter queue without executing any handler.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from billie_servicing.processor import EventProcessor
from billie_servicing.config import settings


def _make_message(fields: dict[str, str]) -> tuple[bytes, dict[bytes, bytes]]:
    """Create a (message_id, fields) tuple matching Redis XREADGROUP format."""
    encoded = {k.encode(): v.encode() for k, v in fields.items()}
    return (b"1234567890-0", encoded)


@pytest.fixture
def processor():
    """Create a processor with mocked Redis and DB."""
    proc = EventProcessor()
    proc.redis = MagicMock()
    proc.redis.exists = AsyncMock(return_value=False)  # No dedup hit
    proc.redis.xack = AsyncMock()
    proc.redis.xadd = AsyncMock()  # DLQ write
    proc.redis.setex = AsyncMock()
    proc.db = MagicMock()
    return proc


class TestPayloadSizeLimit:
    """M9: Oversized payloads should be rejected before handler execution."""

    @pytest.mark.asyncio
    async def test_normal_payload_is_processed(self, processor):
        """A payload under the limit should be processed normally."""
        handler = AsyncMock()
        processor.handlers["conversation_started"] = handler

        message = _make_message({
            "typ": "conversation_started",
            "cid": "CONV-001",
            "usr": "CUS-001",
        })

        await processor._process_message(message, settings.inbox_stream)

        # Handler should have been called
        handler.assert_called_once()
        # Message should be ACKed
        processor.redis.xack.assert_called()

    @pytest.mark.asyncio
    async def test_oversized_payload_is_rejected_to_dlq(self, processor):
        """A payload over max_payload_bytes should be moved to DLQ, not processed."""
        handler = AsyncMock()
        processor.handlers["conversation_started"] = handler

        # Create a payload that exceeds the limit
        huge_value = "x" * (settings.max_payload_bytes + 1)
        message = _make_message({
            "typ": "conversation_started",
            "cid": "CONV-001",
            "usr": huge_value,
        })

        await processor._process_message(message, settings.inbox_stream)

        # Handler should NOT have been called
        handler.assert_not_called()
        # Message should be ACKed (so it doesn't get retried)
        processor.redis.xack.assert_called()
        # Message should be written to DLQ
        processor.redis.xadd.assert_called_once()
        dlq_call_args = processor.redis.xadd.call_args
        assert dlq_call_args[0][0] == settings.dlq_stream
        assert "Payload too large" in dlq_call_args[0][1]["error"]

    @pytest.mark.asyncio
    async def test_payload_at_exact_limit_is_processed(self, processor):
        """A payload at exactly max_payload_bytes should be allowed."""
        handler = AsyncMock()
        processor.handlers["conversation_started"] = handler

        # Calculate how much padding to add to hit exactly the limit
        base_fields = {"typ": "conversation_started", "cid": "CONV-001", "usr": ""}
        base_size = sum(len(v) for v in base_fields.values())
        padding = settings.max_payload_bytes - base_size
        base_fields["usr"] = "x" * padding

        message = _make_message(base_fields)

        await processor._process_message(message, settings.inbox_stream)

        # Should be processed (at limit, not over)
        handler.assert_called_once()

    @pytest.mark.asyncio
    async def test_oversized_payload_skips_dedup_check(self, processor):
        """Size check should happen before dedup, so we don't waste a Redis call."""
        handler = AsyncMock()
        processor.handlers["conversation_started"] = handler

        huge_value = "x" * (settings.max_payload_bytes + 1)
        message = _make_message({
            "typ": "conversation_started",
            "cid": "CONV-001",
            "usr": huge_value,
        })

        await processor._process_message(message, settings.inbox_stream)

        # Dedup check (redis.exists) should NOT have been called
        processor.redis.exists.assert_not_called()
