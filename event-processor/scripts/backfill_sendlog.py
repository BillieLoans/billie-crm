"""C1 cutover: backfill the legacy Apps Script send log into marketing interactions.

The pre-cutover stack sent SMS/WhatsApp via Google Apps Script; its send log
(exported to CSV) is the only record of those sends. This importer replays each
row as a marketingService LogInteraction (kind=message_out,
source_system=apps_script) against the contact resolved by mobile, so
pre-cutover sends appear on contact timelines exactly like platform sends.

Usage (run wherever DATABASE_URI + MARKETING_GRPC_ADDRESS reach the target env):

    python -m scripts.backfill_sendlog export.csv --dry-run
    python -m scripts.backfill_sendlog export.csv

CSV columns (header required; extra columns ignored):
    timestamp  — ISO-8601 or `DD/MM/YYYY HH:MM[:SS]` (AU sheet format)
    mobile     — recipient (any AU format; normalised to E.164)
    channel    — sms | whatsapp (defaults to sms)
    subject    — optional (template name)
    body       — message text

Idempotent: the LogInteraction idempotency key is a hash of the raw row, so
re-running the import (or resuming after a crash) never duplicates
interactions. Rows whose mobile matches no contact are written to
`<input>.unmatched.csv` for manual review — they are NOT dropped silently.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from billie_servicing import marketing_client  # noqa: E402
from billie_servicing.handlers.clicksend import normalise_au_mobile  # noqa: E402

_AU_TZ = ZoneInfo("Australia/Sydney")


def parse_timestamp(raw: str) -> str | None:
    """Coerce a send-log timestamp to ISO-8601 UTC. Sheet exports use
    DD/MM/YYYY; ISO inputs pass through."""
    value = (raw or "").strip()
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        dt = None
        for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
            try:
                dt = datetime.strptime(value, fmt)
                break
            except ValueError:
                continue
        if dt is None:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_AU_TZ)
    return dt.astimezone(timezone.utc).isoformat()


def row_key(row: dict[str, str]) -> str:
    """Stable idempotency key per raw row — re-imports are no-ops."""
    canon = json.dumps(
        {k: (row.get(k) or "").strip() for k in ("timestamp", "mobile", "channel", "subject", "body")},
        sort_keys=True,
    )
    return "appsscript:" + hashlib.sha256(canon.encode()).hexdigest()[:24]


async def run(csv_path: Path, *, dry_run: bool) -> int:
    dsn = os.environ.get("DATABASE_URI")
    if not dsn:
        print("DATABASE_URI is required (CRM projection DB, for contact resolution)")
        return 2

    pool = await asyncpg.create_pool(dsn, min_size=1, max_size=2)
    imported = skipped_unmatched = skipped_bad = 0
    unmatched_rows: list[dict[str, str]] = []

    with csv_path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            mobile = normalise_au_mobile(row.get("mobile"))
            occurred_at = parse_timestamp(row.get("timestamp", ""))
            body = (row.get("body") or "").strip()
            if not mobile or not occurred_at or not body:
                skipped_bad += 1
                unmatched_rows.append({**row, "_reason": "unparseable"})
                continue

            contact_id = await pool.fetchval(
                "SELECT contact_id FROM contacts WHERE mobile_e164 = $1 AND erased IS NOT TRUE",
                mobile,
            )
            if contact_id is None:
                skipped_unmatched += 1
                unmatched_rows.append({**row, "_reason": "no contact"})
                continue

            if dry_run:
                imported += 1
                continue

            await marketing_client.log_interaction(
                idempotency_key=row_key(row),
                contact_id=str(contact_id),
                kind="message_out",
                channel=(row.get("channel") or "sms").strip().lower(),
                direction="outbound",
                subject=(row.get("subject") or "").strip(),
                body=body,
                source_system="apps_script",
                occurred_at=occurred_at,
                metadata_json=json.dumps({"backfill": "apps_script_sendlog"}),
                actor="backfill",
            )
            imported += 1

    await pool.close()

    if unmatched_rows:
        out = csv_path.with_suffix(".unmatched.csv")
        with out.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(unmatched_rows[0].keys()))
            writer.writeheader()
            writer.writerows(unmatched_rows)
        print(f"unmatched/bad rows written to {out}")

    mode = "DRY RUN — would import" if dry_run else "imported"
    print(f"{mode} {imported}; unmatched {skipped_unmatched}; unparseable {skipped_bad}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, help="Apps Script send-log CSV export")
    parser.add_argument("--dry-run", action="store_true", help="resolve + count only, no writes")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args.csv, dry_run=args.dry_run)))


if __name__ == "__main__":
    main()
