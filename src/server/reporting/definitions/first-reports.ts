/**
 * The first three reports (BTB-507), as data.
 *
 * The `20261025_090000_first_reports` migration creates them in each
 * environment if their slug is free. After that they are ordinary report
 * definitions: authors change them in the admin, and this file is not read
 * again. The integration test runs each one against TEST data.
 */
import type { Payload, PayloadRequest } from 'payload'
import type { ReportParameter } from '@/lib/schemas/reports'

export interface ReportDefinitionSeed {
  title: string
  slug: string
  description: string
  sql: string
  parameters: ReportParameter[]
  chart: unknown
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
    'ruleset version, with declines by reason category and an "All" total. Declines with no ' +
    'recorded reason count as "other". Mock decisions are excluded. Decisions made before ' +
    'ruleset versions were recorded show as "(not recorded)"; applications from before ' +
    'attribution capture (6 October 2026) show as "not recorded".',
  sql: `WITH d AS (
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
  chart: {
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
  chart: null,
  roles: ['admin', 'supervisor'],
  schedule: 'none',
}

export const FIRST_REPORTS: readonly ReportDefinitionSeed[] = [declineRate, funnel, gtm]

/**
 * Create and publish each first report whose slug is free.
 *
 * @returns the slugs created.
 */
export async function createFirstReports(
  payload: Payload,
  req?: PayloadRequest,
): Promise<string[]> {
  const created: string[] = []
  for (const seed of FIRST_REPORTS) {
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
