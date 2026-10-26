# Backfill and replay playbook

## Contents
- Before you start
- Running it
- Alongside live
- Cutover orders
- After
- Replaying one thing

## Before you start

- Sample the archive: does the payload shape match the current parser for the oldest and newest
  files? Write a shim per shape change, keyed by event version or date range.
- Verify the archive is complete: one file per expected unit (day, hour, partition), none empty,
  sequence numbers or counts continuous. List the gaps before writing a row.
- Confirm the ordering field (version, sequence) is monotonic in the archive by scanning a sample
  of entities end to end.
- Record the target's current state: row count, max version per entity for a sample, checksum of
  a known subset. You will diff against this.
- Decide throughput: batch size, concurrency, statement timeout, and the time of day. The target
  is in use; the backfill must not starve its readers or lock-contend with the live writer.

## Running it

- Same write function as live. If the live path is a function `apply(event)`, the backfill is
  `for event in archive: apply(event)`.
- Progress table keyed by the source unit (file key, partition, date), with status and row
  counts. Restart skips completed units.
- Order the source ascending by time; it is not required for correctness under a version gate
  but it minimises wasted writes and makes progress legible.
- Optional pre-reduction: within one unit, keep only the highest version per entity before
  writing.
- Log per unit: rows read, written, no-op, dropped-stale, errors.

## Alongside live

With a version gate, live and backfill can run at the same time with no coordination: the higher
version wins regardless of which process writes it. The backfill process must not join the live
consumer group. If there is no version field, pause live consumption for the backfill window or
backfill only up to a watermark and let live cover the rest.

## Cutover orders

| Situation | Order |
|---|---|
| New projection, empty table | Start live consumer first (so nothing is missed), then backfill the past. |
| Rebuilding an existing projection | Build into a new table, backfill, run live into both, reconcile, swap names in one transaction. |
| Schema change on an existing projection | Add columns nullable, deploy writer that fills them, backfill, then add constraints. |

## After

- Diff against the pre-backfill record and the source of record: counts per period, sums of
  money columns, max version per entity for the sample.
- Run the full data quality suite.
- Vacuum or analyze the target if the backfill produced many no-op updates.
- Keep the progress table; it is the audit trail.

## Replaying one thing

Write these as runnable commands in the runbook, not prose:

- One entity: fetch its events from the archive or stream by id, apply in order.
- One day: re-run the unit for that date; the gate makes it safe.
- Everything: the rebuild order above.
