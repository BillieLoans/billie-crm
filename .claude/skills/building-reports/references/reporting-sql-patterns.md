# Reporting SQL patterns

Postgres syntax, parameters shown as `:name`.

## Contents
- Parameter handling
- Period spine and dense grid
- Shares with explicit denominators
- Period-over-period columns
- Partial period labelling
- Top-N with "other"
- Validation queries

## Parameter handling

Normalise parameters once in a CTE, then reference them. Snap to period starts, make the end
exclusive, and keep predicates on raw columns so indexes apply.

```sql
WITH params AS (
  SELECT date_trunc('month', :from_month::date)::date                           AS from_month,
         (date_trunc('month', :to_month::date) + interval '1 month')::date      AS to_exclusive,
         nullif(:purpose_category::text, '')                                   AS purpose_filter
)
SELECT ... FROM reporting.loan l CROSS JOIN params p
WHERE l.funded_on >= p.from_month AND l.funded_on < p.to_exclusive
  AND (p.purpose_filter IS NULL OR l.purpose_category = p.purpose_filter);
```

## Period spine and dense grid

```sql
months AS (
  SELECT generate_series(p.from_month, p.to_exclusive - interval '1 month', interval '1 month')::date AS month
  FROM params p
),
categories AS (SELECT DISTINCT purpose_category FROM funded),
agg AS (SELECT month, purpose_category, count(*) AS n, sum(principal_cents) AS cents FROM funded GROUP BY 1, 2)
SELECT m.month, c.purpose_category,
       coalesce(a.n, 0) AS loan_count,
       round(coalesce(a.cents, 0) / 100.0, 2) AS principal_aud
FROM months m CROSS JOIN categories c
LEFT JOIN agg a ON a.month = m.month AND a.purpose_category = c.purpose_category
ORDER BY 1, 2;
```

## Shares with explicit denominators

Decide whether the share is of the filtered set or of everything, and compute the denominator from
the matching set.

```sql
-- Share of all originations in the month, even when a purpose filter is applied
totals AS (
  SELECT date_trunc('month', funded_on)::date AS month, sum(principal_cents) AS cents
  FROM reporting.loan l CROSS JOIN params p
  WHERE l.funded_on >= p.from_month AND l.funded_on < p.to_exclusive
  GROUP BY 1
)
SELECT a.month, a.purpose_category,
       round(100.0 * a.cents / nullif(t.cents, 0), 1) AS share_of_month_pct
FROM agg a JOIN totals t USING (month);
```

## Period-over-period columns

```sql
SELECT month, n,
       lag(n) OVER (ORDER BY month)                                    AS prior_month,
       round(100.0 * (n - lag(n) OVER (ORDER BY month))
             / nullif(lag(n) OVER (ORDER BY month), 0), 1)             AS mom_pct,
       lag(n, 12) OVER (ORDER BY month)                                AS same_month_last_year
FROM monthly ORDER BY month;
```

The window must run over a dense spine or `lag` points at the wrong period.

## Partial period labelling

```sql
SELECT month,
       to_char(month, 'Mon YYYY')
         || CASE WHEN month = date_trunc('month', current_date)::date THEN ' (to date)' ELSE '' END
         AS month_label
FROM months;
```

## Top-N with "other"

```sql
ranked AS (
  SELECT category, cents, rank() OVER (ORDER BY cents DESC) AS r FROM by_category
)
SELECT CASE WHEN r <= 8 THEN category ELSE 'other' END AS category, sum(cents) AS cents
FROM ranked GROUP BY 1 ORDER BY 2 DESC;
```

## Validation queries

Run these before calling the report done and record the results in the spec.

```sql
-- Reconcile to a known figure: total funded in a closed month
SELECT count(*), sum(principal_cents) / 100.0
FROM reporting.loan WHERE funded_on >= '2026-08-01' AND funded_on < '2026-09-01';
-- compare to finance's August figure

-- Report total equals the sum of its rows (no double counting from the grid)
-- run the report, sum loan_count, compare to the count above

-- Edge cases: run the report with
--   from = to (single month); a range with no data; the current month; each filter value;
--   a filter plus a share column, and confirm the share denominator behaves as the spec says
```
