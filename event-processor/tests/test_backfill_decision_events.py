"""Back-fill of reporting.decision_event from the chatLedger archive (BTB-504)."""

from __future__ import annotations

import gzip
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from billie_servicing.scripts import backfill_decision_events as bf

if TYPE_CHECKING:
    from tests.conftest import MockPool

# 2026-10-20T01:00:00Z in milliseconds.
T0 = 1792458000000


def _record(stream_id: str, typ: str, payload: dict | str, **fields: str) -> dict:
    """An archived line as the redis-backup Lambda writes it."""
    return {
        "event_id": stream_id,
        "stream_name": "chatLedger",
        "timestamp": "2026-10-20T01:00:00+00:00",
        "fields": {
            "typ": typ,
            "conv": fields.pop("conv", "CONV-1"),
            "seq": "3",
            "payload": payload if isinstance(payload, str) else json.dumps(payload),
            **fields,
        },
        "format_version": "3.0",
    }


def _write(path: Path, lines: list) -> None:
    """Write a gzipped JSONL archive object."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        for line in lines:
            handle.write(line if isinstance(line, str) else json.dumps(line))
            handle.write("\n")


@pytest.fixture
def archive(tmp_path: Path) -> Path:
    """A two-hour archive with a duplicate delivery and noise."""
    hour1 = tmp_path / "year=2026/month=10/day=20/hour=01"
    hour2 = tmp_path / "year=2026/month=10/day=20/hour=02"
    decline = _record(
        f"{T0}-0",
        "final_credit_decision",
        {"application_number": "APP-1", "decision": "DECLINED", "reason": "BUSINESS_ACCOUNT"},
        event_id="evt-1",
    )
    _write(
        hour1 / "1792458000_a.jsonl.gz",
        [
            decline,
            _record(f"{T0 + 1}-0", "user_input", {"text": "hi"}),
            "not json",
        ],
    )
    _write(
        hour2 / "1792461600_b.jsonl.gz",
        [
            decline,  # SQS redelivery of the same stream entry
            _record(
                f"{T0 + 3_600_000}-0",
                "final_credit_decision",
                {"application_number": "APP-2", "decision": "approved", "ruleset_version": "r1"},
                conv="CONV-2",
                event_id="evt-2",
            ),
        ],
    )
    return tmp_path


def test_stream_id_time() -> None:
    """A stream id's leading milliseconds become a UTC timestamp."""
    assert bf.stream_id_time(f"{T0}-5") == datetime(2026, 10, 20, 1, 0, tzinfo=UTC)
    assert bf.stream_id_time("garbage") is None


def test_files_are_read_in_time_order(archive: Path) -> None:
    """Path order is hour order."""
    names = [p.name for p in bf.archive_files(archive)]
    assert names == ["1792458000_a.jsonl.gz", "1792461600_b.jsonl.gz"]


def test_finds_each_decision_once(archive: Path) -> None:
    """Duplicates and other event types are skipped."""
    summary = bf.Summary()
    found = list(bf.decisions(bf.read_records(bf.archive_files(archive), summary), summary))
    assert [(d.conversation_id, d.decision) for d in found] == [
        ("CONV-1", "DECLINED"),
        ("CONV-2", "APPROVED"),
    ]
    assert found[0].decided_at == datetime(2026, 10, 20, 1, 0, tzinfo=UTC)
    assert found[0].event["event_id"] == "evt-1"
    assert summary.duplicates == 1
    assert summary.unreadable_lines == 1


def test_stamped_decision_time_wins_over_stream_time(tmp_path: Path) -> None:
    """Events with a producer decided_at keep it; the stream time is the fallback."""
    _write(
        tmp_path / "year=2026/month=10/day=21/hour=00/x.jsonl.gz",
        [
            _record(
                f"{T0}-0",
                "final_credit_decision",
                {"decision": "APPROVED", "decided_at": "2026-10-20T00:59:58+00:00"},
                event_id="evt-3",
            )
        ],
    )
    summary = bf.Summary()
    [found] = bf.decisions(bf.read_records(bf.archive_files(tmp_path), summary), summary)
    assert found.decided_at == datetime(2026, 10, 20, 0, 59, 58, tzinfo=UTC)
    assert found.event["seq"] == 3  # envelope sanitized like the live path


async def test_dry_run_writes_nothing(archive: Path) -> None:
    """Without --apply no database is touched."""
    summary = await bf.run(archive, database_uri=None, apply=False)
    assert summary.decisions == 2
    assert summary.written == 0
    assert summary.outcomes == {"DECLINED": 1, "APPROVED": 1}
    text = bf.report(summary, applied=False)
    assert "dry run" in text
    assert "earliest decision:     2026-10-20T01:00:00+00:00" in text


async def test_apply_writes_through_the_live_recorder(
    archive: Path, mock_pool: MockPool, monkeypatch: pytest.MonkeyPatch
) -> None:
    """--apply records each decision with its archived time."""

    async def create_pool(*_args: object, **_kwargs: object) -> MockPool:
        mock_pool.close = _noop
        return mock_pool

    async def _noop() -> None:
        return None

    import asyncpg

    monkeypatch.setattr(asyncpg, "create_pool", create_pool)
    summary = await bf.run(archive, database_uri="postgresql://x", apply=True)
    rows = mock_pool.inserts_into("reporting.decision_event")
    assert [r["decision_key"] for r in rows] == ["evt-1", "evt-2"]
    assert rows[0]["decided_at"] == datetime(2026, 10, 20, 1, 0, tzinfo=UTC)
    assert rows[1]["ruleset_version"] == "r1"
    assert summary.written == 2


REAL_DB = os.environ.get("REPORTING_TEST_DATABASE_URI")


@pytest.mark.skipif(not REAL_DB, reason="set REPORTING_TEST_DATABASE_URI to run against Postgres")
async def test_against_postgres_is_idempotent(archive: Path) -> None:
    """Two runs against a real reporting schema write each decision once."""
    import asyncpg

    conn = await asyncpg.connect(REAL_DB)
    try:
        await conn.execute(
            "DELETE FROM reporting.decision_event WHERE decision_key IN ('evt-1', 'evt-2')"
        )
        first = await bf.run(archive, database_uri=REAL_DB, apply=True)
        second = await bf.run(archive, database_uri=REAL_DB, apply=True)
        assert (first.written, second.written, second.already_recorded) == (2, 0, 2)
        row = await conn.fetchrow(
            "SELECT decided_on::text AS d, reason FROM reporting.decision_event "
            "WHERE decision_key = 'evt-1'"
        )
        assert dict(row) == {"d": "2026-10-20", "reason": "BUSINESS_ACCOUNT"}
    finally:
        await conn.execute(
            "DELETE FROM reporting.decision_event WHERE decision_key IN ('evt-1', 'evt-2')"
        )
        await conn.close()
