# SQL analysis patterns

Postgres syntax. Adjust for other engines.

## Contents
- Profiling
- Cardinality and fan-out checks
- Dedupe
- Period over period
- Mix versus rate decomposition
- Cohorts and retention
- Funnels
- Running totals and moving windows
- Gaps and islands
- Confidence interval for a rate

## Profiling

Run these on every table before using it. Keep the output in the write-up.

```sql
-- Shape
SELECT count(*) AS rows,
       min(created_at) AS first_at, max(created_at) AS last_at,
       count(DISTINCT account_id) AS accounts
FROM payments;

-- Nulls on the columns you will use
SELECT count(*) - count(attempt_date) AS attempt_date_nulls,
       count(*) - count(status)       AS status_nulls,
       count(*) - count(amount)       AS amount_nulls
FROM payments;

-- Duplicates on the key you assume
SELECT account_id, due_date, attempt_number, count(*)
FROM payments GROUP BY 1, 2, 3 HAVING count(*) > 1 LIMIT 20;

-- Value distribution of categoricals
SELECT status, count(*) FROM payments GROUP BY 1 ORDER BY 2 DESC;

-- Date coverage by month (spot missing or thin months)
SELECT date_trunc('month', attempt_date)::date AS m, count(*) FROM payments GROUP BY 1 ORDER BY 1;

-- Range sanity
SELECT min(amount), percentile_cont(0.5) WITHIN GROUP (ORDER BY amount), max(amount) FROM payments;
```

## Cardinality and fan-out checks

Before any join used in a sum or count:

```sql
-- Is the right side unique on the join key?
SELECT customer_id, count(*) FROM accounts GROUP BY 1 HAVING count(*) > 1 LIMIT 5;

-- Did the join change the row count?
SELECT (SELECT count(*) FROM payments) AS before,
       (SELECT count(*) FROM payments p JOIN accounts a ON a.id = p.account_id) AS after;
```

If `after > before`, the join fans out. Aggregate the many side first, then join.

## Dedupe

Keep the latest row per key:

```sql
SELECT DISTINCT ON (account_id) *
FROM account_events
ORDER BY account_id, version DESC;
```

## Period over period

Half-open ranges on the raw column; bucket in the business timezone.

```sql
WITH bucketed AS (
  SELECT date_trunc('month', attempt_date)::date AS m,
         status, attempt_number, amount
  FROM payments
  WHERE attempt_date >= '2026-07-01' AND attempt_date < '2026-10-01'
)
SELECT m,
       count(*)                                            AS attempts,
       count(*) FILTER (WHERE status = 'dishonoured')      AS dishonoured,
       count(*) FILTER (WHERE status = 'pending')          AS pending,
       round(100.0 * count(*) FILTER (WHERE status = 'dishonoured')
             / nullif(count(*) FILTER (WHERE status IN ('success', 'dishonoured')), 0), 2) AS rate_pct,
       count(*) FILTER (WHERE attempt_number = 1)          AS first_attempts
FROM bucketed GROUP BY 1 ORDER BY 1;
```

Always show the pending count next to the rate: a period still settling is not comparable.

## Mix versus rate decomposition

Overall rate = sum over segments of (segment share x segment rate). Change in overall rate splits
into a mix effect (shares moved, rates held at the base period) and a rate effect (rates moved,
shares held at the comparison period).

```sql
WITH seg AS (
  SELECT period, segment,
         count(*) AS n,
         count(*) FILTER (WHERE outcome = 'bad') AS bad
  FROM facts GROUP BY 1, 2
), tot AS (
  SELECT period, sum(n) AS n FROM seg GROUP BY 1
), s AS (
  SELECT seg.period, seg.segment,
         seg.n::numeric / tot.n AS share,
         seg.bad::numeric / seg.n AS rate
  FROM seg JOIN tot USING (period)
), base AS (SELECT * FROM s WHERE period = 'A'),
   comp AS (SELECT * FROM s WHERE period = 'B')
SELECT c.segment,
       b.share AS share_a, c.share AS share_b,
       b.rate  AS rate_a,  c.rate  AS rate_b,
       (c.share - b.share) * b.rate   AS mix_effect,
       c.share * (c.rate - b.rate)    AS rate_effect
FROM comp c JOIN base b USING (segment)
ORDER BY abs((c.share - b.share) * b.rate + c.share * (c.rate - b.rate)) DESC;
```

Sum of `mix_effect` plus `rate_effect` over segments equals the total change in the overall rate.
Report the two or three segments that explain most of it.

## Cohorts and retention

One row per cohort x period-since-start.

```sql
WITH first_seen AS (
  SELECT customer_id, date_trunc('month', min(opened_at))::date AS cohort
  FROM accounts GROUP BY 1
), activity AS (
  SELECT a.customer_id, date_trunc('month', p.attempt_date)::date AS m
  FROM payments p JOIN accounts a ON a.id = p.account_id
  WHERE p.status = 'success'
  GROUP BY 1, 2
)
SELECT f.cohort,
       (extract(year FROM age(act.m, f.cohort)) * 12 + extract(month FROM age(act.m, f.cohort)))::int AS months_since,
       count(DISTINCT act.customer_id) AS active,
       count(DISTINCT act.customer_id)::numeric / nullif(count(DISTINCT f.customer_id), 0) AS retention
FROM first_seen f LEFT JOIN activity act USING (customer_id)
GROUP BY 1, 2 ORDER BY 1, 2;
```

Compare cohorts at the same `months_since`, never at the same calendar month.

## Funnels

Count distinct entities reaching each stage, bucketed by the entry stage's date so later stages
of a cohort are compared to its own entries.

```sql
SELECT date_trunc('month', submitted_on)::date AS m,
       count(*)                          AS submitted,
       count(*) FILTER (WHERE decided_on IS NOT NULL) AS decided,
       count(*) FILTER (WHERE approved)  AS approved,
       count(*) FILTER (WHERE funded)    AS funded,
       round(100.0 * count(*) FILTER (WHERE funded) / nullif(count(*), 0), 1) AS submitted_to_funded_pct
FROM reporting.application
WHERE submitted_on >= :from AND submitted_on < :to
GROUP BY 1 ORDER BY 1;
```

The most recent month is always under-converted: later stages have not happened yet.

## Running totals and moving windows

```sql
SELECT d, n,
       sum(n) OVER (ORDER BY d) AS cumulative,
       avg(n) OVER (ORDER BY d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS avg_7d
FROM daily ORDER BY d;
```

Use `ROWS` not `RANGE` when the series has no gaps; fill gaps with a date spine first otherwise.

## Gaps and islands

Contiguous runs (e.g. consecutive days in arrears):

```sql
WITH marked AS (
  SELECT account_id, d,
         d - (row_number() OVER (PARTITION BY account_id ORDER BY d))::int AS grp
  FROM arrears_days
)
SELECT account_id, min(d) AS run_start, max(d) AS run_end, count(*) AS days
FROM marked GROUP BY account_id, grp ORDER BY 1, 2;
```

## Confidence interval for a rate

```sql
SELECT n, p,
       p - 1.96 * sqrt(p * (1 - p) / n) AS lo,
       p + 1.96 * sqrt(p * (1 - p) / n) AS hi
FROM (SELECT count(*) AS n,
             count(*) FILTER (WHERE status = 'dishonoured')::numeric / count(*) AS p
      FROM payments WHERE attempt_date >= '2026-09-01' AND attempt_date < '2026-10-01') x;
```

If the intervals for the two periods overlap, say the change may be noise.
