#!/usr/bin/env python3
"""Replay dead-lettered events back into the Billie Servicing inbox stream.

When the processor exhausts ``max_retries`` on a message it copies it to the DLQ
stream (``dlq:billie-servicing``) and ACKs the original. Those events are then
never reprocessed. After fixing the bug that caused them to fail and redeploying
the processor, use this script to push the dead-lettered events back onto the
inbox so the (now-fixed) consumer projects them.

Safe by default: runs in --dry-run mode (prints a summary, changes nothing).
Pass --execute to actually re-publish. Each replayed event is re-added to the
inbox with a fresh stream id (so processor dedup does not suppress it) and, on
success, removed from the DLQ. Handlers are idempotent (ON CONFLICT upserts),
so re-running is safe.

Examples:
    # See what's in the DLQ, grouped by event type (no changes):
    REDIS_URL=rediss://... python replay_dlq.py

    # Replay only the one-shot events that don't self-heal:
    REDIS_URL=rediss://... python replay_dlq.py --execute \
        --type customer.identity.linked.v1 --type applicationDetail_changed

    # Replay everything:
    REDIS_URL=rediss://... python replay_dlq.py --execute

Notes:
  * `loan.aging.updated.v1` self-heals — the nightly scheduler re-emits aging for
    every account — so you usually do NOT need to replay it. Replaying is still
    safe (idempotent) if you want the columns fixed immediately.
  * `customer.contact.verified.v1` has no handler; replayed copies are simply
    ACK-skipped by the fixed processor (harmless, but pointless).
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter

import redis

# Defaults mirror billie_servicing/config.py. Override via flags or env if needed.
DEFAULT_DLQ_STREAM = "dlq:billie-servicing"
DEFAULT_INBOX_STREAM = "inbox:billie-servicing"

# Fields the processor's _move_to_dlq() adds — stripped before replay so the
# re-published event matches the original envelope.
_DLQ_META_FIELDS = ("original_message_id", "error", "moved_at")


def _event_type(fields: dict[str, str]) -> str:
    """Resolve the event type the same way the processor does."""
    return (
        fields.get("msg_type")
        or fields.get("typ")
        or fields.get("event_type")
        or "<unknown>"
    )


def _iter_dlq(client: redis.Redis, stream: str, batch: int = 200):
    """Yield (message_id, fields) for every entry in the DLQ, oldest first."""
    cursor = "-"
    while True:
        entries = client.xrange(stream, min=cursor, max="+", count=batch)
        if not entries:
            return
        for message_id, fields in entries:
            yield message_id, fields
        # Advance past the last id we saw (exclusive range via "(" prefix).
        cursor = "(" + entries[-1][0]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--redis-url", default=os.environ.get("REDIS_URL"),
                        help="Redis URL (defaults to $REDIS_URL).")
    parser.add_argument("--dlq-stream", default=DEFAULT_DLQ_STREAM)
    parser.add_argument("--inbox-stream", default=DEFAULT_INBOX_STREAM)
    parser.add_argument("--type", dest="types", action="append", default=[],
                        help="Only replay this event type (repeatable). Default: all.")
    parser.add_argument("--limit", type=int, default=0,
                        help="Stop after replaying this many events (0 = no limit).")
    parser.add_argument("--execute", action="store_true",
                        help="Actually replay. Without this, runs a dry-run.")
    parser.add_argument("--keep", action="store_true",
                        help="Do NOT remove replayed entries from the DLQ (default removes them).")
    args = parser.parse_args()

    if not args.redis_url:
        parser.error("no Redis URL — pass --redis-url or set $REDIS_URL")

    type_filter = set(args.types)
    client = redis.from_url(args.redis_url, decode_responses=True)

    total = client.xlen(args.dlq_stream)
    print(f"DLQ {args.dlq_stream}: {total} entries")
    if type_filter:
        print(f"Filter: {', '.join(sorted(type_filter))}")
    print(f"Mode:   {'EXECUTE' if args.execute else 'dry-run (no changes)'}"
          + ("  [keeping DLQ entries]" if args.keep and args.execute else ""))
    print("-" * 60)

    matched = Counter()
    replayed = Counter()
    for message_id, fields in _iter_dlq(client, args.dlq_stream):
        etype = _event_type(fields)
        if type_filter and etype not in type_filter:
            continue
        matched[etype] += 1

        if not args.execute:
            continue

        payload = {k: v for k, v in fields.items() if k not in _DLQ_META_FIELDS}
        # Re-publish with a fresh id, then drop the DLQ copy on success.
        client.xadd(args.inbox_stream, payload)
        if not args.keep:
            client.xdel(args.dlq_stream, message_id)
        replayed[etype] += 1

        if args.limit and sum(replayed.values()) >= args.limit:
            print(f"(reached --limit {args.limit})")
            break

    print("Matched by type:")
    for etype, n in matched.most_common():
        print(f"  {n:5d}  {etype}")
    if not matched:
        print("  (none)")

    if args.execute:
        done = sum(replayed.values())
        print("-" * 60)
        print(f"Replayed {done} event(s) -> {args.inbox_stream}"
              + ("" if args.keep else f"; removed {done} from {args.dlq_stream}"))
    else:
        print("-" * 60)
        print(f"Dry run — {sum(matched.values())} event(s) would be replayed. "
              f"Re-run with --execute to apply.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
