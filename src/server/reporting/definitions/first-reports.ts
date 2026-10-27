/**
 * The first three reports (BTB-507) and the core reports behind the
 * Reports home's headline numbers, as data.
 *
 * The `20261026_100000_first_reports` and `20261030_170000_core_reports`
 * migrations create them in each environment if their slug is free. After
 * that they are ordinary report definitions: authors change them in the
 * admin, and this file is not read again. The integration test runs each one against TEST data.
 */
import type { Payload, PayloadRequest } from 'payload'
import { sameJson } from '@/lib/reports/diff'
import type {
  ColumnSpec,
  HeadlineSpec,
  ReportCategory,
  ReportParameter,
} from '@/lib/schemas/reports'

export interface ReportDefinitionSeed {
  title: string
  slug: string
  description: string
  category: ReportCategory
  featured: boolean
  sql: string
  parameters: ReportParameter[]
  chart: unknown
  headline: HeadlineSpec[]
  columnSettings: ColumnSpec[]
  roles: Array<'admin' | 'supervisor' | 'operations' | 'readonly'>
  schedule: 'none' | 'weekly_monday'
}

const DATE_RANGE: ReportParameter[] = [
  { name: 'from', label: 'From', type: 'date', required: true, default: 'today-7' },
  { name: 'to', label: 'To', type: 'date', required: true, default: 'today-1' },
]

/** BTB-462: decline rate and reasons, by source or by ruleset version. */
const declineRate: ReportDefinitionSeed = {
  title: 'Decline rate and reasons',
  slug: 'decline-rate',
  description:
    'Decisions made in the period (Sydney dates), split by acquisition source or by credit ' +
    'ruleset version, with declines by reason category and an "All" total. Click a segment ' +
    'in the reasons chart, or its name in the table, to see the reasons behind its declines ' +
    'rule by rule. A decline with no recorded reason takes the category of the first ' +
    'assessment that declined it, else counts as "other". Mock decisions are excluded. ' +
    'Decisions made before ' +
    'ruleset versions were recorded show as "(not recorded)"; applications from before ' +
    'attribution capture (6 October 2026) show as "not recorded".',
  sql: `WITH d AS (
  SELECT dec.decision,
         COALESCE(decline_category(effective_decline_reason(dec.reason,
                    a.account_conduct_decision, a.serviceability_decision,
                    a.identity_risk_decision, a.post_identity_risk_decision)), 'other')
           AS category,
         CASE $3::text
           WHEN 'ruleset' THEN COALESCE(dec.ruleset_version, '(not recorded)')
           ELSE a.acquisition
         END AS seg
    FROM decision AS dec
    JOIN application AS a USING (conversation_id)
   WHERE dec.decided_on BETWEEN $1::date AND $2::date
     AND NOT dec.mock_origin
)
SELECT CASE WHEN GROUPING(seg) = 1 THEN 'All' ELSE seg END AS segment,
       count(*) AS decided,
       count(*) FILTER (WHERE decision = 'DECLINED') AS declined,
       round(100.0 * count(*) FILTER (WHERE decision = 'DECLINED') / NULLIF(count(*), 0), 1)
         AS decline_rate_pct,
       count(*) FILTER (WHERE decision = 'DECLINED' AND category = 'capacity') AS capacity,
       count(*) FILTER (WHERE decision = 'DECLINED' AND category = 'character') AS character,
       count(*) FILTER (WHERE decision = 'DECLINED' AND category = 'identity') AS identity,
       count(*) FILTER (WHERE decision = 'DECLINED' AND category = 'eligibility') AS eligibility,
       count(*) FILTER (WHERE decision = 'DECLINED' AND category = 'other') AS other
  FROM d
 GROUP BY GROUPING SETS ((seg), ())
HAVING count(*) > 0
 ORDER BY GROUPING(seg), decided DESC, segment`,
  parameters: [
    ...DATE_RANGE,
    {
      name: 'group_by',
      label: 'Split by',
      type: 'select',
      required: true,
      default: 'source',
      options: [
        { value: 'source', label: 'Acquisition source' },
        { value: 'ruleset', label: 'Credit ruleset version' },
      ],
    },
  ],
  category: 'credit',
  featured: false,
  // The rate by segment, against the overall rate; then the mix of reasons
  // as shares, so a small segment's mix compares with a large one's.
  chart: [
    {
      type: 'bar-horizontal',
      x: 'segment',
      series: [{ column: 'decline_rate_pct', label: 'Decline rate' }],
    },
    {
      type: 'stacked-100',
      x: 'segment',
      series: [
        { column: 'capacity', label: 'Capacity' },
        { column: 'character', label: 'Character' },
        { column: 'identity', label: 'Identity' },
        { column: 'eligibility', label: 'Eligibility' },
        { column: 'other', label: 'Other' },
      ],
      // A segment opens the detail report filtered to it; the All row
      // opens it unfiltered.
      drill: { report: 'decline-reasons', parameter: 'segment' },
    },
  ],
  headline: [
    { column: 'decline_rate_pct', label: 'Decline rate', value: 'total', better: 'lower' },
    { column: 'decided', label: 'Decisions', value: 'total' },
    { column: 'declined', label: 'Declined', value: 'total' },
  ],
  columnSettings: [
    {
      name: 'decline_rate_pct',
      label: 'Decline rate',
      base: 'decided',
      better: 'lower',
      description: 'Declined as a share of decided.',
    },
    { name: 'decided', description: 'Applications with a final credit decision in the period.' },
  ],
  roles: ['admin', 'supervisor'],
  schedule: 'weekly_monday',
}

/** BTB-500's split, in the CRM: the application funnel by source and medium. */
const funnel: ReportDefinitionSeed = {
  title: 'Application funnel by source',
  slug: 'application-funnel',
  description:
    'Applications started in the period (Sydney dates) and how far they got: submitted ' +
    '(bank statements shared, or decided), decided, approved, funded. Without a recorded ' +
    'source the row is named by its acquisition group: "(direct)" for no attribution, ' +
    '"(paid)" for an ad click with no UTM tags, and "(not recorded)" before attribution ' +
    'capture began on 6 October 2026. Mock decisions are excluded.',
  sql: `SELECT COALESCE(a.source, '(' || a.acquisition || ')')
         || ' / ' || COALESCE(a.medium, '(none)') AS source_medium,
       a.acquisition,
       count(*) AS started,
       count(*) FILTER (WHERE a.submitted) AS submitted,
       count(*) FILTER (WHERE a.decided) AS decided,
       count(*) FILTER (WHERE a.approved) AS approved,
       count(*) FILTER (WHERE a.funded) AS funded
  FROM application AS a
  LEFT JOIN decision AS d USING (conversation_id)
 WHERE a.started_on BETWEEN $1::date AND $2::date
   AND d.mock_origin IS NOT TRUE
 GROUP BY 1, 2
 ORDER BY started DESC, source_medium`,
  parameters: DATE_RANGE,
  chart: {
    type: 'bar',
    x: 'source_medium',
    series: [
      { column: 'started', label: 'Started' },
      { column: 'submitted', label: 'Submitted' },
      { column: 'decided', label: 'Decided' },
      { column: 'approved', label: 'Approved' },
      { column: 'funded', label: 'Funded' },
    ],
  },
  category: 'acquisition',
  featured: false,
  headline: [
    { column: 'started', label: 'Started', value: 'sum' },
    { column: 'funded', label: 'Funded', value: 'sum', better: 'higher' },
  ],
  columnSettings: [],
  roles: ['admin', 'supervisor', 'operations'],
  schedule: 'none',
}

/** BTB-460: the go-to-market numbers the reporting schema can answer. */
const gtm: ReportDefinitionSeed = {
  title: 'Go-to-market numbers',
  slug: 'gtm-numbers',
  description:
    'By acquisition source, for applications started and loans disbursed in the period ' +
    '(Sydney dates): share of starts, pass rate (approved of decided), funded rate (funded ' +
    'of started), median hours from starting an application to money, and repayment health ' +
    'of the loans disbursed. The "referral" row is applications that arrived from another ' +
    'website (utm_medium=referral), not the referral programme. Not answerable yet: ' +
    'referral-programme share (applications are not linked to referring contacts), cash ' +
    'cost per funded customer (needs ad spend) and place turnover (needs queue data). Mock ' +
    'decisions and their loans are excluded.',
  sql: `WITH apps AS (
  SELECT a.*
    FROM application AS a
    LEFT JOIN decision AS d USING (conversation_id)
   WHERE a.started_on BETWEEN $1::date AND $2::date
     AND d.mock_origin IS NOT TRUE
),
by_source AS (
  SELECT CASE WHEN GROUPING(acquisition) = 1 THEN 'All sources' ELSE acquisition END AS source,
         count(*) AS starts,
         count(*) FILTER (WHERE decided) AS decided,
         count(*) FILTER (WHERE approved) AS approved,
         count(*) FILTER (WHERE funded) AS funded,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY extract(epoch FROM funded_at - started_at) / 3600
         ) FILTER (WHERE funded) AS median_hours
    FROM apps
   GROUP BY GROUPING SETS ((acquisition), ())
),
health AS (
  SELECT CASE WHEN GROUPING(l.acquisition) = 1 THEN 'All sources' ELSE l.acquisition END
           AS source,
         count(*) AS loans,
         count(*) FILTER (WHERE l.in_arrears) AS in_arrears
    FROM loan AS l
    LEFT JOIN decision AS d ON d.conversation_id = l.conversation_id
   WHERE l.disbursed_on BETWEEN $1::date AND $2::date
     AND d.mock_origin IS NOT TRUE
   GROUP BY GROUPING SETS ((l.acquisition), ())
)
SELECT source,
       COALESCE(b.starts, 0) AS starts,
       round(100.0 * COALESCE(b.starts, 0)
             / NULLIF((SELECT starts FROM by_source WHERE source = 'All sources'), 0), 1)
         AS share_of_starts_pct,
       COALESCE(b.decided, 0) AS decided,
       COALESCE(b.approved, 0) AS approved,
       round(100.0 * b.approved / NULLIF(b.decided, 0), 1) AS pass_rate_pct,
       COALESCE(b.funded, 0) AS funded,
       round(100.0 * b.funded / NULLIF(b.starts, 0), 1) AS funded_rate_pct,
       round(b.median_hours::numeric, 1) AS median_hours_to_money,
       COALESCE(h.loans, 0) AS loans_disbursed,
       COALESCE(h.in_arrears, 0) AS loans_in_arrears,
       round(100.0 * h.in_arrears / NULLIF(h.loans, 0), 1) AS arrears_rate_pct
  FROM by_source AS b
  FULL JOIN health AS h USING (source)
 WHERE source <> 'All sources' OR b.starts > 0 OR h.loans > 0
 ORDER BY source = 'All sources', COALESCE(b.starts, 0) DESC, source`,
  parameters: [
    { name: 'from', label: 'From', type: 'date', required: true, default: 'today-30' },
    { name: 'to', label: 'To', type: 'date', required: true, default: 'today-1' },
  ],
  category: 'acquisition',
  featured: false,
  chart: {
    type: 'bar-horizontal',
    x: 'source',
    series: [{ column: 'funded_rate_pct', label: 'Funded rate' }],
  },
  headline: [
    { column: 'starts', label: 'Starts', value: 'total', better: 'higher' },
    { column: 'pass_rate_pct', label: 'Pass rate', value: 'total', better: 'higher' },
    { column: 'funded_rate_pct', label: 'Funded rate', value: 'total', better: 'higher' },
    { column: 'median_hours_to_money', label: 'Hours to money', value: 'total', better: 'lower' },
  ],
  columnSettings: [
    { name: 'share_of_starts_pct', label: 'Share of starts' },
    {
      name: 'pass_rate_pct',
      label: 'Pass rate',
      base: 'decided',
      better: 'higher',
      description: 'Approved as a share of decided.',
    },
    {
      name: 'funded_rate_pct',
      label: 'Funded rate',
      base: 'starts',
      better: 'higher',
      description: 'Funded as a share of applications started.',
    },
    {
      name: 'median_hours_to_money',
      label: 'Hours to money',
      better: 'lower',
      description: 'Median hours from starting an application to the money being sent.',
    },
    {
      name: 'arrears_rate_pct',
      label: 'In arrears',
      base: 'loans_disbursed',
      better: 'lower',
      description: 'Loans disbursed in the period that are now in arrears.',
    },
  ],
  roles: ['admin', 'supervisor'],
  schedule: 'none',
}

export const FIRST_REPORTS: readonly ReportDefinitionSeed[] = [declineRate, funnel, gtm]

/**
 * The decline reasons chart as it shipped before the drill-down: what
 * `upgradeDeclineRateDrill` looks for to know an author has not changed it.
 */
export const DECLINE_RATE_CHART_BEFORE_DRILL: unknown = (declineRate.chart as unknown[]).map(
  (chart) => {
    const { drill: _drill, ...rest } = chart as { drill?: unknown }
    return rest
  },
)

/** The decline rate SQL as first seeded (BTB-507), before `effective_decline_reason`. */
export const DECLINE_RATE_SQL_BEFORE_DRILL = `WITH d AS (
  SELECT dec.decision,
         COALESCE(dec.decline_category, 'other') AS category,
         CASE $3::text
           WHEN 'ruleset' THEN COALESCE(dec.ruleset_version, '(not recorded)')
           ELSE a.acquisition
         END AS seg
    FROM decision AS dec
    JOIN application AS a USING (conversation_id)
   WHERE dec.decided_on BETWEEN $1::date AND $2::date
     AND NOT dec.mock_origin
)
SELECT CASE WHEN GROUPING(seg) = 1 THEN 'All' ELSE seg END AS segment,
       count(*) AS decided,
       count(*) FILTER (WHERE decision = 'DECLINED') AS declined,
       round(100.0 * count(*) FILTER (WHERE decision = 'DECLINED') / NULLIF(count(*), 0), 1)
         AS decline_rate_pct,
       count(*) FILTER (WHERE decision = 'DECLINED' AND category = 'capacity') AS capacity,
       count(*) FILTER (WHERE decision = 'DECLINED' AND category = 'character') AS character,
       count(*) FILTER (WHERE decision = 'DECLINED' AND category = 'identity') AS identity,
       count(*) FILTER (WHERE decision = 'DECLINED' AND category = 'eligibility') AS eligibility,
       count(*) FILTER (WHERE decision = 'DECLINED' AND category = 'other') AS other
  FROM d
 GROUP BY GROUPING SETS ((seg), ())
HAVING count(*) > 0
 ORDER BY GROUPING(seg), decided DESC, segment`

/**
 * Declines in a period, exploded to the finest reason the CRM holds. For a
 * decline the credit assessment made, that is each rule that failed
 * (billieChat's `failed_rules`, labelled through `credit_rule`); for every
 * other decline, or one made before the rules were recorded, the reason
 * code in words. The `segment` parameter is what the decline rate report's
 * drill-down passes: an acquisition source or a ruleset version.
 */
const DECLINE_DETAIL_SQL = `WITH declined AS (
  SELECT dec.conversation_id,
         r.reason,
         COALESCE(decline_category(r.reason), 'other') AS category,
         dec.retry_eligible,
         CASE WHEN r.reason LIKE 'CREDIT_ASSESSMENT:%'
              THEN COALESCE(a.account_conduct_failed_rules, '{}')
                   || COALESCE(a.serviceability_failed_rules, '{}')
              ELSE '{}'::text[] END AS failed_rules
    FROM decision AS dec
    JOIN application AS a USING (conversation_id)
    -- The recorded reason, or for an older decline the first assessment
    -- that declined it.
    CROSS JOIN LATERAL (
      SELECT effective_decline_reason(dec.reason, a.account_conduct_decision,
               a.serviceability_decision, a.identity_risk_decision,
               a.post_identity_risk_decision) AS reason
    ) AS r
   WHERE dec.decided_on BETWEEN $1::date AND $2::date
     AND NOT dec.mock_origin
     AND dec.decision = 'DECLINED'
     AND ($3::text IS NULL OR $3::text = 'All'
          OR a.acquisition = $3::text
          OR COALESCE(dec.ruleset_version, '(not recorded)') = $3::text)
),
detail AS (
  -- One row per failed rule where the rules are known; the reason itself
  -- where they are not, and always for a reason outside those two
  -- components (a block, an identity decline).
  SELECT d.conversation_id,
         d.retry_eligible,
         decline_reason_label(d.reason, r.rule_id) AS reason,
         COALESCE(decline_category('CREDIT_ASSESSMENT:' || upper(cr.family)), d.category)
           AS category
    FROM declined AS d
    LEFT JOIN LATERAL (
      SELECT rule_id FROM unnest(d.failed_rules) AS rule_id
      UNION ALL
      SELECT NULL::text
       WHERE cardinality(d.failed_rules) = 0
          OR d.reason NOT IN ('CREDIT_ASSESSMENT:ACCOUNT_CONDUCT',
                              'CREDIT_ASSESSMENT:SERVICEABILITY')
    ) AS r ON true
    LEFT JOIN credit_rule AS cr ON cr.rule_id = r.rule_id
)
SELECT reason,
       category,
       count(DISTINCT conversation_id) AS declines,
       round(100.0 * count(DISTINCT conversation_id)
             / NULLIF((SELECT count(*) FROM declined), 0), 1) AS share_of_declines_pct,
       count(DISTINCT conversation_id) FILTER (WHERE retry_eligible) AS retry_eligible,
       (SELECT count(*) FROM declined) AS all_declines
  FROM detail
 WHERE $4::text = 'all' OR category = $4::text
 GROUP BY reason, category
 ORDER BY declines DESC, reason`

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All categories' },
  { value: 'capacity', label: 'Capacity' },
  { value: 'character', label: 'Character' },
  { value: 'identity', label: 'Identity' },
  { value: 'eligibility', label: 'Eligibility' },
  { value: 'other', label: 'Other' },
]

/** Why applications were declined, reason by reason and rule by rule. */
const declineReasons: ReportDefinitionSeed = {
  title: 'Decline reasons in detail',
  slug: 'decline-reasons',
  description:
    'Every reason applications were declined in the period (Sydney dates), ranked. A decline ' +
    'the credit assessment made is shown by each rule that failed, for example "Account ' +
    'conduct: Data quality gate G4, leakage ratio"; a block, an identity decline or a ' +
    'decision made before billieChat recorded the failed rules is shown by its reason code ' +
    'in words. An application that failed more than one rule counts under each, so the rows ' +
    'add up to more than the declines. Share is of all declines in the period and segment, ' +
    'whatever the category filter. Click a reason to see it week by week. Segment is an ' +
    'acquisition source or a credit ruleset version, as the decline rate report names them; ' +
    'leave it empty for all. Mock decisions are excluded.',
  sql: DECLINE_DETAIL_SQL,
  parameters: [
    { name: 'from', label: 'From', type: 'date', required: true, default: 'today-30' },
    { name: 'to', label: 'To', type: 'date', required: true, default: 'today-1' },
    {
      name: 'segment',
      label: 'Segment',
      type: 'text',
      required: false,
      help: 'An acquisition source (paid, organic, ...) or a ruleset version. Empty for all.',
    },
    {
      name: 'category',
      label: 'Category',
      type: 'select',
      required: true,
      default: 'all',
      options: CATEGORY_OPTIONS,
    },
  ],
  category: 'credit',
  featured: false,
  chart: {
    type: 'bar-horizontal',
    x: 'reason',
    series: [{ column: 'declines', label: 'Declines' }],
    drill: { report: 'decline-reasons-trend', parameter: 'reason' },
  },
  headline: [{ column: 'all_declines', label: 'Declined', value: 'first', better: 'lower' }],
  columnSettings: [
    {
      name: 'declines',
      description:
        'Declined applications with this reason. One that failed more than one rule counts under each rule.',
    },
    {
      name: 'share_of_declines_pct',
      label: 'Share of declines',
      base: 'all_declines',
      description:
        'Declines with this reason as a share of all declines in the period and segment, whatever the category filter.',
    },
    { name: 'retry_eligible', label: 'May retry' },
    {
      name: 'all_declines',
      label: 'All declines',
      description: 'Every decline in the period and segment: the denominator of the share.',
    },
  ],
  roles: ['admin', 'supervisor'],
  schedule: 'none',
}

/**
 * Decisions by ISO week, with the declines that match one reason (as the
 * detail report names it) beside all declines, and the category mix. Weeks
 * start on Monday; the first and last weeks may be partial.
 */
const DECLINE_TREND_SQL = `WITH weeks AS (
  SELECT w::date AS week
    FROM generate_series(date_trunc('week', $1::date), date_trunc('week', $2::date),
                         interval '1 week') AS w
),
decided AS (
  SELECT dec.conversation_id,
         date_trunc('week', dec.decided_on)::date AS week,
         dec.decision,
         r.reason,
         COALESCE(decline_category(r.reason), 'other') AS category,
         CASE WHEN r.reason LIKE 'CREDIT_ASSESSMENT:%'
              THEN COALESCE(a.account_conduct_failed_rules, '{}')
                   || COALESCE(a.serviceability_failed_rules, '{}')
              ELSE '{}'::text[] END AS failed_rules
    FROM decision AS dec
    JOIN application AS a USING (conversation_id)
    CROSS JOIN LATERAL (
      SELECT effective_decline_reason(dec.reason, a.account_conduct_decision,
               a.serviceability_decision, a.identity_risk_decision,
               a.post_identity_risk_decision) AS reason
    ) AS r
   WHERE dec.decided_on BETWEEN $1::date AND $2::date
     AND NOT dec.mock_origin
),
matching AS (
  SELECT DISTINCT d.conversation_id, d.week
    FROM decided AS d
    LEFT JOIN LATERAL (
      SELECT rule_id FROM unnest(d.failed_rules) AS rule_id
      UNION ALL
      SELECT NULL::text
       WHERE cardinality(d.failed_rules) = 0
          OR d.reason NOT IN ('CREDIT_ASSESSMENT:ACCOUNT_CONDUCT',
                              'CREDIT_ASSESSMENT:SERVICEABILITY')
    ) AS r ON true
   WHERE d.decision = 'DECLINED'
     AND ($3::text IS NULL OR decline_reason_label(d.reason, r.rule_id) = $3::text)
),
by_week AS (
  SELECT w.week,
         count(d.conversation_id) AS decided,
         count(*) FILTER (WHERE d.decision = 'DECLINED') AS declined,
         count(*) FILTER (WHERE d.decision = 'DECLINED' AND d.category = 'capacity') AS capacity,
         count(*) FILTER (WHERE d.decision = 'DECLINED' AND d.category = 'character') AS character,
         count(*) FILTER (WHERE d.decision = 'DECLINED' AND d.category = 'identity') AS identity,
         count(*) FILTER (WHERE d.decision = 'DECLINED' AND d.category = 'eligibility') AS eligibility,
         count(*) FILTER (WHERE d.decision = 'DECLINED' AND d.category = 'other') AS other,
         (SELECT count(*) FROM matching AS m WHERE m.week = w.week) AS matching
    FROM weeks AS w
    LEFT JOIN decided AS d ON d.week = w.week
   GROUP BY w.week
)
SELECT week,
       decided,
       declined,
       round(100.0 * declined / NULLIF(decided, 0), 1) AS decline_rate_pct,
       matching,
       round(100.0 * matching / NULLIF(declined, 0), 1) AS matching_share_pct,
       capacity, character, identity, eligibility, other
  FROM by_week
 ORDER BY week`

/** One reason over time: is it growing, and what share of declines is it? */
const declineReasonsTrend: ReportDefinitionSeed = {
  title: 'Decline reasons by week',
  slug: 'decline-reasons-trend',
  description:
    'Decisions by week (Monday to Sunday, Sydney dates): how many were declined, how many of ' +
    'those match one reason, and the mix of reason categories. Reason is a row name from ' +
    '"Decline reasons in detail", for example "Account conduct: Data quality gate G4, leakage ' +
    'ratio"; leave it empty to see all declines. The first and last weeks cover only the days ' +
    'inside the period. Mock decisions are excluded.',
  sql: DECLINE_TREND_SQL,
  parameters: [
    { name: 'from', label: 'From', type: 'date', required: true, default: 'today-91' },
    { name: 'to', label: 'To', type: 'date', required: true, default: 'today-1' },
    {
      name: 'reason',
      label: 'Reason',
      type: 'text',
      required: false,
      help: 'A reason as "Decline reasons in detail" names it. Empty for all declines.',
    },
  ],
  category: 'credit',
  featured: false,
  chart: [
    {
      type: 'line',
      x: 'week',
      series: [
        { column: 'matching', label: 'With this reason' },
        { column: 'declined', label: 'All declines' },
      ],
      rollingAverage: 0,
    },
    {
      type: 'bar',
      x: 'week',
      stacked: true,
      series: [
        { column: 'capacity', label: 'Capacity' },
        { column: 'character', label: 'Character' },
        { column: 'identity', label: 'Identity' },
        { column: 'eligibility', label: 'Eligibility' },
        { column: 'other', label: 'Other' },
      ],
    },
  ],
  headline: [
    { column: 'matching', label: 'With this reason', value: 'sum', better: 'lower' },
    { column: 'declined', label: 'Declined', value: 'sum', better: 'lower' },
    {
      column: 'decline_rate_pct',
      label: 'Decline rate',
      value: 'ratio',
      numerator: 'declined',
      denominator: 'decided',
      better: 'lower',
    },
  ],
  columnSettings: [
    { name: 'decided', description: 'Applications with a final credit decision in the week.' },
    {
      name: 'decline_rate_pct',
      label: 'Decline rate',
      base: 'decided',
      better: 'lower',
      description: 'Declined as a share of decided.',
    },
    {
      name: 'matching',
      label: 'With this reason',
      description: 'Declines whose reason matches the filter; all declines when none is chosen.',
    },
    {
      name: 'matching_share_pct',
      label: 'Share of declines',
      base: 'declined',
      description: 'Declines with this reason as a share of the week’s declines.',
    },
  ],
  roles: ['admin', 'supervisor'],
  schedule: 'none',
}

/** The decline drill-down reports, created by the `decline_reasons` migration. */
export const DECLINE_DETAIL_REPORTS: readonly ReportDefinitionSeed[] = [
  declineReasons,
  declineReasonsTrend,
]

const LAST_30_DAYS: ReportParameter[] = [
  { name: 'from', label: 'From', type: 'date', required: true, default: 'today-30' },
  { name: 'to', label: 'To', type: 'date', required: true, default: 'today-1' },
]

/** Applications started per Sydney day: the volume headline on the Reports home. */
const dailyApplications: ReportDefinitionSeed = {
  title: 'Daily applications',
  slug: 'daily-applications',
  description:
    'Applications started each Sydney day, and how many of them were approved and funded so ' +
    'far. Recent days keep filling in as applications are decided. Mock decisions are excluded.',
  category: 'acquisition',
  featured: true,
  sql: `SELECT a.started_on AS day,
       count(*) AS applications,
       count(*) FILTER (WHERE a.approved) AS approved,
       count(*) FILTER (WHERE a.funded) AS funded
  FROM application AS a
  LEFT JOIN decision AS d USING (conversation_id)
 WHERE a.started_on BETWEEN $1::date AND $2::date
   AND d.mock_origin IS NOT TRUE
 GROUP BY a.started_on
 ORDER BY a.started_on`,
  parameters: LAST_30_DAYS,
  chart: {
    type: 'line',
    x: 'day',
    series: [
      { column: 'applications', label: 'Applications' },
      { column: 'approved', label: 'Approved' },
    ],
  },
  headline: [
    { column: 'applications', label: 'Applications', value: 'sum', better: 'higher' },
    { column: 'funded', label: 'Funded', value: 'sum', better: 'higher' },
  ],
  columnSettings: [],
  roles: ['admin', 'supervisor', 'operations', 'readonly'],
  schedule: 'none',
}

/** The approval rate week by week: the credit headline on the Reports home. */
const approvalRate: ReportDefinitionSeed = {
  title: 'Approval rate by week',
  slug: 'approval-rate',
  description:
    'Final credit decisions made each week (weeks start Monday, Sydney dates) and the share ' +
    'approved. Referred applications count as decided and not approved. Mock decisions are ' +
    'excluded.',
  category: 'credit',
  featured: true,
  sql: `SELECT date_trunc('week', d.decided_on)::date AS week,
       count(*) AS decided,
       count(*) FILTER (WHERE d.decision = 'APPROVED') AS approved,
       round(count(*) FILTER (WHERE d.decision = 'APPROVED')::numeric
             / NULLIF(count(*), 0), 3) AS approval_rate
  FROM decision AS d
 WHERE d.decided_on BETWEEN $1::date AND $2::date
   AND NOT d.mock_origin
 GROUP BY 1
 ORDER BY 1`,
  parameters: [
    { name: 'from', label: 'From', type: 'date', required: true, default: 'today-84' },
    { name: 'to', label: 'To', type: 'date', required: true, default: 'today-1' },
  ],
  chart: {
    type: 'line',
    x: 'week',
    series: [{ column: 'approval_rate', label: 'Approval rate' }],
  },
  headline: [
    {
      column: 'approval_rate',
      label: 'Approval rate',
      value: 'ratio',
      numerator: 'approved',
      denominator: 'decided',
      better: 'higher',
    },
    { column: 'decided', label: 'Decisions', value: 'sum' },
  ],
  columnSettings: [
    {
      name: 'approval_rate',
      base: 'decided',
      better: 'higher',
      description: 'Approved as a share of decided.',
    },
  ],
  roles: ['admin', 'supervisor', 'operations', 'readonly'],
  schedule: 'none',
}

/** Money out each day: the lending headline on the Reports home. */
const fundedLoans: ReportDefinitionSeed = {
  title: 'Loans funded',
  slug: 'loans-funded',
  description:
    'Loans disbursed each Sydney day: how many and the amount lent (principal, before fees). ' +
    'Loans from mock decisions are excluded.',
  category: 'loan_book',
  featured: true,
  sql: `SELECT l.disbursed_on AS day,
       count(*) AS loans,
       sum(l.loan_amount) AS amount_funded
  FROM loan AS l
  LEFT JOIN decision AS d ON d.conversation_id = l.conversation_id
 WHERE l.disbursed_on BETWEEN $1::date AND $2::date
   AND d.mock_origin IS NOT TRUE
 GROUP BY l.disbursed_on
 ORDER BY l.disbursed_on`,
  parameters: LAST_30_DAYS,
  chart: {
    type: 'bar',
    x: 'day',
    series: [{ column: 'amount_funded', label: 'Amount funded' }],
  },
  headline: [
    { column: 'amount_funded', label: 'Amount funded', value: 'sum', better: 'higher' },
    { column: 'loans', label: 'Loans funded', value: 'sum', better: 'higher' },
  ],
  columnSettings: [],
  roles: ['admin', 'supervisor', 'operations', 'readonly'],
  schedule: 'none',
}

/** What is overdue now, by how far: the arrears headline on the Reports home. */
const arrearsBalance: ReportDefinitionSeed = {
  title: 'Arrears balance',
  slug: 'arrears-balance',
  description:
    'Loans in arrears now, by aging bucket: how many and what they owe in total. A snapshot ' +
    'of today, so it has no period. Loans from mock decisions are excluded.',
  category: 'arrears',
  featured: true,
  sql: `WITH overdue AS (
  SELECT COALESCE(l.aging_bucket, 'unknown') AS bucket, l.total_outstanding
    FROM loan AS l
    LEFT JOIN decision AS d ON d.conversation_id = l.conversation_id
   WHERE l.in_arrears
     AND d.mock_origin IS NOT TRUE
)
SELECT CASE WHEN GROUPING(bucket) = 1 THEN 'All' ELSE bucket END AS bucket,
       count(*) AS loans,
       sum(total_outstanding) AS outstanding
  FROM overdue
 GROUP BY GROUPING SETS ((bucket), ())
 ORDER BY GROUPING(bucket), bucket`,
  parameters: [],
  chart: {
    type: 'bar',
    x: 'bucket',
    sort: 'none',
    series: [{ column: 'outstanding', label: 'Outstanding' }],
  },
  headline: [
    { column: 'outstanding', label: 'In arrears', value: 'total', better: 'lower' },
    { column: 'loans', label: 'Loans in arrears', value: 'total', better: 'lower' },
  ],
  columnSettings: [],
  roles: ['admin', 'supervisor', 'operations', 'readonly'],
  schedule: 'none',
}

/** The reports behind the headline numbers on the Reports home. */
export const CORE_REPORTS: readonly ReportDefinitionSeed[] = [
  dailyApplications,
  approvalRate,
  fundedLoans,
  arrearsBalance,
]

/** Create and publish each first report whose slug is free (BTB-507). */
export function createFirstReports(payload: Payload, req?: PayloadRequest): Promise<string[]> {
  return createReports(payload, FIRST_REPORTS, req)
}

/**
 * Create and publish each report whose slug is free.
 *
 * @returns the slugs created.
 */
export async function createReports(
  payload: Payload,
  seeds: readonly ReportDefinitionSeed[],
  req?: PayloadRequest,
): Promise<string[]> {
  const created: string[] = []
  for (const seed of seeds) {
    const existing = await payload.find({
      collection: 'report-definitions',
      where: { slug: { equals: seed.slug } },
      draft: true,
      limit: 1,
      depth: 0,
      overrideAccess: true,
      req,
    })
    if (existing.docs.length > 0) continue
    await payload.create({
      collection: 'report-definitions',
      data: { ...seed, _status: 'published' } as never,
      overrideAccess: true,
      req,
    })
    created.push(seed.slug)
  }
  return created
}

/** The first reports' charts as first seeded, before they had presentation settings. */
const ORIGINAL_CHARTS: Record<string, unknown> = {
  'decline-rate': {
    type: 'bar',
    x: 'segment',
    stacked: true,
    series: [
      { column: 'capacity', label: 'Capacity' },
      { column: 'character', label: 'Character' },
      { column: 'identity', label: 'Identity' },
      { column: 'eligibility', label: 'Eligibility' },
      { column: 'other', label: 'Other' },
    ],
  },
  'application-funnel': funnel.chart,
  'gtm-numbers': null,
}

const isEmptyList = (value: unknown) =>
  value === null || value === undefined || (Array.isArray(value) && value.length === 0)

/**
 * Give the first reports the presentation they now ship with (category,
 * charts, headline, column settings), only where each is exactly as first
 * seeded: same SQL and chart, no category, headline or column settings, and
 * no unpublished draft (an update would publish it). A report an author has
 * touched keeps everything of its own.
 *
 * @returns the slugs updated.
 */
export async function upgradeFirstReports(
  payload: Payload,
  req?: PayloadRequest,
): Promise<string[]> {
  const updated: string[] = []
  for (const seed of FIRST_REPORTS) {
    // With draft: true the newest version comes back, draft or published.
    const latest = await payload.find({
      collection: 'report-definitions',
      where: { slug: { equals: seed.slug } },
      draft: true,
      limit: 1,
      depth: 0,
      overrideAccess: true,
      req,
    })
    const doc = latest.docs[0] as
      | {
          id: string
          _status?: string | null
          sql?: string
          chart?: unknown
          category?: string | null
          headline?: unknown
          columnSettings?: unknown
        }
      | undefined
    if (
      !doc ||
      doc._status !== 'published' ||
      doc.sql !== seed.sql ||
      (doc.category && doc.category !== 'other') ||
      !isEmptyList(doc.headline) ||
      !isEmptyList(doc.columnSettings) ||
      !sameJson(doc.chart ?? null, ORIGINAL_CHARTS[seed.slug] ?? null)
    ) {
      continue
    }
    await payload.update({
      collection: 'report-definitions',
      id: doc.id,
      data: {
        category: seed.category,
        featured: seed.featured,
        chart: seed.chart,
        headline: seed.headline,
        columnSettings: seed.columnSettings,
        _status: 'published',
      } as never,
      overrideAccess: true,
      req,
    })
    updated.push(seed.slug)
  }
  return updated
}

/**
 * Give the decline rate report its drill-down into "Decline reasons in
 * detail" and the `effective_decline_reason` category for older declines,
 * only where its SQL and chart are exactly as first seeded and it has no
 * unpublished draft. A report an author has changed keeps its own.
 *
 * @returns the slugs updated.
 */
export async function upgradeDeclineRateDrill(
  payload: Payload,
  req?: PayloadRequest,
): Promise<string[]> {
  const seed = declineRate
  const latest = await payload.find({
    collection: 'report-definitions',
    where: { slug: { equals: seed.slug } },
    draft: true,
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const doc = latest.docs[0] as
    | { id: string; _status?: string | null; sql?: string; chart?: unknown }
    | undefined
  if (
    !doc ||
    doc._status !== 'published' ||
    doc.sql !== DECLINE_RATE_SQL_BEFORE_DRILL ||
    !sameJson(doc.chart ?? null, DECLINE_RATE_CHART_BEFORE_DRILL)
  ) {
    return []
  }
  await payload.update({
    collection: 'report-definitions',
    id: doc.id,
    data: {
      sql: seed.sql,
      chart: seed.chart,
      description: seed.description,
      _status: 'published',
    } as never,
    overrideAccess: true,
    req,
  })
  return [seed.slug]
}
