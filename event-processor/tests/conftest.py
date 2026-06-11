"""Pytest configuration and fixtures for event processor tests.

Handlers take an ``asyncpg.Pool``. The ``MockPool`` fixture records every
SQL call into structured ``ParsedCall`` objects (op + table + values +
WHERE + ON CONFLICT) so tests can assert on table-level shapes without
parsing SQL by hand.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import AsyncMock

import pytest


@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


# ---------------------------------------------------------------------------
# SQL parsing — extract structured calls from the asyncpg.execute(sql, *args)
# stream so tests can assert on "what got inserted into table X".
# ---------------------------------------------------------------------------

_INSERT_RE = re.compile(
    r"INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)",
    re.IGNORECASE | re.DOTALL,
)
_UPDATE_RE = re.compile(
    r"UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+?)(?:$|;)",
    re.IGNORECASE | re.DOTALL,
)
_SELECT_RE = re.compile(
    r"SELECT\s+.+?\s+FROM\s+(\w+)",
    re.IGNORECASE | re.DOTALL,
)
_DELETE_RE = re.compile(
    r"DELETE\s+FROM\s+(\w+)",
    re.IGNORECASE | re.DOTALL,
)
_CONFLICT_RE = re.compile(
    r"ON\s+CONFLICT\s*\(([^)]+)\)",
    re.IGNORECASE | re.DOTALL,
)
_PLACEHOLDER_RE = re.compile(r"\$(\d+)")


def _split_csv(text: str) -> list[str]:
    """Split a comma-separated SQL fragment, ignoring whitespace."""
    return [token.strip() for token in text.split(",") if token.strip()]


def _arg_for(token: str, args: tuple[Any, ...]) -> Any:
    """Resolve $N placeholder → positional arg value. Non-placeholders return verbatim."""
    match = _PLACEHOLDER_RE.fullmatch(token.strip())
    if not match:
        return token.strip().strip("'")
    idx = int(match.group(1)) - 1
    return args[idx] if 0 <= idx < len(args) else None


@dataclass
class ParsedCall:
    sql: str
    args: tuple[Any, ...]
    op: str  # INSERT | UPDATE | DELETE | SELECT | OTHER
    table: str | None = None
    values: dict[str, Any] = field(default_factory=dict)  # for INSERT and UPDATE SET
    where: dict[str, Any] = field(default_factory=dict)  # for UPDATE WHERE
    conflict_columns: list[str] = field(default_factory=list)


def _parse_call(sql: str, args: tuple[Any, ...]) -> ParsedCall:
    sql_clean = sql.strip()
    upper = sql_clean.upper()

    if upper.startswith("INSERT"):
        m = _INSERT_RE.search(sql_clean)
        if m:
            table = m.group(1)
            cols = _split_csv(m.group(2))
            placeholders = _split_csv(m.group(3))
            # Strip ::jsonb / ::bigint casts off placeholders like "$9::jsonb".
            placeholders = [p.split("::")[0] for p in placeholders]
            values = {}
            for col, ph in zip(cols, placeholders):
                values[col] = _arg_for(ph, args)
            conflict_match = _CONFLICT_RE.search(sql_clean)
            conflict_cols = (
                _split_csv(conflict_match.group(1)) if conflict_match else []
            )
            return ParsedCall(
                sql=sql_clean, args=args, op="INSERT", table=table,
                values=values, conflict_columns=conflict_cols,
            )
        return ParsedCall(sql=sql_clean, args=args, op="INSERT")

    if upper.startswith("UPDATE"):
        m = _UPDATE_RE.search(sql_clean)
        if m:
            table = m.group(1)
            set_clause = m.group(2)
            where_clause = m.group(3)
            values: dict[str, Any] = {}
            for assignment in _split_csv(set_clause):
                if "=" not in assignment:
                    continue
                col, rhs = assignment.split("=", 1)
                col = col.strip()
                rhs = rhs.strip().split("::")[0]
                values[col] = _arg_for(rhs, args)
            where: dict[str, Any] = {}
            for assignment in _split_csv(where_clause):
                if "=" not in assignment:
                    continue
                col, rhs = assignment.split("=", 1)
                col = col.strip()
                rhs = rhs.strip().split("::")[0]
                where[col] = _arg_for(rhs, args)
            return ParsedCall(
                sql=sql_clean, args=args, op="UPDATE", table=table,
                values=values, where=where,
            )
        return ParsedCall(sql=sql_clean, args=args, op="UPDATE")

    # WITH … DELETE / INSERT / UPDATE — classify by the operation that
    # follows the CTE, not by the leading keyword.
    if "DELETE FROM" in upper:
        m = _DELETE_RE.search(sql_clean)
        return ParsedCall(
            sql=sql_clean, args=args, op="DELETE",
            table=m.group(1) if m else None,
        )

    if upper.startswith("SELECT") or upper.startswith("WITH"):
        m = _SELECT_RE.search(sql_clean)
        return ParsedCall(
            sql=sql_clean, args=args, op="SELECT",
            table=m.group(1) if m else None,
        )

    return ParsedCall(sql=sql_clean, args=args, op="OTHER")


# ---------------------------------------------------------------------------
# Mock asyncpg objects
# ---------------------------------------------------------------------------


class _MockTransaction:
    async def __aenter__(self) -> "_MockTransaction":
        return self

    async def __aexit__(self, *_exc: Any) -> bool | None:
        return None


class MockConnection:
    """Records every SQL call. ``calls`` is the chronological list of
    :class:`ParsedCall` objects. fetchval/fetchrow/fetch return values are
    overridable via ``set_fetchval`` etc.
    """

    def __init__(self) -> None:
        self.calls: list[ParsedCall] = []
        self.execute = AsyncMock(side_effect=self._record_execute)
        self.fetchval = AsyncMock(side_effect=self._record_fetchval)
        self.fetchrow = AsyncMock(side_effect=self._record_fetchrow)
        self.fetch = AsyncMock(side_effect=self._record_fetch)
        self._fetchval_returns: Any = None
        self._fetchval_sequence: list[Any] = []
        self._fetchrow_returns: Any = None
        self._fetch_returns: list[Any] = []

    def set_fetchval(self, value: Any) -> None:
        self._fetchval_returns = value

    def set_fetchval_sequence(self, values: list[Any]) -> None:
        """Queue per-call fetchval returns (popped in order; falls back to
        ``set_fetchval``'s value once exhausted). For handlers that issue
        multiple different lookups."""
        self._fetchval_sequence = list(values)

    def set_fetchrow(self, value: Any) -> None:
        self._fetchrow_returns = value

    def set_fetch(self, value: list[Any]) -> None:
        self._fetch_returns = value

    async def _record_execute(self, sql: str, *args: Any) -> str:
        self.calls.append(_parse_call(sql, args))
        return "INSERT 0 1"

    async def _record_fetchval(self, sql: str, *args: Any) -> Any:
        self.calls.append(_parse_call(sql, args))
        if self._fetchval_sequence:
            return self._fetchval_sequence.pop(0)
        return self._fetchval_returns

    async def _record_fetchrow(self, sql: str, *args: Any) -> Any:
        self.calls.append(_parse_call(sql, args))
        return self._fetchrow_returns

    async def _record_fetch(self, sql: str, *args: Any) -> list[Any]:
        self.calls.append(_parse_call(sql, args))
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
    """asyncpg.Pool-shaped mock with table-aware test helpers.

    Pool-level ``execute``/``fetchval`` etc. proxy through to a single
    shared :class:`MockConnection`, so handlers that use ``pool.execute``
    and those that ``async with pool.acquire()`` both record calls in the
    same list.
    """

    def __init__(self) -> None:
        self.connection = MockConnection()
        self.execute = self.connection.execute
        self.fetchval = self.connection.fetchval
        self.fetchrow = self.connection.fetchrow
        self.fetch = self.connection.fetch

    def acquire(self) -> _AcquireCtx:
        return _AcquireCtx(self.connection)

    # --- test helpers ------------------------------------------------------

    def set_fetchval(self, value: Any) -> None:
        """Set the default return for the next fetchval call(s)."""
        self.connection.set_fetchval(value)

    def set_fetchval_sequence(self, values: list[Any]) -> None:
        """Queue per-call fetchval returns (popped in order)."""
        self.connection.set_fetchval_sequence(values)

    def set_fetchrow(self, value: Any) -> None:
        self.connection.set_fetchrow(value)

    @property
    def calls(self) -> list[ParsedCall]:
        return self.connection.calls

    def calls_against(self, table: str) -> list[ParsedCall]:
        return [c for c in self.connection.calls if c.table == table]

    def inserts_into(self, table: str) -> list[dict[str, Any]]:
        """Return values dicts for every INSERT against <table>."""
        return [c.values for c in self.connection.calls if c.op == "INSERT" and c.table == table]

    def updates_to(self, table: str) -> list[dict[str, Any]]:
        """Return values dicts for every UPDATE on <table>."""
        return [c.values for c in self.connection.calls if c.op == "UPDATE" and c.table == table]

    def last_insert(self, table: str) -> dict[str, Any] | None:
        rows = self.inserts_into(table)
        return rows[-1] if rows else None

    def last_update(self, table: str) -> dict[str, Any] | None:
        rows = self.updates_to(table)
        return rows[-1] if rows else None

    def last_upsert(self, table: str) -> dict[str, Any] | None:
        """Return values dict from the most recent INSERT or UPDATE against
        <table>. Most handlers do upserts so this is the common assertion."""
        merged: list[dict[str, Any]] = []
        for c in self.connection.calls:
            if c.table == table and c.op in {"INSERT", "UPDATE"}:
                merged.append(c.values)
        return merged[-1] if merged else None

    def has_call_against(self, table: str) -> bool:
        return any(c.table == table for c in self.connection.calls)

    def jsonb_merges(self, table: str, column: str) -> list[dict[str, Any]]:
        """Return the parsed JSON patches merged into ``column`` of ``table``.

        Matches the SQL pattern emitted by ``db.merge_jsonb``:
            UPDATE {table} SET {column} = COALESCE({column}, '{}'::jsonb) || $1::jsonb …
        """
        import json
        result: list[dict[str, Any]] = []
        for c in self.connection.calls:
            if c.op != "UPDATE" or c.table != table:
                continue
            if f"{column} = COALESCE" not in c.sql:
                continue
            if not c.args:
                continue
            try:
                result.append(json.loads(c.args[0]))
            except (TypeError, ValueError, json.JSONDecodeError):
                pass
        return result

    def last_jsonb_merge(self, table: str, column: str) -> dict[str, Any] | None:
        merges = self.jsonb_merges(table, column)
        return merges[-1] if merges else None


@pytest.fixture
def mock_pool() -> MockPool:
    return MockPool()
