---
name: analysing-data
description: Use when answering a question with data - why a number moved, how many or how much, whether a claim or hypothesis holds, what a cohort or segment does, exploratory analysis of unfamiliar tables, or checking a figure someone else produced; includes writing investigative SQL, profiling data, and presenting findings to non-technical stakeholders. Also use when asked to analyze, analyse, investigate, dig into, size, or explain the numbers.
---

# Analysing Data

## Overview

Define before you measure. Profile before you trust. Reproduce before you explain. Decompose
before you conclude. The answer has a fixed shape (below) so that the definition, the checks and
the caveats are written down, not just done.

Related skills: building-reports (when the answer should become a repeatable report),
building-data-pipelines (when the finding is a data defect).

## The deliverable

An analysis answer has these parts, in this order:

1. **Answer.** One or two sentences with the number and how confident you are.
2. **Metric definition used.** Name, numerator, denominator, grain (one row per what), the
   date column that buckets it, timezone, filters, inclusions and exclusions. If the question
   came with a number, state whether this definition reproduces it.
3. **Data checks performed.** Row counts, nulls on the columns used, duplicates on the expected
   key, date coverage, join cardinality, and the sample size behind any rate.
4. **Decomposition.** What changed: mix (segment sizes moved) versus rate (segments got worse or
   better), by the dimensions that could plausibly move in the period.
5. **Ruled out.** Hypotheses tested and rejected, one line each, including data artefacts
   (mapping change, pipeline change, timezone, partial period).
6. **Caveats.** Partial periods, settlement or reporting lag, small n, known data gaps.
7. **Next step.** The recommendation or the follow-up question, and the SQL (or saved query) so
   it can be re-run.

## Process

1. Restate the question as the decision it supports. "Why did X go up" usually means "should we
   do something, and what".
2. Write the metric definition (part 2) before running anything. If a dashboard produced the
   number, find its query and use that definition first.
3. Profile every table you will touch. Queries: `references/sql-analysis-patterns.md`,
   section "Profiling".
4. Reproduce the headline figure. Failure to reproduce is finding number one.
5. Check the denominator and the volumes moved as much as the numerator.
6. Check sample size. For a rate `p` on `n` trials the 95% interval is about
   `p ± 1.96 * sqrt(p * (1 - p) / n)`. Two months at 6% and 9% on 300 payments each overlap.
7. Decompose by segment: compute the rate within each segment, then split the overall change into
   mix and rate. Pattern in the reference.
8. Look outside the tables: deploys, config or policy changes, provider incidents, status-mapping
   changes in the pipeline, calendar effects.
9. Write it up in the shape above. Lead with the answer.

## Common mistakes

- A join that fans out (one-to-many) doubling sums and counts. Check cardinality before summing.
- Comparing a partial period to a full one, or a period still settling to one that has settled.
- Averaging ratios instead of recomputing from summed parts.
- `count(col)` silently skipping nulls where `count(*)` was meant, or the reverse.
- Month boundaries computed in UTC on a business that runs in another timezone.
- Counting attempts when the question is about customers, or rows when it is about money.
- Calling two points a trend.
- Simpson's paradox: every segment flat, total moved, because the mix moved.
- Survivorship: analysing only accounts that are still open.
- Treating a status or category as stable when its mapping changed upstream.

## Reference

`references/sql-analysis-patterns.md`: profiling, dedupe, cardinality checks, period-over-period,
mix-versus-rate decomposition, cohorts and retention, funnels, running totals, gaps and islands.
