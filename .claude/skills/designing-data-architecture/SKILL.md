---
name: designing-data-architecture
description: Use when designing, changing or reviewing how data is stored, shaped, owned or moved between systems - a new schema or table, a read model or projection, a reporting or warehouse layer, choosing between normalised, dimensional (star schema), event-sourced or snapshot models, deciding where data should live and who writes it, or when a request mentions grain, keys, history, as-of, SCD, data vault, medallion/bronze-silver-gold, lakehouse, or a data ADR.
---

# Designing Data Architecture

## Overview

Design from the questions and the write path, not from the entities. Every object gets a
one-sentence grain and a key that enforces it. History is append-only. Decisions are written down
with their reasons. The shape of the design is fixed (below) so nothing gets skipped.

Related skills: building-data-pipelines (how the data gets there), building-reports (how it is read).

## The deliverable

A data design has these sections, in this order. A section that does not apply says so in one line.

1. **Questions and workloads.** The reads it must answer, the writes it must absorb, expected
   volumes (rows/day, rows total), and acceptable staleness for each.
2. **Sources and ownership.** For each entity: the system of record, the figure-of-record source
   for money, and exactly one writer per target table. Name the writer.
3. **Objects.** One table, no prose:

   | object | kind | one row per | key (enforced how) | history | written by |
   |---|---|---|---|---|---|

   `kind` is table / view / materialized view / partitioned table. `history` is one of:
   current-only, append-only event log, periodic snapshot, SCD2 on named columns.
4. **Types and conventions.** State them even when they match the defaults below.
5. **Privacy and sensitivity.** Which columns are personal or sensitive, which are excluded or
   minimised (age band not date of birth, postcode not street), and who may read the schema.
6. **Integrity and tests.** The unique constraint on each grain, referential rules, the
   reconciliation that proves the design matches its source, and the test that proves no personal
   data leaks where it should not.
7. **Access paths.** Each index or partition key named against the query in section 1 it serves.
8. **Decisions.** Decide-now versus leave-until-later, and a decision record for anything a
   future reader would ask "why?" about. Template: `references/data-adr-template.md`.

## Defaults

Use these unless the repo already has a convention. Say which you used.

| Concern | Default |
|---|---|
| Money | Integer minor units (`amount_cents bigint`) or `numeric(19,4)`. Never float. Add `currency` if more than one is possible. |
| Instants | `timestamptz`, stored UTC, column suffix `_at`. |
| Business dates | `date` in the business timezone, suffix `_on`, computed once in one function, never ad hoc. |
| Keys | The owning system's stable id as primary key where it exists; otherwise uuid. Keep source ids as columns. Never reuse or re-mint keys. |
| Grain | Declared in one sentence and enforced by a unique constraint or primary key. |
| History | Append-only event log plus a periodic snapshot before any SCD2. SCD2 only on the specific columns that need it. |
| Null | Means unknown. "Not applicable" and "not yet" are statuses, not nulls. |
| Status | An enumerated column with a documented state machine and a `*_at` for each transition that matters. |
| Naming | `snake_case`; booleans `is_` / `has_`; no abbreviations; follow the repo's singular/plural rule. |
| Reporting | A separate schema or layer that holds no free text and no direct identifiers, read by a role that can see only it. |

## Choosing a shape

| Workload | Shape |
|---|---|
| Transactional app writes | Normalised (3NF); one aggregate per transaction boundary |
| App read model fed by events | One projection per screen or aggregate; single writer; version-gated upserts |
| Analytics over one database | Views or a reporting schema over operational tables, then materialized views, then marts |
| Analytics across many sources | Star schema (facts at a declared grain, conformed dimensions); layer raw -> cleaned -> marts |
| As-of and trend questions | Daily snapshot fact (one row per entity per day) and/or an append-only event log |
| Audit and replay | Append-only event log with event id, occurred_at, received_at, payload |

Detail on each, including SCD types, snapshot versus event-log trade-offs, Data Vault and layering:
`references/modelling-patterns.md`.

## Review checklist

Before calling a design done, run `references/review-checklist.md` against it.

## Common mistakes

- Float or `real` for money; mixing dollars and cents in one column family.
- Querying a JSON column by key when the key is a real attribute. Promote it to a column.
- Entity-attribute-value tables for things with a known shape.
- A `status` column with no state machine and no transition timestamps.
- Mutating fact rows. Reversals are new rows.
- Two processes writing the same table.
- "We will add history later." A day not snapshotted cannot be reconstructed.
- Reporting straight off operational tables that carry names, addresses and free text.
- A grain stated in prose but not enforced by a constraint.
