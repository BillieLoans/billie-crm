# Decline reasons in detail

Date: 2026-10-27. Follows BTB-462 (decline rate and reasons).

## Intent

"Decline rate and reasons" shows declines in five categories. Staff want to
know _which rule_ declined an application, because one rule (the account
conduct "Data quality gate G4", leakage ratio) is believed to drive many
declines and the category "character" hides it. This design reports a decline
by the rule that failed, and gives the existing report a path down to it.

## What the CRM holds, and what it did not

- `reporting.decision.reason` is the component that declined
  (`CREDIT_ASSESSMENT:ACCOUNT_CONDUCT`, `:SERVICEABILITY`, a block code). It
  never names a rule.
- The rule-level results (`rule_results`) are written to the S3 assessment
  file only. The `credit_assessment_*_result` events carried the decision and
  the file location, nothing per rule.
- The event processor stores those events' payloads whole on the conversation
  (`assessments_account_conduct`, `assessments_serviceability`), so a new
  payload key reaches the CRM with no processor change.

## Decisions

1. **billieChat adds `failed_rules`** (a list of rule ids, nothing else) to the
   account conduct and serviceability result events. Ids are not personal
   data; the figures stay in S3. Info-only rules are never listed.
2. **The reporting schema reads them**: `application.account_conduct_failed_rules`,
   `application.serviceability_failed_rules` (text[]), and
   `application.declined_components` from the decision's metadata. A new
   `credit_rule` table (seeded in `schema.ts`, like `decline_reason_category`)
   maps ids to a family and a short label. `decline_reason_label(reason, rule)`
   is the one place a reason is turned into words, so every report names it
   the same way. An unlisted rule id is shown as is.
3. **Three reports, one drill chain**:
   - `decline-rate` (existing): the reasons chart and the segment column
     drill into `decline-reasons` with the clicked segment.
   - `decline-reasons` (new): one row per reason, where a reason is each
     failed rule for a credit-assessment decline with recorded rules, else
     the reason code in words. Ranked horizontal bars. Clicking a reason
     drills into `decline-reasons-trend`.
   - `decline-reasons-trend` (new): one row per ISO week, with declines
     matching one reason beside all declines (line), the category mix
     (stacked bars) and the decline rate.
4. **No total row in the detail report.** An application that failed two
   rules counts under each, so rows do not add to the declines; the share
   column is of all declines in the period and segment, and a constant
   `all_declines` column (the headline) states the denominator. The category
   filter narrows rows but never the denominator.
5. **Migration, not hand edits.** `20261101_090000_decline_reasons` re-runs
   the schema statements, publishes the two reports where their slug is free,
   and adds the drill-down to `decline-rate` only where its SQL and chart are
   still as seeded.

## Metric definitions

| measure                    | formula                                                                | grain        | source                | inclusions / exclusions                                                                                    | unit  |
| -------------------------- | ---------------------------------------------------------------------- | ------------ | --------------------- | ---------------------------------------------------------------------------------------------------------- | ----- |
| declines (detail)          | count distinct conversations with this reason                          | reason label | decision, application | DECLINED, not mock, decided_on in range, segment match; a rule row only for `CREDIT_ASSESSMENT:*` declines | count |
| share_of_declines_pct      | declines / all declines in period and segment                          | reason label | same                  | denominator ignores the category filter                                                                    | %     |
| decided / declined (trend) | count of latest decisions / of DECLINED                                | ISO week     | decision              | not mock                                                                                                   | count |
| matching (trend)           | declines whose label equals the reason filter; all declines when empty | ISO week     | same                  | same                                                                                                       | count |

## Validation

- Integration tests build seven April decisions (two G4 failures, one with a
  second component, a block with an earlier failed rule, a decision from
  before rules were recorded, an approval, a mock) and check the ranked rows,
  the segment and category filters, the week spine and the drill upgrade.
- Schema tests cover `decline_reason_label` for every prefix and the new
  view columns; the privacy test seeds personal-looking values beside the
  rule ids and asserts only the ids come through.

## Left to the builder

- Short labels in `CREDIT_RULES` are taken from the rule descriptions in
  billieChat's `accountConductRules.json`; refine wording there.
- Weeks are Monday to Sunday by `date_trunc('week')`; the first and last
  rows may be partial and the description says so. A week label in the
  chart could carry "(partial)" later.

## Addendum, same day: history

The full assessment files in S3 have always held the rule results, and the
application view already fetches them for "View full details". Two additions
use that:

- `effective_decline_reason()` in the schema: a decline from before reasons
  were recorded takes the first assessment component that declined, in
  billieChat's precedence, so it gets a real category and its rule rows
  instead of "other" or "(no reason recorded)". The decline rate report uses
  it too, so the three reports agree on a segment's categories.
- `backfill_failed_rules`, an event-processor script: reads each DECLINED
  result without `failed_rules`, fetches its file with a read-only AWS
  profile, and merges the failing rule ids (ids only) through the
  processor's own jsonb merge. Dry run by default; idempotent.
