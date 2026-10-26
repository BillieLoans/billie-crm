# Pipeline review checklist

Answer each with evidence from the code or design.

## Contract
- [ ] Source key, ordering or version field, and delivery guarantee are stated.
- [ ] Target grain and key are stated and enforced by a constraint.
- [ ] This pipeline is the only writer of the target. Readers have no write grant.
- [ ] Freshness target is a number, and a reader can observe freshness.

## Write rule
- [ ] Idempotency predicate is visible in the code (version gate, event-id dedupe, or watermark).
- [ ] Writes are full-row.
- [ ] Deletes or tombstones are handled.
- [ ] Nothing gates on a wall-clock timestamp.

## Failure handling
- [ ] Transient versus poison errors are classified.
- [ ] Ack or offset commit happens after the database commit.
- [ ] Dead-letter path stores raw payload and error, and alerts.
- [ ] A crash mid-batch is tested.

## Backfill and replay
- [ ] Backfill uses the live write function.
- [ ] Resumable via a progress record.
- [ ] Safe to run alongside live, or the design says when live is paused.
- [ ] Replay-one-entity command exists.

## Observability
- [ ] Lag, freshness, dead-letter depth, dropped-stale count are emitted.
- [ ] Alert thresholds are numbers.
- [ ] Per-run row counts are logged.

## Data quality
- [ ] Unique-on-grain, not-null, accepted-values, freshness, volume tests exist.
- [ ] Each test has a stated failure policy.

## Reconciliation
- [ ] A scheduled comparison to the source of record exists, with tolerance and owner.

## Schema evolution
- [ ] Unknown fields are logged, not dropped or fatal.
- [ ] A new event version has a stated path.

## Tests
- [ ] Duplicate, out-of-order, concurrent same-key, poison, crash-mid-batch.
- [ ] Integration test with the real database engine.
