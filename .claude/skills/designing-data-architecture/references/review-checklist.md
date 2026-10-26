# Data design review checklist

Answer each with evidence from the design, not from intent.

## Grain and keys
- [ ] Every object states "one row per ..." in one sentence.
- [ ] That grain is enforced by a primary key or unique constraint, named in the design.
- [ ] Keys come from the owning system or are uuids; nothing re-mints keys on reload.
- [ ] Source ids are kept as columns on derived objects.

## Ownership
- [ ] Exactly one writer per table, named.
- [ ] The figure-of-record source for every money column is named.
- [ ] Nothing that reads a projection can write it.

## History
- [ ] Each object says current-only / event log / snapshot / SCD2-on-columns.
- [ ] Every as-of or trend question in section 1 is answered by a named object.
- [ ] Snapshot and event log start dates are known; backfill plan exists for dates before.
- [ ] Facts are append-only; reversals are rows.

## Types and time
- [ ] Money is integer minor units or numeric; currency is explicit if needed.
- [ ] Instants are `timestamptz` (`_at`); business dates are `date` (`_on`) via one shared function.
- [ ] Both occurred and received timestamps exist where lateness matters.
- [ ] Nulls mean unknown only.

## Privacy
- [ ] Personal and sensitive columns are listed.
- [ ] Reporting or analytics objects exclude direct identifiers and free text, or the design says why not.
- [ ] A test asserts the exclusion.
- [ ] Read access is by a role scoped to the layer.

## Integrity and tests
- [ ] Uniqueness-on-grain test.
- [ ] Reconciliation against the source of record (what, how often, tolerance).
- [ ] Referential rules stated (enforced FK, or soft reference with a check).

## Access paths
- [ ] Each index or partition key is tied to a named query.
- [ ] Row estimates exist for the largest tables.

## Decisions
- [ ] Decide-now versus later list.
- [ ] A decision record for each non-default choice.
