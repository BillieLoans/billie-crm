# Data decision record

One file per decision. Keep each under a page. File it where the repo keeps ADRs; if it has none,
`docs/decisions/YYYY-MM-DD-<slug>.md`.

```markdown
# <Decision in one line, e.g. "Daily snapshot, not SCD2, for account history">

Date: YYYY-MM-DD
Status: proposed | accepted | superseded by <link>

## Context
What question or workload forced this. Volumes, latency, and constraints that mattered.

## Decision
What was chosen. Name the objects, keys, grain and writer affected.

## Alternatives considered
- <Option>: why not (one line each)

## Consequences
What becomes easy, what becomes hard, what must be built or run because of this
(a backfill, a nightly job, a reconciliation), and what would make us revisit it.
```

Decisions worth a record: grain and key of any fact table; history strategy; which system is the
figure of record for money; where personal data may and may not go; a partition or retention
policy; choosing a projection over a direct read; any deviation from the skill's defaults.
