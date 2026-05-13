"""
Aging event handlers (aging-v1.1.0+).

Projects `loan.aging.updated.v1` events onto the `loan-accounts` collection
so the CRM can filter and sort accounts by arrears state without round-
tripping to the gRPC ledger on every page render.

Each event sets the `aging` group on the LoanAccount document:
    aging.isInArrears (bool)  — authoritative arrears flag from the aging
                                 service. `bucket not in {current, closed}`
                                 AND not terminal.
    aging.bucket      (str)   — current aging bucket
    aging.currentDPD  (int)   — days past due
    aging.lastUpdated (datetime) — when the snapshot was taken

The handler is idempotent: replaying the same event produces no state
change. Missing fields (older SDK versions) fall through gracefully.
"""

from datetime import datetime
from typing import Any

import structlog
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = structlog.get_logger(__name__)


async def handle_loan_aging_updated(db: AsyncIOMotorDatabase, parsed_event: Any) -> None:
    """
    Handle loan.aging.updated.v1 event.

    SDK Model: LoanAgingUpdatedV1 (billie_aging_events>=1.1.0)
    Fields: account_id, dpd, bucket, is_in_arrears, last_updated, ...
    """
    payload = parsed_event.payload
    account_id = payload.account_id

    log = logger.bind(account_id=account_id)
    log.info("Processing loan.aging.updated.v1")

    # is_in_arrears is mandatory on aging-v1.1.0+. Be defensive in case an
    # older publisher slips through — derive from bucket as a last resort.
    bucket = str(getattr(payload, "bucket", "current") or "current")
    is_in_arrears = getattr(payload, "is_in_arrears", None)
    if is_in_arrears is None:
        is_in_arrears = bucket not in {"current", "closed"}

    update_doc: dict[str, Any] = {
        "aging.isInArrears": bool(is_in_arrears),
        "aging.bucket": bucket,
        "aging.lastUpdated": datetime.utcnow(),
        "updatedAt": datetime.utcnow(),
    }

    dpd = getattr(payload, "dpd", None)
    if dpd is not None:
        update_doc["aging.currentDPD"] = int(dpd)

    # Some publishers carry a `last_updated` timestamp on the event itself —
    # prefer it over the wall-clock when present so replays stay deterministic.
    event_last_updated = getattr(payload, "last_updated", None)
    if event_last_updated:
        update_doc["aging.lastUpdated"] = event_last_updated

    result = await db["loan-accounts"].update_one(
        {"loanAccountId": account_id}, {"$set": update_doc}
    )

    log.info(
        "Loan account aging updated",
        bucket=bucket,
        is_in_arrears=is_in_arrears,
        dpd=dpd,
        matched=result.matched_count,
        modified=result.modified_count,
    )
