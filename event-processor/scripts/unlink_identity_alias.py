#!/usr/bin/env python3
"""Undo an identity link in the CRM projection (BTB-392, reconciliation Step 4b).

When the platform reconciliation cuts a link (a bound alias that an earlier
billieChat decision had attached to the wrong canonical), the CRM still holds
the re-attribution: ``customers.merged_into`` on the alias row, and the
alias's conversations / loan accounts / applications moved under the old
canonical. This script moves them back.

Rows the event processor re-attributed after SP4 carry
``identity_origin_customer_id`` and need nothing else. Rows moved before that
(the demo's pre-existing cut aliases) have no origin id; pass them with
``--rows``, a CSV of ``table,key_column,key_value`` derived from the billieChat
ledger (``conversation_started.usr`` -> conversation_id;
``account.created.v1.customer_id`` -> loan_account_id; applications by
application_number).

Safe by default: dry run prints the row counts per table and changes nothing.
``--apply`` runs everything in one transaction.

Examples:
    DATABASE_URI=postgresql://... python scripts/unlink_identity_alias.py \\
        --alias 23D47AB2 --canonical BD7195B9
    DATABASE_URI=postgresql://... python scripts/unlink_identity_alias.py \\
        --alias 23D47AB2 --canonical BD7195B9 --rows rows.csv --apply
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import os
import sys
from dataclasses import dataclass
from typing import Any

# (table, key column the CSV may name it by)
STRING_KEYED_TABLES = ("conversations", "loan_accounts")
ROW_KEY_COLUMNS = {
    "conversations": "conversation_id",
    "loan_accounts": "loan_account_id",
    "applications": "application_number",
}


@dataclass
class UnlinkPlan:
    alias_id: str
    canonical_id: str
    rows: dict[str, list[str]]  # table -> explicit key values (from --rows)


@dataclass
class UnlinkResult:
    moved: dict[str, int]
    tombstone_cleared: bool


def read_rows_csv(path: str) -> dict[str, list[str]]:
    """``table,key_column,key_value`` lines -> {table: [key_value, ...]}."""
    rows: dict[str, list[str]] = {t: [] for t in ROW_KEY_COLUMNS}
    with open(path, newline="") as fh:
        for line_no, record in enumerate(csv.reader(fh), start=1):
            if not record or record[0].startswith("#"):
                continue
            if len(record) != 3:
                raise SystemExit(f"{path}:{line_no}: expected table,key_column,key_value")
            table, key_column, key_value = (c.strip() for c in record)
            expected = ROW_KEY_COLUMNS.get(table)
            if expected is None or key_column != expected:
                raise SystemExit(
                    f"{path}:{line_no}: unsupported {table}.{key_column} "
                    f"(allowed: {', '.join(f'{t}.{c}' for t, c in ROW_KEY_COLUMNS.items())})"
                )
            rows[table].append(key_value)
    return rows


async def count_candidates(conn: Any, plan: UnlinkPlan) -> dict[str, int]:
    """How many rows would move back, per table (origin-tagged + listed)."""
    counts: dict[str, int] = {}
    for table in STRING_KEYED_TABLES:
        counts[table] = await conn.fetchval(
            f"SELECT count(*) FROM {table} WHERE customer_id_string = $1 "
            f"AND (identity_origin_customer_id = $2 "
            f"OR {ROW_KEY_COLUMNS[table]} = ANY($3::text[]))",
            plan.canonical_id,
            plan.alias_id,
            plan.rows.get(table, []),
        )
    counts["applications"] = await conn.fetchval(
        "SELECT count(*) FROM applications a "
        "WHERE a.customer_id_id = (SELECT id FROM customers WHERE customer_id = $1) "
        "AND (a.identity_origin_customer_id = $2 "
        "OR a.application_number = ANY($3::text[]))",
        plan.canonical_id,
        plan.alias_id,
        plan.rows.get("applications", []),
    )
    return counts


async def apply_unlink(conn: Any, plan: UnlinkPlan) -> UnlinkResult:
    """Move the alias's rows back and clear its tombstone, in one transaction."""
    alias_ref = await conn.fetchval(
        "SELECT id FROM customers WHERE customer_id = $1", plan.alias_id
    )
    canonical_ref = await conn.fetchval(
        "SELECT id FROM customers WHERE customer_id = $1", plan.canonical_id
    )
    moved: dict[str, int] = {}
    async with conn.transaction():
        for table in STRING_KEYED_TABLES:
            status = await conn.execute(
                f"UPDATE {table} SET customer_id_string = $1, customer_id_id = $2, "
                f"identity_origin_customer_id = NULL "
                f"WHERE customer_id_string = $3 "
                f"AND (identity_origin_customer_id = $1 "
                f"OR {ROW_KEY_COLUMNS[table]} = ANY($4::text[]))",
                plan.alias_id,
                alias_ref,
                plan.canonical_id,
                plan.rows.get(table, []),
            )
            moved[table] = _rowcount(status)
        if canonical_ref is not None:
            status = await conn.execute(
                "UPDATE applications SET customer_id_id = $1, "
                "identity_origin_customer_id = NULL "
                "WHERE customer_id_id = $2 "
                "AND (identity_origin_customer_id = $3 "
                "OR application_number = ANY($4::text[]))",
                alias_ref,
                canonical_ref,
                plan.alias_id,
                plan.rows.get("applications", []),
            )
            moved["applications"] = _rowcount(status)
        else:
            moved["applications"] = 0
        status = await conn.execute(
            "UPDATE customers SET merged_into = NULL, merged_link_id = NULL, "
            "merged_reason = NULL, updated_at = NOW() "
            "WHERE customer_id = $1 AND merged_into = $2",
            plan.alias_id,
            plan.canonical_id,
        )
        tombstone_cleared = _rowcount(status) == 1
    return UnlinkResult(moved=moved, tombstone_cleared=tombstone_cleared)


def _rowcount(status: Any) -> int:
    """asyncpg returns e.g. ``'UPDATE 3'``."""
    try:
        return int(str(status).rsplit(" ", 1)[-1])
    except (TypeError, ValueError):
        return 0


async def run(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--alias", required=True, help="the cut alias customer id")
    parser.add_argument(
        "--canonical", required=True, help="the old canonical it was linked to"
    )
    parser.add_argument(
        "--rows", help="CSV of table,key_column,key_value for rows without an origin id"
    )
    parser.add_argument("--apply", action="store_true", help="write (default: dry run)")
    args = parser.parse_args(argv)

    if args.alias == args.canonical:
        parser.error("--alias and --canonical must differ")

    database_uri = os.environ.get("DATABASE_URI")
    if not database_uri:
        parser.error("DATABASE_URI is not set")

    import asyncpg

    plan = UnlinkPlan(
        alias_id=args.alias,
        canonical_id=args.canonical,
        rows=read_rows_csv(args.rows) if args.rows else {},
    )
    conn = await asyncpg.connect(database_uri)
    try:
        merged_into = await conn.fetchval(
            "SELECT merged_into FROM customers WHERE customer_id = $1", plan.alias_id
        )
        print(f"alias {plan.alias_id}: merged_into={merged_into!r} (expected {plan.canonical_id})")
        counts = await count_candidates(conn, plan)
        for table, n in counts.items():
            print(f"  {table}: {n} row(s) would move back to {plan.alias_id}")
        if not args.apply:
            print("dry run — nothing changed (pass --apply to write)")
            return 0
        result = await apply_unlink(conn, plan)
        for table, n in result.moved.items():
            print(f"  {table}: moved {n}")
        print(
            "  customers: tombstone cleared"
            if result.tombstone_cleared
            else f"  customers: no tombstone pointing at {plan.canonical_id} (nothing cleared)"
        )
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
