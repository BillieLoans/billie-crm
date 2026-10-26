# Modelling patterns

## Contents
- Layering (raw, cleaned, marts)
- Dimensional modelling (facts, dimensions, grain)
- Slowly changing dimensions
- Snapshots versus event logs for history
- Projections (read models) from events
- Data Vault, briefly
- Time and calendars
- Sizing and partitioning

## Layering

Three layers, whatever the tooling calls them (bronze/silver/gold, raw/staging/marts, L1/L2/L3):

| Layer | One row per | Rules |
|---|---|---|
| Raw | Source record or event, as received | Append-only. Never edited. Keep `received_at`, source id, payload. This is the replay source. |
| Cleaned | Source entity, typed and deduplicated | Types fixed, keys enforced, business dates computed, personal data minimised. One writer: the pipeline from raw. |
| Marts | A business question's grain | Facts and dimensions, or wide denormalised views. Only layer reports read. |

A small system can skip raw-as-table if the event stream is durable and replayable, and skip
marts if views over cleaned tables are fast enough. Do not skip cleaned.

## Dimensional modelling

**Fact table**: one row per event or measurement at a declared grain. Columns are foreign keys to
dimensions plus numeric measures. Three kinds:

| Kind | One row per | Example |
|---|---|---|
| Transaction | Thing that happened | A ledger transaction, a payment attempt |
| Periodic snapshot | Entity per period | Account per day: balance, days past due |
| Accumulating snapshot | Process instance, updated as it moves | An application: submitted_at, decided_at, funded_at |

Transaction facts are append-only. Accumulating snapshots are the one fact type that is updated in
place, which is why they need a version or `updated_at`.

**Dimension table**: one row per thing you group or filter by (customer, product, date, purpose).
Conformed dimensions are shared across facts so that "product" means the same thing everywhere.

**Grain first.** Decide the grain, then the measures, then the dimensions. Additive measures
(amounts, counts) sum across any dimension. Semi-additive (balances) sum across entities but not
across time. Non-additive (rates, ratios) must be recomputed from their parts, never averaged.

**Freeze at the fact.** Attributes that must not drift (purpose at origination, state at
origination) are copied onto the fact or onto a dimension row versioned at that time.

**Bridge tables** handle many-to-many (an account with two borrowers) with an allocation weight
so sums still work.

## Slowly changing dimensions

| Type | Behaviour | Use when |
|---|---|---|
| SCD1 | Overwrite | History of the attribute does not matter |
| SCD2 | New row per change with `valid_from`, `valid_to`, `is_current` | Facts must join to the attribute as it was at the time |
| SCD3 | Previous value in a second column | Only the last change matters |

SCD2 on a whole dimension is expensive to maintain and easy to get wrong (gaps, overlaps,
late-arriving changes). Default to SCD1 plus a periodic snapshot of the whole entity, and add a
narrow `entity_attribute_history (entity_id, attribute, value, valid_from, valid_to)` for the
specific attributes that need as-of joins. Enforce no overlap with an exclusion constraint on
`(entity_id, attribute, daterange(valid_from, valid_to))`.

## Snapshots versus event logs

| Question | Snapshot (entity per day) | Event log |
|---|---|---|
| State on a given date | Direct lookup | Replay to that date |
| Trend over time | Direct group-by | Replay per period |
| Why did it change | Diff two days | Direct: the events |
| Storage | Entities x days | Events |
| Backfill | Needs a source that can answer as-of | Needs the events to have been kept |

Keep both when you can: the event log is truth, the snapshot is the index into it. Start the
snapshot on day one; it cannot be reconstructed for days before it ran unless the source can
answer as-of questions.

## Projections from events

A projection is a table maintained from a stream for one consumer's reads.

- One writer. The app that reads it has no write access.
- Full-state writes: the event carries the whole entity, and the upsert writes every column, so a
  row is never a blend of two versions.
- Version-gated: `ON CONFLICT (id) DO UPDATE ... WHERE target.version < EXCLUDED.version`.
- Carry `source_version`, `source_event_id`, `projected_at` columns for debugging and freshness.
- Deletes arrive as tombstone events; decide whether the projection soft-deletes or removes.
- A projection can be dropped and rebuilt from the stream. If it cannot, it is not a projection.

## Data Vault, briefly

Hubs (business keys), links (relationships), satellites (attributes over time). It isolates source
changes well and audits perfectly, at the cost of many joins and a mandatory mart layer on top.
Worth it with many volatile sources and strict audit; not worth it for one or two sources.

## Time and calendars

- Store instants as `timestamptz` in UTC. Store business dates as `date` after converting in the
  business timezone, via one shared function, so every `*_on` column agrees.
- A `dim_date` (or calendar table) with week start, month start, financial year, business-day and
  holiday flags stops every report redefining "week".
- Record both `occurred_at` (when it happened) and `received_at` (when you learned of it). Late
  data is the difference between them.
- Bitemporal (valid time plus transaction time) only when you must answer "what did we believe on
  date X about date Y". It is rare and expensive; say explicitly if it is in scope.

## Sizing and partitioning

Estimate rows for each table: entities x periods for snapshots, events/day x retention for logs.
Partition by time when a table will exceed tens of millions of rows or when old partitions will be
dropped. Partition key must appear in most queries' predicates. Index foreign keys used in joins
and the columns in the WHERE clauses of the named queries; do not index speculatively.
