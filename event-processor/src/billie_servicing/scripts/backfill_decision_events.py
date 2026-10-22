"""Back-fill reporting.decision_event from the S3 chatLedger archive (BTB-504).

The live processor records every final_credit_decision from the day it is
deployed. Older decisions are in the chatLedger archive that the
redis-backup pipeline (billie-platform-tooling) writes to the events bucket:
gzipped JSONL, one object per stream per Lambda batch, under
``chatLedger/year=YYYY/month=MM/day=DD/hour=HH/``.

The script reads a local copy of that prefix, so it needs no AWS client:

  aws s3 sync s3://billie-events-prod-<account>/chatLedger/ ./chatLedger \\
      --profile billie-prod
  python3 -m billie_servicing.scripts.backfill_decision_events --source ./chatLedger
  python3 -m billie_servicing.scripts.backfill_decision_events --source ./chatLedger --apply

It writes only to reporting.decision_event, never to the CRM projection, so it
is safe to run against a live database and safe to run more than once: rows are
keyed by the producer event id, which the live copy shares, and inserts that
hit an existing key do nothing. Archived lines are de-duplicated on their
stream entry id (SQS delivers at least once).

The archive starts when the backup consumer first read chatLedger in prod.
The summary prints the earliest decision found; nothing earlier can be
recovered.
"""

from __future__ import annotations

import argparse
import asyncio
import gzip
import json
import os
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..handlers.reporting import (
    conversation_of,
    decision_of,
    decision_time,
    record_decision_event,
)
from ..handlers.sanitize import parse_payload
from ..processor import sanitize_envelope

DECISION_TYPE = "final_credit_decision"


@dataclass
class ArchivedDecision:
    """One final_credit_decision read from the archive."""

    stream_id: str
    event: dict[str, Any]
    payload: dict[str, Any]
    conversation_id: str
    decision: str
    decided_at: datetime
    """The producer's ``decided_at`` when stamped, else the stream entry time."""


@dataclass
class Summary:
    """What a run found and wrote."""

    files: int = 0
    lines: int = 0
    unreadable_lines: int = 0
    duplicates: int = 0
    decisions: int = 0
    written: int = 0
    already_recorded: int = 0
    outcomes: Counter = field(default_factory=Counter)
    earliest: datetime | None = None
    latest: datetime | None = None

    def see(self, decided_at: datetime) -> None:
        """Track the decision time range."""
        if self.earliest is None or decided_at < self.earliest:
            self.earliest = decided_at
        if self.latest is None or decided_at > self.latest:
            self.latest = decided_at


def stream_id_time(stream_id: str) -> datetime | None:
    """The millisecond timestamp a Redis stream entry id starts with."""
    millis, _, _ = stream_id.partition("-")
    if not millis.isdigit():
        return None
    return datetime.fromtimestamp(int(millis) / 1000, tz=UTC)


def archive_files(source: Path) -> list[Path]:
    """Archive objects in time order.

    Keys are ``year=/month=/day=/hour=/<epoch seconds>_<uuid>.jsonl.gz``, all
    zero-padded, so path order is time order.
    """
    return sorted(source.rglob("*.jsonl.gz"))


def read_records(files: Iterable[Path], summary: Summary) -> Iterator[dict[str, Any]]:
    """Yield every archived record, skipping lines that are not JSON objects."""
    for path in files:
        summary.files += 1
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                summary.lines += 1
                try:
                    record = json.loads(line)
                except ValueError:
                    summary.unreadable_lines += 1
                    continue
                if isinstance(record, dict):
                    yield record
                else:
                    summary.unreadable_lines += 1


def decisions(records: Iterable[dict[str, Any]], summary: Summary) -> Iterator[ArchivedDecision]:
    """Yield each distinct final_credit_decision in the records."""
    seen: set[str] = set()
    for record in records:
        fields = record.get("fields")
        if not isinstance(fields, dict):
            continue
        if (fields.get("typ") or fields.get("msg_type")) != DECISION_TYPE:
            continue
        stream_id = str(record.get("event_id") or "")
        if stream_id in seen:
            summary.duplicates += 1
            continue
        if stream_id:
            seen.add(stream_id)
        event = sanitize_envelope(fields)
        payload = parse_payload(event)
        decision = decision_of(event, payload)
        try:
            conversation_id = conversation_of(event)
        except ValueError:
            conversation_id = ""
        archived_at = stream_id_time(stream_id)
        if archived_at is None and record.get("timestamp"):
            try:
                stamp = str(record["timestamp"]).replace("Z", "+00:00")
                archived_at = datetime.fromisoformat(stamp)
            except ValueError:
                archived_at = None
        decided_at = (
            decision_time(payload, archived_at)
            if archived_at or payload.get("decided_at")
            else None
        )
        if not decision or not conversation_id or decided_at is None:
            summary.unreadable_lines += 1
            continue
        yield ArchivedDecision(
            stream_id=stream_id,
            event=event,
            payload=payload,
            conversation_id=conversation_id,
            decision=decision,
            decided_at=decided_at,
        )


async def run(source: Path, *, database_uri: str | None, apply: bool) -> Summary:
    """Read the archive and, with ``apply``, write the decision events."""
    summary = Summary()
    pool = None
    if apply:
        import asyncpg  # noqa: PLC0415 — only needed when writing

        pool = await asyncpg.create_pool(database_uri, min_size=1, max_size=2)
    try:
        for found in decisions(read_records(archive_files(source), summary), summary):
            summary.decisions += 1
            summary.outcomes[found.decision] += 1
            summary.see(found.decided_at)
            if pool is None:
                continue
            wrote = await record_decision_event(
                pool,
                found.event,
                found.payload,
                conversation_id=found.conversation_id,
                decision=found.decision,
                decided_at=found.decided_at,
            )
            if wrote:
                summary.written += 1
            else:
                summary.already_recorded += 1
    finally:
        if pool is not None:
            await pool.close()
    return summary


def report(summary: Summary, *, applied: bool) -> str:
    """Human-readable summary of a run."""
    outcomes = ", ".join(f"{k} {v}" for k, v in sorted(summary.outcomes.items())) or "none"
    lines = [
        f"files read:            {summary.files}",
        f"lines read:            {summary.lines}",
        f"unreadable lines:      {summary.unreadable_lines}",
        f"duplicate deliveries:  {summary.duplicates}",
        f"decisions found:       {summary.decisions} ({outcomes})",
        f"earliest decision:     {summary.earliest.isoformat() if summary.earliest else '-'}",
        f"latest decision:       {summary.latest.isoformat() if summary.latest else '-'}",
    ]
    if applied:
        lines += [
            f"rows written:          {summary.written}",
            f"already recorded:      {summary.already_recorded}",
        ]
    else:
        lines.append("dry run: nothing written; pass --apply to write")
    return "\n".join(lines)


def main() -> None:
    """Command-line entry point."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--source", required=True, type=Path, help="local copy of the chatLedger/ prefix"
    )
    parser.add_argument("--apply", action="store_true", help="write to reporting.decision_event")
    parser.add_argument(
        "--database-uri",
        default=os.environ.get("DATABASE_URI"),
        help="defaults to $DATABASE_URI",
    )
    args = parser.parse_args()
    if not args.source.is_dir():
        parser.error(f"--source {args.source} is not a directory")
    if args.apply and not args.database_uri:
        parser.error("--apply needs --database-uri or $DATABASE_URI")
    summary = asyncio.run(run(args.source, database_uri=args.database_uri, apply=args.apply))
    print(report(summary, applied=args.apply))


if __name__ == "__main__":
    main()
