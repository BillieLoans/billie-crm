"""Replay retained cancellation events into the CRM inbox.

The cancellation events between 2026-06-28 and 2026-09-01 (11 found on 28 Aug,
12 by 1 Sep) were written to chatLedger but never routed to
inbox:billie-servicing (see
docs/superpowers/specs/2026-08-28-cancellation-projection-design.md).
The events are still in the ledger, so the repair is a replay.

Replayed entries get fresh stream IDs, so the processor's dedup key does not
suppress them; idempotency comes from the terminal-state ladder, which also
makes this script safe to run more than once.

Run AFTER the CRM handlers are deployed, or the processor will ACK and discard.
Lives inside billie_servicing because the runtime image ships only
event-processor/src (Dockerfile.demo:138) — /app/scripts does not exist there.

  # inside the Fly container (PYTHONPATH already includes event-processor/src):
  python3 -m billie_servicing.scripts.backfill_cancellations            # dry run
  python3 -m billie_servicing.scripts.backfill_cancellations --apply    # write
"""

from __future__ import annotations

import argparse
import asyncio
import os

import redis.asyncio as aioredis

LEDGER = "chatLedger"
INBOX = "inbox:billie-servicing"
TARGET_TYPES = {"customer_cancelled", "offer_cancelled"}


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="actually write to the inbox")
    args = parser.parse_args()

    r = aioredis.from_url(os.environ["REDIS_URL"], decode_responses=True)

    entries = await r.xrange(LEDGER, "-", "+")
    hits = [(sid, f) for sid, f in entries if f.get("typ") in TARGET_TYPES]

    print(f"{len(hits)} cancellation events found in {LEDGER}")
    for sid, fields in hits:
        print(
            f"  {sid}  {fields.get('typ'):<19} conv={fields.get('conv', '')[:8]} "
            f"payload={fields.get('payload', '')[:110]}"
        )
        if args.apply:
            await r.xadd(INBOX, fields)

    print("replayed" if args.apply else "dry run — nothing written; pass --apply")
    await r.aclose()


if __name__ == "__main__":
    asyncio.run(main())
