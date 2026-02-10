"""Tests for EventProcessor connection startup behavior."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from pymongo.errors import OperationFailure, ServerSelectionTimeoutError

from billie_servicing.processor import EventProcessor


def _mock_redis_client() -> MagicMock:
    """Create a mock Redis client with a healthy ping."""
    client = MagicMock()
    client.ping = AsyncMock(return_value=True)
    client.close = AsyncMock()
    return client


def _mock_mongo_client(command_side_effect: Exception | None = None) -> tuple[MagicMock, MagicMock]:
    """Create a mock Mongo client and db with configurable ping behavior."""
    mongo_client = MagicMock()
    db = MagicMock()
    if command_side_effect is None:
        db.command = AsyncMock(return_value={"ok": 1})
    else:
        db.command = AsyncMock(side_effect=command_side_effect)
    mongo_client.__getitem__.return_value = db
    mongo_client.close = MagicMock()
    return mongo_client, db


@pytest.mark.asyncio
async def test_connect_fails_fast_on_mongo_auth_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Auth/permission errors are non-transient and should not retry forever."""
    processor = EventProcessor()

    redis_client = _mock_redis_client()
    mongo_client, _ = _mock_mongo_client(
        OperationFailure("Authentication failed.", code=18),
    )

    mongo_factory = MagicMock(return_value=mongo_client)
    sleep_mock = AsyncMock()

    monkeypatch.setattr("billie_servicing.processor.redis.from_url", lambda *args, **kwargs: redis_client)
    monkeypatch.setattr("billie_servicing.processor.AsyncIOMotorClient", mongo_factory)
    monkeypatch.setattr("billie_servicing.processor.asyncio.sleep", sleep_mock)

    with pytest.raises(OperationFailure):
        await processor._connect()

    assert mongo_factory.call_count == 1
    sleep_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_connect_retries_transient_mongo_error_then_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Transient Mongo connectivity errors should back off and retry."""
    processor = EventProcessor()

    redis_client = _mock_redis_client()
    mongo_client_1, _ = _mock_mongo_client(
        ServerSelectionTimeoutError("Server selection timeout"),
    )
    mongo_client_2, mongo_db_2 = _mock_mongo_client()

    mongo_factory = MagicMock(side_effect=[mongo_client_1, mongo_client_2])
    sleep_mock = AsyncMock()

    monkeypatch.setattr("billie_servicing.processor.redis.from_url", lambda *args, **kwargs: redis_client)
    monkeypatch.setattr("billie_servicing.processor.AsyncIOMotorClient", mongo_factory)
    monkeypatch.setattr("billie_servicing.processor.asyncio.sleep", sleep_mock)

    await processor._connect()

    assert mongo_factory.call_count == 2
    sleep_mock.assert_awaited_once_with(1)
    mongo_client_1.close.assert_called_once()
    assert processor.mongo is mongo_client_2
    assert processor.db is mongo_db_2
