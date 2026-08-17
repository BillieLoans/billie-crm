"""
Aging event handlers (aging-v1.1.0+).

Projects loan.aging.updated.v1 events onto the ``loan_accounts`` table so the
CRM can filter and sort accounts by arrears state without round-tripping to
the gRPC ledger on every page render.

The handler is idempotent: replaying the same event produces no state change.
Missing fields (older SDK versions) fall through gracefully.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import asyncpg
import structlog

from ..db import update_by_key

logger = structlog.get_logger(__name__)

# The Payload `aging.bucket` field is a closed enum (5 values). Any value
# outside the set would fail the enum constraint on insert, so we coerce
# anything unrecognised to None and log a warning. This matches the original
# Mongo behaviour for unknown buckets except that Mongo silently accepted them.
_VALID_BUCKETS = frozenset({"current", "early_arrears", "late_arrears", "default", "closed"})


async def handle_loan_aging_updated(pool: asyncpg.Pool, parsed_event: Any) -> None:
    """Handle loan.aging.updated.v1 event.

    Sets the ``aging_*`` columns on the loan_accounts row keyed by
    ``loan_account_id``. No-op (with debug log) if the loan account hasn't
    been projected yet — the row will be created by a later
    ``account.created.v1`` and the aging stays at its default zero state
    until the next aging event arrives.
    """
    payload = parsed_event.payload
    account_id = payload.account_id

    log = logger.bind(account_id=account_id)
    log.info("Processing loan.aging.updated.v1")

    raw_bucket = str(getattr(payload, "bucket", "current") or "current")

    # Terminal-closure guard (prod incident 2026-08-17, WTVFB9Q1CK0N /
    # 1CPTX2ZA67SC): the agingMonitor daily scheduler can emit a
    # closed → current "downgrade" for an already-closed account. While the
    # projection shows a terminal status, any bucket other than `closed` is
    # spurious — drop the whole event. `closed` still applies (closure +
    # replay), and a genuine reopen changes account_status via
    # account.status_changed.v1 before aging would legitimately differ.
    if raw_bucket != "closed":
        row = await pool.fetchrow(
            "SELECT account_status FROM loan_accounts WHERE loan_account_id = $1",
            account_id,
        )
        if row is not None and row["account_status"] in ("paid_off", "written_off"):
            log.warning(
                "Ignoring aging update for terminally closed account — "
                "bucket may not leave 'closed' while the account is "
                "paid_off/written_off",
                account_status=row["account_status"],
                incoming_bucket=raw_bucket,
            )
            return

    bucket: str | None = raw_bucket if raw_bucket in _VALID_BUCKETS else None
    if bucket is None:
        log.warning(
            "Unknown aging bucket; storing NULL for aging_bucket",
            raw_bucket=raw_bucket,
        )

    is_in_arrears = getattr(payload, "is_in_arrears", None)
    if is_in_arrears is None:
        # Derive defensively when older publishers omit the field.
        is_in_arrears = raw_bucket not in {"current", "closed"}

    now = datetime.now(timezone.utc)
    event_last_updated = getattr(payload, "last_updated", None)
    last_updated_value = event_last_updated if event_last_updated else now

    values: dict[str, Any] = {
        "aging_is_in_arrears": bool(is_in_arrears),
        "aging_bucket": bucket,
        "aging_last_updated": last_updated_value,
        "updated_at": now,
    }

    dpd = getattr(payload, "dpd", None)
    if dpd is not None:
        values["aging_current_d_p_d"] = int(dpd)

    status = await update_by_key(
        pool,
        "loan_accounts",
        key_column="loan_account_id",
        key_value=account_id,
        values=values,
    )

    log.info(
        "Loan account aging updated",
        bucket=raw_bucket,
        is_in_arrears=is_in_arrears,
        dpd=dpd,
        asyncpg_status=status,
    )
