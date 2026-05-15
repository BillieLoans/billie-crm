"""Pytest configuration and fixtures for event processor tests.

The Mongo → Postgres migration changed handler signatures from
``handler(db: AsyncIOMotorDatabase, event)`` to
``handler(pool: asyncpg.Pool, event)``.

``mock_pool`` is the new fixture. ``mock_db`` is kept as a thin alias that
points at the same object so legacy tests don't ``ImportError`` — but their
assertions (which look at ``insert_one`` / ``update_one`` call shapes) need
rewriting against the new ``execute`` call shapes. Those rewrites are a
follow-up; see the task list.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


class _MockTransaction:
    """Async context manager standing in for asyncpg's transaction()."""

    async def __aenter__(self) -> "_MockTransaction":
        return self

    async def __aexit__(self, *_exc: Any) -> bool | None:
        return None


class MockConnection:
    """Mock asyncpg.Connection — records every SQL call for assertions."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        # Default returns: callers override via .set_return / direct AsyncMock patching.
        self.execute = AsyncMock(side_effect=self._record_execute)
        self.fetchval = AsyncMock(side_effect=self._record_fetchval)
        self.fetchrow = AsyncMock(side_effect=self._record_fetchrow)
        self.fetch = AsyncMock(side_effect=self._record_fetch)
        self._fetchval_returns: Any = None
        self._fetchrow_returns: Any = None
        self._fetch_returns: list[Any] = []

    def set_fetchval(self, value: Any) -> None:
        self._fetchval_returns = value

    def set_fetchrow(self, value: Any) -> None:
        self._fetchrow_returns = value

    def set_fetch(self, value: list[Any]) -> None:
        self._fetch_returns = value

    async def _record_execute(self, sql: str, *args: Any) -> str:
        self.calls.append((sql, args))
        # asyncpg returns a status string like "INSERT 0 1" — fine for tests.
        return "INSERT 0 1"

    async def _record_fetchval(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        return self._fetchval_returns

    async def _record_fetchrow(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        return self._fetchrow_returns

    async def _record_fetch(self, sql: str, *args: Any) -> list[Any]:
        self.calls.append((sql, args))
        return list(self._fetch_returns)

    def transaction(self) -> _MockTransaction:
        return _MockTransaction()


class _AcquireCtx:
    def __init__(self, conn: MockConnection) -> None:
        self._conn = conn

    async def __aenter__(self) -> MockConnection:
        return self._conn

    async def __aexit__(self, *_exc: Any) -> bool | None:
        return None


class MockPool:
    """Mock asyncpg.Pool — shares one MockConnection across acquire() calls.

    Tests can inspect ``mock_pool.connection.calls`` to assert on the SQL that
    handlers executed.
    """

    def __init__(self) -> None:
        self.connection = MockConnection()
        # Pool-level methods proxy through to the same connection so tests
        # don't have to distinguish between ``pool.execute(...)`` and
        # ``async with pool.acquire() as conn: await conn.execute(...)``.
        self.execute = self.connection.execute
        self.fetchval = self.connection.fetchval
        self.fetchrow = self.connection.fetchrow
        self.fetch = self.connection.fetch

    def acquire(self) -> _AcquireCtx:
        return _AcquireCtx(self.connection)


@pytest.fixture
def mock_pool() -> MockPool:
    """asyncpg-shaped mock the new handlers consume."""
    return MockPool()


@pytest.fixture
def mock_db(mock_pool: MockPool) -> MockPool:
    """Alias for legacy tests still importing ``mock_db``.

    Note: legacy tests asserting on ``mock_db["collection"].insert_one`` etc.
    will fail — handler call shape changed from Mongo update_one/insert_one
    to asyncpg.execute(sql, *args). Rewrite assertions to inspect
    ``mock_pool.connection.calls`` instead.
    """
    return mock_pool


# Stand-in objects for legacy MockDatabase / MockCollection imports so any
# test that still imports them at module level can be collected. The objects
# themselves are unused by the new handlers.
MockDatabase = MockPool
MockCollection = MagicMock


@pytest.fixture
def sample_customer_changed_event():
    """Sample customer.changed.v1 event from SDK."""
    return {
        "typ": "customer.changed.v1",
        "cid": "conv-123",
        "usr": "CUS-TEST-001",
        "seq": 1,
        "dat": {
            "customer_id": "CUS-TEST-001",
            "first_name": "John",
            "last_name": "Smith",
            "email_address": "john.smith@test.com",
            "mobile_phone_number": "0412345678",
            "date_of_birth": "1985-06-15",
            "residential_address": {
                "address_type": "RESIDENTIAL",
                "street_number": "123",
                "street_name": "Test",
                "street_type": "St",
                "suburb": "Sydney",
                "state": "NSW",
                "postcode": "2000",
                "country": "Australia",
                "full_address": "123 Test St, Sydney NSW 2000, Australia",
            },
            "changed_at": datetime.utcnow().isoformat(),
        },
    }


@pytest.fixture
def sample_account_created_event():
    """Sample account.created.v1 event from SDK."""
    return {
        "typ": "account.created.v1",
        "cid": "conv-123",
        "usr": "CUS-TEST-001",
        "seq": 1,
        "dat": {
            "account_id": "ACC-TEST-001",
            "account_number": "ACC-12345",
            "customer_id": "CUS-TEST-001",
            "status": "ACTIVE",
            "loan_amount": "500.00",
            "current_balance": "500.00",
            "loan_fee": "80.00",
            "loan_total_payable": "580.00",
            "opened_date": "2024-01-15",
        },
    }


@pytest.fixture
def sample_schedule_created_event():
    """Sample account.schedule.created.v1 event from SDK."""
    return {
        "typ": "account.schedule.created.v1",
        "cid": "conv-123",
        "usr": "CUS-TEST-001",
        "seq": 1,
        "dat": {
            "account_id": "ACC-TEST-001",
            "schedule_id": "SCHED-001",
            "loan_amount": "500.00",
            "total_amount": "580.00",
            "fee": "80.00",
            "n_payments": 4,
            "payment_frequency": "fortnightly",
            "payments": [
                {"payment_number": 1, "due_date": "2024-01-22", "amount": "145.00"},
                {"payment_number": 2, "due_date": "2024-02-05", "amount": "145.00"},
                {"payment_number": 3, "due_date": "2024-02-19", "amount": "145.00"},
                {"payment_number": 4, "due_date": "2024-03-04", "amount": "145.00"},
            ],
            "created_date": "2024-01-15",
        },
    }


@pytest.fixture
def sample_conversation_started_event():
    """Sample conversation_started chat event."""
    return {
        "typ": "conversation_started",
        "cid": "CONV-TEST-001",
        "usr": "CUS-TEST-001",
        "app_number": "APP-12345",
        "timestamp": datetime.utcnow().isoformat(),
    }


@pytest.fixture
def sample_user_input_event():
    """Sample user_input chat event."""
    return {
        "typ": "user_input",
        "cid": "CONV-TEST-001",
        "usr": "CUS-TEST-001",
        "payload": {
            "utterance": "I need a loan of $500",
            "created_at": datetime.utcnow().isoformat(),
        },
    }


@pytest.fixture
def sample_assistant_response_event():
    """Sample assistant_response chat event."""
    return {
        "typ": "assistant_response",
        "cid": "CONV-TEST-001",
        "usr": "CUS-TEST-001",
        "payload": {
            "utterance": "I can help you with that. Let me get some details.",
            "rationale": "Customer requested loan amount",
            "created_at": datetime.utcnow().isoformat(),
        },
    }


@pytest.fixture
def sample_final_decision_event():
    """Sample final_decision chat event."""
    return {
        "typ": "final_decision",
        "cid": "CONV-TEST-001",
        "usr": "CUS-TEST-001",
        "decision": "APPROVED",
        "outcome": "APPROVED",
    }


@pytest.fixture
def sample_schedule_updated_event():
    """Sample account.schedule.updated.v1 event from SDK."""
    return {
        "typ": "account.schedule.updated.v1",
        "cid": "conv-123",
        "usr": "CUS-TEST-001",
        "seq": 1,
        "dat": {
            "account_id": "ACC-TEST-001",
            "schedule_id": "SCHED-001",
            "payments": [
                {
                    "payment_number": 1,
                    "status": "paid",
                    "paid_date": "2024-01-22",
                    "paid_amount": "145.00",
                },
            ],
        },
    }

