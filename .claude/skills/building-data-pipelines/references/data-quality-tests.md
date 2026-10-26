# Data quality tests

## Contents
- Test catalogue
- Where each runs
- SQL for each
- Failure policy

## Test catalogue

| Test | Asserts | Default severity |
|---|---|---|
| Unique on grain | No duplicate rows for the declared grain | Block |
| Not null | Key and required columns are populated | Block |
| Accepted values | Enum columns contain only known values | Alert (new value may be upstream change) |
| Referential | Every FK resolves (or is a known orphan class) | Alert |
| Freshness | Max source timestamp or `projected_at` within SLA | Alert, page if 2x SLA |
| Volume | Rows per period within a band of recent history | Alert |
| Continuity | No missing periods (days, files, sequence numbers) | Alert |
| Range | Amounts, dates, percentages within sane bounds | Alert |
| Version monotonic | No row received a lower version than it holds | Alert (indicates upstream bug) |
| Reconciliation | Counts and sums match the source of record within tolerance | Page |
| Privacy | No personal columns present in a layer that forbids them | Block |

## Where each runs

- **In the write path** (block): unique on grain, not null, privacy. These are constraints or
  pre-insert checks.
- **After each run** (alert): accepted values, referential, volume, range, continuity.
- **On a schedule** (alert or page): freshness, reconciliation, version monotonic.

## SQL for each

Duplicates on grain:
```sql
SELECT key_a, key_b, count(*) FROM t GROUP BY 1, 2 HAVING count(*) > 1 LIMIT 20;
```

Null rate per column (run once for a profile, keep for required columns):
```sql
SELECT count(*) AS n,
       count(*) - count(col_1) AS col_1_nulls,
       count(*) - count(col_2) AS col_2_nulls
FROM t;
```

Accepted values (returns unexpected ones):
```sql
SELECT status, count(*) FROM t
WHERE status NOT IN ('open', 'closed', 'written_off')
GROUP BY 1;
```

Orphans:
```sql
SELECT count(*) FROM child c LEFT JOIN parent p ON p.id = c.parent_id WHERE p.id IS NULL;
```

Freshness:
```sql
SELECT now() - max(projected_at) AS age FROM t;
```

Volume band (today versus trailing 28-day median):
```sql
WITH daily AS (
  SELECT date_trunc('day', created_at) AS d, count(*) AS n
  FROM t WHERE created_at >= now() - interval '29 days' GROUP BY 1
)
SELECT (SELECT n FROM daily WHERE d = date_trunc('day', now() - interval '1 day')) AS yesterday,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY n) AS median_28d
FROM daily WHERE d < date_trunc('day', now() - interval '1 day');
```

Continuity (missing days):
```sql
SELECT d::date FROM generate_series(:from::date, :to::date, interval '1 day') d
LEFT JOIN (SELECT DISTINCT business_date FROM t) x ON x.business_date = d
WHERE x.business_date IS NULL;
```

Reconciliation (target versus source, per key, with tolerance):
```sql
SELECT s.id, s.balance AS source, t.balance AS target
FROM source_snapshot s
FULL OUTER JOIN target t ON t.id = s.id
WHERE s.id IS NULL OR t.id IS NULL OR abs(s.balance - t.balance) > :tolerance;
```

## Failure policy

State it per test in the design. Three choices:

- **Block**: the write does not happen; the batch is retried or dead-lettered.
- **Alert**: the write happens; a human is told; the row is flagged if there is a place to flag it.
- **Quarantine**: the row goes to a holding table and is excluded from the target until reviewed.

A test with no stated policy is not a test.
