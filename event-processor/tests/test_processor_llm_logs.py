"""BTB-302 — llm_logs stream branch in the event processor.

llm_logs entries are flat Redis-stream field dicts written by billieChat's
LiteLLM logger — no msg_type envelope, and prompts can exceed the generic
256KB size guard. The processor therefore routes the llm_logs stream to
``handle_llm_log`` directly (stream-keyed, not msg_type-keyed), BEFORE the
generic size guard, with the same dedup + ack-after-write guarantees.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from billie_servicing.config import settings
from billie_servicing.processor import EventProcessor


def _proc(mock_pool) -> EventProcessor:
    proc = EventProcessor(redis_url="redis://localhost:1", database_uri="x")
    proc.redis = AsyncMock()
    proc.redis.exists = AsyncMock(return_value=False)
    proc.pool = mock_pool
    return proc


_BIG_PROMPT = "x" * (settings.max_payload_bytes + 1)

_RAW = {
    b"model": b"gpt-5.6-luna",
    b"agent_name": b"customerLiaisonAgent",
    b"prompt_tokens": b"10000",
    b"completion_tokens": b"500",
    b"cached_tokens": b"0",
    b"total_tokens": b"10500",
    b"llm_cost": b"0.003",
    b"response_time_ms": b"1500",
    b"conversation_id": b"conv-9",
    b"system_prompt": _BIG_PROMPT.encode(),
}


def test_llm_logs_stream_is_consumed() -> None:
    assert settings.llm_logs_stream == "llm_logs"


class TestLlmLogsBranch:
    @pytest.mark.asyncio
    async def test_routes_to_llm_handler_and_acks(self, mock_pool) -> None:
        proc = _proc(mock_pool)
        with patch(
            "billie_servicing.processor.handle_llm_log", new=AsyncMock()
        ) as mock_handler:
            await proc._process_message(
                (b"1756260000000-0", _RAW), settings.llm_logs_stream
            )
        mock_handler.assert_awaited_once()
        args = mock_handler.await_args.args
        assert args[1] == "1756260000000-0"
        assert args[2]["model"] == "gpt-5.6-luna"
        proc.redis.xack.assert_awaited_once()
        proc.redis.set.assert_awaited_once()  # dedup marked after success

    @pytest.mark.asyncio
    async def test_oversized_prompt_is_not_dlqd(self, mock_pool) -> None:
        """The generic 256KB guard must not reject llm_logs rows — the
        prompt text never reaches the projection anyway."""
        proc = _proc(mock_pool)
        proc._move_to_dlq = AsyncMock()
        with patch(
            "billie_servicing.processor.handle_llm_log", new=AsyncMock()
        ) as mock_handler:
            await proc._process_message(
                (b"1756260000000-0", _RAW), settings.llm_logs_stream
            )
        mock_handler.assert_awaited_once()
        proc._move_to_dlq.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_duplicate_is_skipped(self, mock_pool) -> None:
        proc = _proc(mock_pool)
        proc.redis.exists = AsyncMock(return_value=True)
        with patch(
            "billie_servicing.processor.handle_llm_log", new=AsyncMock()
        ) as mock_handler:
            await proc._process_message(
                (b"1756260000000-0", _RAW), settings.llm_logs_stream
            )
        mock_handler.assert_not_awaited()
        proc.redis.xack.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handler_failure_leaves_message_pending(self, mock_pool) -> None:
        """No ack, no dedup on failure — the pending entry gets retried and
        eventually walks to the DLQ via the delivery counter."""
        proc = _proc(mock_pool)
        proc._move_to_dlq = AsyncMock()
        with patch(
            "billie_servicing.processor.handle_llm_log",
            new=AsyncMock(side_effect=RuntimeError("db down")),
        ):
            await proc._process_message(
                (b"1756260000000-0", _RAW), settings.llm_logs_stream, delivery_count=1
            )
        proc.redis.set.assert_not_awaited()
        proc.redis.xack.assert_not_awaited()
