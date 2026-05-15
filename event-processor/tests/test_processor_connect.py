"""Tests for EventProcessor connection startup behavior."""

from unittest.mock import AsyncMock, MagicMock

import asyncpg
import pytest

from billie_servicing.processor import EventProcessor


def _mock_redis_client() -> MagicMock:
    client = MagicMock()
    client.ping = AsyncMock(return_value=True)
    client.close = AsyncMock()
    return client


def _mock_pool(fetchval_side_effect: Exception | None = None) -> MagicMock:
    """Mock an asyncpg.Pool. The acquire() context manager returns a mock
    connection whose fetchval optionally raises ``fetchval_side_effect``."""
    conn = MagicMock()
    if fetchval_side_effect is None:
        conn.fetchval = AsyncMock(return_value=1)
    else:
        conn.fetchval = AsyncMock(side_effect=fetchval_side_effect)

    acquire_ctx = MagicMock()
    acquire_ctx.__aenter__ = AsyncMock(return_value=conn)
    acquire_ctx.__aexit__ = AsyncMock(return_value=None)

    pool = MagicMock()
    pool.acquire = MagicMock(return_value=acquire_ctx)
    pool.close = AsyncMock()
    return pool


@pytest.mark.asyncio
async def test_connect_fails_fast_on_pg_auth_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Auth errors should fail fast — no retry sleep."""
    processor = EventProcessor()
    redis_client = _mock_redis_client()

    # create_pool raises an auth error → processor should re-raise immediately.
    create_pool_mock = AsyncMock(
        side_effect=asyncpg.InvalidPasswordError("password authentication failed")
    )
    sleep_mock = AsyncMock()

    monkeypatch.setattr(
        "billie_servicing.processor.redis.from_url",
        lambda *args, **kwargs: redis_client,
    )
    monkeypatch.setattr("billie_servicing.processor.asyncpg.create_pool", create_pool_mock)
    monkeypatch.setattr("billie_servicing.processor.asyncio.sleep", sleep_mock)

    with pytest.raises(asyncpg.InvalidPasswordError):
        await processor._connect()

    assert create_pool_mock.call_count == 1
    sleep_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_connect_retries_transient_pg_error_then_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Transient connectivity errors back off and retry until success."""
    processor = EventProcessor()
    redis_client = _mock_redis_client()

    healthy_pool = _mock_pool()
    create_pool_mock = AsyncMock(
        side_effect=[
            asyncpg.CannotConnectNowError("server is starting up"),
            healthy_pool,
        ]
    )
    sleep_mock = AsyncMock()

    monkeypatch.setattr(
        "billie_servicing.processor.redis.from_url",
        lambda *args, **kwargs: redis_client,
    )
    monkeypatch.setattr("billie_servicing.processor.asyncpg.create_pool", create_pool_mock)
    monkeypatch.setattr("billie_servicing.processor.asyncio.sleep", sleep_mock)

    await processor._connect()

    assert create_pool_mock.call_count == 2
    sleep_mock.assert_awaited_once_with(1)
    assert processor.pool is healthy_pool
