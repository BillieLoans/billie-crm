---
name: building-data-pipelines
description: Use when building, changing or reviewing anything that moves or transforms data - event consumers that maintain projections or read models, ETL/ELT jobs, syncs between systems, scheduled snapshots, backfills and replays, change data capture, dbt-style transformation models, or a one-off data migration; also when data is stale, duplicated, missing, out of order, or has drifted from its source.
---

# Building Data Pipelines

## Overview

Delivery is at-least-once, so every write is idempotent and version-gated. Backfill runs through
the same write path as live. A pipeline is not finished until it can prove, on a schedule, that the
target matches the source. The design has a fixed shape (below) so the parts people skip get written.

Related skills: designing-data-architecture (the target's grain and keys), analysing-data (when
the output looks wrong).

## The deliverable

A pipeline design, PR description, or review covers these in order. A section that does not apply
says so in one line.

1. **Contract.** Source: shape, key, ordering or version field, delivery guarantees, how deletes
   arrive. Target: grain, key, the single writer (this pipeline), and who reads it. Freshness
   target in minutes, and how a reader can see freshness (`projected_at` or equivalent).
2. **Write rule.** The exact idempotency predicate, as code or SQL: version gate, event-id dedupe,
   or watermark with overlap. Full-row writes, not partial. How tombstones are applied.
3. **Failure handling.** Which errors retry (transient) and which go to a dead-letter queue
   (poison). Commit-then-ack ordering. What a crash mid-batch does. What blocks and what skips.
4. **Backfill and replay.** Same code path, different source. Resumable (progress keyed by
   source unit), throttled, safe to run alongside live. Cutover order. How to replay one entity,
   one day, or everything. Playbook: `references/backfill-playbook.md`.
5. **Observability.** Lag, freshness, throughput, dead-letter depth, stale-dropped count, rows
   written per run, and the alert thresholds for each.
6. **Data quality tests.** Which of `references/data-quality-tests.md` run, where, and what
   happens when one fails (block, alert, or quarantine).
7. **Reconciliation.** How the target is compared to the source of record, how often, the
   tolerance, and who is paged on divergence. This catches what the write rule cannot: events
   never emitted, routing drops, mapping changes.
8. **Schema evolution.** What happens on a new field, a removed field, a renamed enum value, and
   a new event version. Unknown fields are logged, never silently dropped or fatal.

## Defaults

| Concern | Default |
|---|---|
| Idempotency | `INSERT ... ON CONFLICT (key) DO UPDATE SET ... WHERE target.version < EXCLUDED.version`. Same version is a no-op; older is dropped and counted. |
| No version field | Dedupe table keyed by event id (with a retention window), or a content hash. Never a timestamp gate. |
| Incremental loads | Watermark on `updated_at` with an overlap window for late data; upsert makes the overlap harmless. |
| Transactions | One transaction per event, or per batch with all-or-nothing and re-delivery of the whole batch. |
| Ack | Only after commit. A crash between the two is a redelivery the write rule absorbs. |
| Dead letters | Bounded retries, then store the raw payload plus error, ack, alert. Never block the stream on one event. |
| Deletes | Tombstone event sets `deleted_at`; hard delete only if the design says so. |
| Freshness | Every target row carries `projected_at` (or the table carries a last-event watermark); readers can show "as at". |
| Backfill | Separate process, not in the live consumer group, reading source in order, batching writes, progress table keyed by file or partition. |
| Logging | Per batch: source ids range, rows read, written, no-op, dropped-stale, dead-lettered. |

## Common mistakes

- Gating on `emitted_at` or `updated_at` instead of a version. Clocks skew; versions do not.
- Acking before the commit.
- Partial-column updates that leave a row as a blend of two versions.
- A backfill script with its own write logic.
- Dropping unparseable events silently, or crashing the whole consumer on one.
- No handling for deletes, so removed entities live forever in the projection.
- No freshness column, so "is this stale?" cannot be answered without logs.
- A migration of data with no before/after row counts and no reconciliation.
- Assuming the source is monotonic without sampling it.
- Treating a one-off backfill as done without checking day-file continuity (missing or empty days).

## Review checklist

Before shipping, run `references/review-checklist.md`.
