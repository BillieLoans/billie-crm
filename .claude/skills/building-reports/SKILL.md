---
name: building-reports
description: Use when creating, changing or reviewing a report, dashboard, KPI, metric definition or scheduled data delivery - a report spec, parameterised report SQL, table and chart layout for a reporting module, deciding what a metric means, or checking that a report's numbers are right. Also use when asked for "monthly X by Y", "a view of", "the exec team wants to see", or a chart of some measure over time.
---

# Building Reports

## Overview

A report is a contract: a named audience, the question it answers, the decision it supports, and
metric definitions precise enough that two people would get the same number. The spec has a fixed
shape (below) so that definitions, parameters and validation are written, not assumed. The SQL
follows from the spec.

Related skills: analysing-data (one-off questions that may become reports),
designing-data-architecture (when the reporting layer lacks what the report needs).

## The deliverable

A report spec has these sections, in order:

1. **Header.** Name. Audience and the roles that may run it. The question in one sentence. The
   decision it supports. Cadence and as-of behaviour.
2. **Metric definitions.** One table, one row per measure.
   Template: `references/metric-definition-template.md`.

   | measure | formula | grain | source objects | inclusions / exclusions | unit | owner |
   |---|---|---|---|---|---|---|

3. **Parameters.** Name, type, default, bounds, whether ranges are inclusive or half-open,
   timezone, and what each parameter does to any percentage or share in the output.
4. **Output shape.** One row per what. Columns with unit and display format. Sort order. Whether
   the grid is dense (every period x category emitted with zeros) and why. Null versus zero rule.
   Expected row count.
5. **Chart.** Type, x, series, y, and the measure it leads with. Guidance:
   `references/chart-selection.md`. If a visualisation skill is available in the session, use it
   for colour and layout.
6. **SQL.** Conventions in `references/reporting-sql-patterns.md`.
7. **Validation.** The known figure this reconciles to (and the result). Edge cases run: empty
   range, single period, current partial period, each parameter at its bounds, filters combined
   with shares. Cross-report consistency: another report that shows the same number, and that it
   matches.
8. **Caveats shown to the reader.** Partial periods, lag, what is excluded, which source is the
   figure of record.

## Defaults

| Concern | Default |
|---|---|
| Date ranges | Half-open on the raw date column: `d >= :from AND d < :to_exclusive`. Parameters snapped to period start. |
| Timezone | Business dates come from the layer's `*_on` columns; never re-derive from timestamps in the report. |
| Money | Minor units in the data, converted once in the final SELECT, labelled with currency. |
| Shares and rates | Denominator stated in the definition; say what a filter does to it. Null, not zero, when the denominator is zero. |
| Current period | Emitted and labelled partial. |
| Grid | Dense via a period spine (`generate_series`) joined to the category set, so charts have no gaps. |
| Unknowns | A visible `unknown` bucket, never dropped rows. |
| Row cap | A report returns an aggregate, not a list. If it lists entities it says why and caps rows. |
| Personal data | None. Counts of sensitive flags, never per person. |
| Performance | Aggregate before windowing; predicates on indexed raw columns; respects the runner's statement timeout. |

## Common mistakes

- "Active", "origination", "customer" used without a definition; the spec says what counts.
- A share-of-total that silently becomes share-of-filtered when a filter is applied.
- The current month shown next to complete months without a label.
- Counting attempts when the audience thinks in customers, or applications when they think in loans.
- Two grains in one table (monthly rows and a lifetime total row).
- Fifteen series on one chart; a pie for a time series; dual axes with no reason.
- A report shipped without reproducing one number the audience already trusts.
- Report SQL that reads operational tables instead of the reporting layer.
- Metric defined in the SQL only, so the next report defines it differently.
