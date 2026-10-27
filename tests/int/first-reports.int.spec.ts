/**
 * Integration coverage for the first reports and the Monday email (BTB-507).
 *
 * Built and checked with clearly marked TEST data only (BTB-462): every row
 * here is prefixed TEST-BTB507 and dated early 2001, far from real data.
 * Creates the reports exactly as the 20261025 migration does, runs each as
 * reporting_reader, and checks the numbers against hand-computed
 * expectations. Email is captured, never sent.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import {
  CORE_REPORTS,
  createFirstReports,
  createReports,
  DECLINE_DETAIL_REPORTS,
  DECLINE_RATE_CHART_BEFORE_DRILL,
  DECLINE_RATE_SQL_BEFORE_DRILL,
  FIRST_REPORTS,
  upgradeDeclineRateDrill,
  upgradeFirstReports,
} from '@/server/reporting/definitions/first-reports'
import { resetDataAsAtCache, runReport } from '@/server/reporting/run-report'
import { deliverScheduledReports } from '@/server/reporting/scheduled'
import { reportingReaderPool } from '../utils/reportingReader'

const sendStaffEmail = vi.fn()
vi.mock('@/server/email/staff-email', () => ({
  sendStaffEmail: (...args: unknown[]) => sendStaffEmail(...args),
  staffEmailConfigured: () => true,
}))

let payload: Payload
let pool: Pool
let reader: Pool
const P = 'TEST-BTB507'
const RANGE = { from: '2001-03-01', to: '2001-03-31' }
const MARCH_5 = '2001-03-05T01:00:00Z' // 12:00 Sydney
let admin: { id: string; role: string }
const SEEDED = [...FIRST_REPORTS, ...CORE_REPORTS, ...DECLINE_DETAIL_REPORTS]
// The decline detail fixtures sit in April, so the March expectations above
// never see them.
const APRIL = { from: '2001-04-01', to: '2001-04-30' }
const APRIL_1 = '2001-04-01T01:00:00Z'
let supervisorEmail: string

async function cleanup() {
  await pool.query(`DELETE FROM reporting.decision_event WHERE conversation_id LIKE '${P}%'`)
  await pool.query(`DELETE FROM loan_accounts WHERE loan_account_id LIKE '${P}%'`)
  await pool.query(`DELETE FROM conversations WHERE conversation_id LIKE '${P}%'`)
  await pool.query(
    `DELETE FROM report_runs WHERE report_slug IN (${SEEDED.map((r) => `'${r.slug}'`).join(',')})`,
  )
  await payload.delete({
    collection: 'report-definitions',
    where: { slug: { in: SEEDED.map((r) => r.slug) } },
    overrideAccess: true,
  })
  await pool.query(`DELETE FROM users WHERE email LIKE 'test-btb507-%'`)
}

async function conversation(
  suffix: string,
  opts: {
    attribution?: Record<string, string> | null
    decisionStatus?: string | null
    reason?: string | null
    ruleset?: string | null
    statementComplete?: boolean
    appNumber?: string
    startedAt?: string
  },
) {
  await pool.query(
    `INSERT INTO conversations
       (conversation_id, application_number, status, started_at, attribution, decision_status,
        decision_detail_reason, decision_detail_ruleset_version, statement_capture, version)
     VALUES ($1, $2, 'active', $3, $4::jsonb, $5, $6, $7, $8::jsonb, 1)`,
    [
      `${P}-${suffix}`,
      opts.appNumber ?? '',
      opts.startedAt ?? MARCH_5,
      opts.attribution ? JSON.stringify(opts.attribution) : null,
      opts.decisionStatus ?? null,
      opts.reason ?? null,
      opts.ruleset ?? null,
      opts.statementComplete ? JSON.stringify({ consentStatus: 'complete' }) : null,
    ],
  )
}

async function decided(
  suffix: string,
  decision: string,
  reason: string | null,
  ruleset: string,
  mock = false,
  decidedAt = '2001-03-05T03:00:00Z',
) {
  await pool.query(
    `INSERT INTO reporting.decision_event
       (decision_key, conversation_id, decision, reason, ruleset_version, mock_origin, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [`${P}-${suffix}-key`, `${P}-${suffix}`, decision, reason, ruleset, mock, decidedAt],
  )
}

/** What billieChat's assessment and decision events leave on the conversation. */
async function assessed(
  suffix: string,
  opts: { conduct?: string[]; serviceability?: string[]; components?: string[] },
) {
  const result = (rules: string[] | undefined) =>
    rules
      ? JSON.stringify({ decision: 'DECLINED', failed_rules: rules, file_location: 's3://x' })
      : null
  await pool.query(
    `UPDATE conversations
        SET assessments_account_conduct = $2::jsonb,
            assessments_serviceability = $3::jsonb,
            decision_metadata = $4::jsonb
      WHERE conversation_id = $1`,
    [
      `${P}-${suffix}`,
      result(opts.conduct),
      result(opts.serviceability),
      opts.components ? JSON.stringify({ declined_components: opts.components }) : null,
    ],
  )
}

/**
 * April: declines with the rules behind them. D1 and D2 failed the G4
 * leakage gate (D1 also dishonours; D2 also serviceability, in both
 * components); D3 failed serviceability on a known and an unknown rule; D4
 * is a block whose earlier assessment also failed a rule, which a block
 * decline never shows; D5 is an account conduct decline from before the
 * rules were recorded; D6 is approved; D7 is a mock decline.
 */
async function aprilDeclines() {
  const paid = { utm_source: 'google', utm_medium: 'cpc' }
  const organic = { utm_source: 'google', utm_medium: 'organic' }
  const conduct = 'CREDIT_ASSESSMENT:ACCOUNT_CONDUCT'
  const serviceability = 'CREDIT_ASSESSMENT:SERVICEABILITY'
  const at = (day: string) => `2001-04-${day}T03:00:00Z` // 13:00 Sydney
  const G4 = 'ACCOUNT_CONDUCT_RULE_006'
  const DISHONOURS = 'ACCOUNT_CONDUCT_RULE_004'
  const SURPLUS = 'SERVICEABILITY_RULE_001'

  const declines: Array<[string, Record<string, string>, string, string, string]> = [
    ['D1', paid, conduct, 'r2', at('03')],
    ['D2', paid, conduct, 'r2', at('10')],
    ['D3', organic, serviceability, 'r2', at('10')],
    ['D4', organic, 'REAPPLICATION_BLOCK:linked_open_review', 'r2', at('11')],
    ['D5', paid, conduct, 'r1', at('17')],
  ]
  for (const [suffix, attribution, reason, ruleset, decidedAt] of declines) {
    await conversation(suffix, {
      attribution,
      decisionStatus: 'declined',
      reason,
      ruleset,
      startedAt: APRIL_1,
    })
    await decided(suffix, 'DECLINED', reason, ruleset, false, decidedAt)
  }
  await assessed('D1', { conduct: [G4, DISHONOURS], components: ['account_conduct'] })
  await assessed('D2', {
    conduct: [G4],
    serviceability: [SURPLUS],
    components: ['account_conduct', 'serviceability'],
  })
  await assessed('D3', {
    serviceability: [SURPLUS, 'SERVICEABILITY_RULE_999'],
    components: ['serviceability'],
  })
  await assessed('D4', { conduct: [DISHONOURS] })
  await conversation('D6', {
    attribution: paid,
    decisionStatus: 'approved',
    ruleset: 'r2',
    startedAt: APRIL_1,
  })
  await decided('D6', 'APPROVED', null, 'r2', false, at('17'))
  await conversation('D7', { decisionStatus: 'declined', reason: conduct, startedAt: APRIL_1 })
  await decided('D7', 'DECLINED', conduct, 'r2', true, at('17'))
  await assessed('D7', { conduct: [G4] })
  // D8: declined before reasons were recorded (reason NULL), but the account
  // conduct result says DECLINED and, once back-filled, names G4.
  await conversation('D8', {
    attribution: paid,
    decisionStatus: 'declined',
    ruleset: 'r2',
    startedAt: APRIL_1,
  })
  await decided('D8', 'DECLINED', null, 'r2', false, at('24'))
  await assessed('D8', { conduct: [G4] })
}

async function loan(suffix: string, appNumber: string, disbursedAt: string) {
  await pool.query(
    `INSERT INTO loan_accounts
       (loan_account_id, account_number, account_status, loan_terms_loan_amount,
        loan_terms_disbursed_date, application_number)
     VALUES ($1, $2, 'active', 300, $3, $4)`,
    [`${P}-${suffix}`, `ACC-${P}-${suffix}`, disbursedAt, appNumber],
  )
}

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as unknown as Pool
  reader = await reportingReaderPool(pool)
  await cleanup()

  const paid = { utm_source: 'google', utm_medium: 'cpc' }
  // C1: paid, approved and funded 26 hours after starting.
  await conversation('C1', {
    attribution: paid,
    decisionStatus: 'approved',
    ruleset: 'r1',
    appNumber: `${P}-APP1`,
  })
  await decided('C1', 'APPROVED', null, 'r1')
  await loan('L1', `${P}-APP1`, '2001-03-06T03:00:00Z')
  // C2: paid, declined for capacity under r1.
  await conversation('C2', {
    attribution: paid,
    decisionStatus: 'declined',
    reason: 'CREDIT_ASSESSMENT:SERVICEABILITY',
    ruleset: 'r1',
  })
  await decided('C2', 'DECLINED', 'CREDIT_ASSESSMENT:SERVICEABILITY', 'r1')
  // C3: referring website, declined for eligibility under r2.
  await conversation('C3', {
    attribution: { utm_source: 'friend', utm_medium: 'referral' },
    decisionStatus: 'declined',
    reason: 'BUSINESS_ACCOUNT',
    ruleset: 'r2',
  })
  await decided('C3', 'DECLINED', 'BUSINESS_ACCOUNT', 'r2')
  // C4: no attribution, before capture began: "not recorded", not "direct".
  await conversation('C4', {})
  // C5: a mock approval with a loan, excluded everywhere, health included.
  await conversation('C5', { decisionStatus: 'approved', appNumber: `${P}-APP5` })
  await decided('C5', 'APPROVED', null, 'r1', true)
  await loan('L5', `${P}-APP5`, '2001-03-06T03:00:00Z')
  // C6: paid, statements shared, not yet decided.
  await conversation('C6', { attribution: paid, statementComplete: true })
  // C7: organic, declined with no recorded reason: counted as "other".
  await conversation('C7', {
    attribution: { utm_source: 'google', utm_medium: 'organic' },
    decisionStatus: 'declined',
  })
  await decided('C7', 'DECLINED', null, 'r2')
  // C8: an ad click with no UTM tags: paid, labelled "(paid)".
  await conversation('C8', { attribution: { gclid: 'test-click' } })
  // C9: email, started in February, funded in March: health without starts.
  await conversation('C9', {
    attribution: { utm_source: 'newsletter', utm_medium: 'email' },
    decisionStatus: 'approved',
    appNumber: `${P}-APP9`,
    startedAt: '2001-02-20T01:00:00Z',
  })
  await loan('L9', `${P}-APP9`, '2001-03-02T03:00:00Z')

  await aprilDeclines()

  await createFirstReports(payload)
  await createReports(payload, CORE_REPORTS)
  await createReports(payload, DECLINE_DETAIL_REPORTS)
  const a = await payload.create({
    collection: 'users',
    data: {
      email: `test-btb507-admin-${Date.now()}@billie.loans`,
      password: 'Test1234!',
      role: 'admin',
      firstName: 'Test',
      lastName: 'Admin',
    },
  })
  admin = { id: String(a.id), role: 'admin' }
  supervisorEmail = `test-btb507-supervisor-${Date.now()}@billie.loans`
  await payload.create({
    collection: 'users',
    data: {
      email: supervisorEmail,
      password: 'Test1234!',
      role: 'supervisor',
      firstName: 'Test',
      lastName: 'Supervisor',
    },
  })
}, 60_000)

afterAll(async () => {
  await cleanup()
  await reader?.end()
})

async function rows(slug: string, parameters: Record<string, unknown>) {
  const outcome = await runReport(payload, admin, slug, { parameters }, { pool: reader })
  if (outcome.status !== 200) throw new Error(JSON.stringify(outcome.body))
  return outcome.body.rows
}

const zero = { capacity: 0, character: 0, identity: 0, eligibility: 0, other: 0 }

describe('first reports', () => {
  it('are created once, published, and left alone when they exist', async () => {
    expect(await createFirstReports(payload)).toEqual([])
    const docs = await payload.find({
      collection: 'report-definitions',
      where: { slug: { in: FIRST_REPORTS.map((r) => r.slug) } },
      overrideAccess: true,
    })
    expect(docs.docs.map((d) => d._status)).toEqual(['published', 'published', 'published'])
  })

  it('decline rate by source, with no-reason declines as "other" and a total', async () => {
    expect(await rows('decline-rate', { ...RANGE, group_by: 'source' })).toEqual([
      { segment: 'paid', decided: 2, declined: 1, decline_rate_pct: 50, ...zero, capacity: 1 },
      { segment: 'organic', decided: 1, declined: 1, decline_rate_pct: 100, ...zero, other: 1 },
      {
        segment: 'referral',
        decided: 1,
        declined: 1,
        decline_rate_pct: 100,
        ...zero,
        eligibility: 1,
      },
      {
        segment: 'All',
        decided: 4,
        declined: 3,
        decline_rate_pct: 75,
        ...zero,
        capacity: 1,
        eligibility: 1,
        other: 1,
      },
    ])
  })

  it('decline rate by ruleset version', async () => {
    const result = await rows('decline-rate', { ...RANGE, group_by: 'ruleset' })
    expect(result.map((r) => [r.segment, r.decided, r.declined])).toEqual([
      ['r1', 2, 1],
      ['r2', 2, 2],
      ['All', 4, 3],
    ])
  })

  it('drills from the decline rate reasons chart into the detail report', async () => {
    const doc = (
      await payload.find({
        collection: 'report-definitions',
        where: { slug: { equals: 'decline-rate' } },
        limit: 1,
        overrideAccess: true,
      })
    ).docs[0]
    const charts = doc.chart as Array<{ type: string; drill?: unknown }>
    expect(charts[1]).toMatchObject({
      type: 'stacked-100',
      drill: { report: 'decline-reasons', parameter: 'segment' },
    })
  })
})

describe('decline reasons in detail', () => {
  const G4 = 'Account conduct: Data quality gate G4, leakage ratio'
  const SURPLUS = 'Serviceability: Net income surplus negative'
  const byReason = (list: Array<Record<string, unknown>>) =>
    [...list].sort((a, b) => String(a.reason).localeCompare(String(b.reason)))

  it('ranks every reason, rule by rule, with the share of all declines', async () => {
    const result = await rows('decline-reasons', { ...APRIL, category: 'all' })
    // Six declines (the mock one excluded); the rows add up to more.
    expect(result.every((r) => r.all_declines === 6)).toBe(true)
    expect(result.slice(0, 2)).toEqual([
      {
        reason: G4,
        category: 'character',
        declines: 3,
        share_of_declines_pct: 50,
        retry_eligible: 0,
        all_declines: 6,
      },
      {
        reason: SURPLUS,
        category: 'capacity',
        declines: 2,
        share_of_declines_pct: 33.3,
        retry_eligible: 0,
        all_declines: 6,
      },
    ])
    expect(byReason(result.slice(2)).map((r) => [r.reason, r.category, r.declines])).toEqual(
      byReason([
        { reason: 'Account conduct (rule not recorded)', category: 'character', declines: 1 },
        { reason: 'Account conduct: Financial dishonours', category: 'character', declines: 1 },
        {
          reason: 'Re-application block: linked open review',
          category: 'eligibility',
          declines: 1,
        },
        // An unlisted rule shows by its id, in the category of the decline.
        { reason: 'SERVICEABILITY_RULE_999', category: 'capacity', declines: 1 },
      ]).map((r) => [r.reason, r.category, r.declines]),
    )
  })

  it('filters by segment, as the drill-down passes it, and "All" means everything', async () => {
    const paid = await rows('decline-reasons', { ...APRIL, segment: 'paid', category: 'all' })
    expect(paid.map((r) => [r.reason, r.declines, r.share_of_declines_pct])).toEqual([
      [G4, 3, 75],
      ['Account conduct (rule not recorded)', 1, 25],
      ['Account conduct: Financial dishonours', 1, 25],
      [SURPLUS, 1, 25],
    ])
    const r1 = await rows('decline-reasons', { ...APRIL, segment: 'r1', category: 'all' })
    expect(r1.map((r) => [r.reason, r.declines])).toEqual([
      ['Account conduct (rule not recorded)', 1],
    ])
    const all = await rows('decline-reasons', { ...APRIL, segment: 'All', category: 'all' })
    expect(all.length).toBe(6)
  })

  it('keeps the share of all declines when a category is chosen', async () => {
    const capacity = await rows('decline-reasons', { ...APRIL, category: 'capacity' })
    expect(capacity.map((r) => [r.reason, r.declines, r.share_of_declines_pct])).toEqual([
      [SURPLUS, 2, 33.3],
      ['SERVICEABILITY_RULE_999', 1, 16.7],
    ])
  })

  it('shows decisions by week, and one reason against all declines', async () => {
    const week = (r: Record<string, unknown>) => String(r.week).slice(0, 10)
    const all = await rows('decline-reasons-trend', APRIL)
    expect(
      all.map((r) => [week(r), r.decided, r.declined, r.decline_rate_pct, r.matching]),
    ).toEqual([
      ['2001-03-26', 0, 0, null, 0],
      ['2001-04-02', 1, 1, 100, 1],
      ['2001-04-09', 3, 3, 100, 3],
      ['2001-04-16', 2, 1, 50, 1],
      ['2001-04-23', 1, 1, 100, 1],
      ['2001-04-30', 0, 0, null, 0],
    ])
    expect(all[2]).toMatchObject({
      capacity: 1,
      character: 1,
      identity: 0,
      eligibility: 1,
      other: 0,
      matching_share_pct: 100,
    })

    const g4 = await rows('decline-reasons-trend', { ...APRIL, reason: G4 })
    expect(g4.map((r) => [week(r), r.declined, r.matching, r.matching_share_pct])).toEqual([
      ['2001-03-26', 0, 0, null],
      ['2001-04-02', 1, 1, 100],
      ['2001-04-09', 3, 1, 33.3],
      ['2001-04-16', 1, 0, 0],
      ['2001-04-23', 1, 1, 100],
      ['2001-04-30', 0, 0, null],
    ])
  })

  it('adds the drill-down to a decline rate report an author has not changed', async () => {
    const find = async () =>
      (
        await payload.find({
          collection: 'report-definitions',
          where: { slug: { equals: 'decline-rate' } },
          limit: 1,
          overrideAccess: true,
        })
      ).docs[0]
    const before = await find()
    await payload.update({
      collection: 'report-definitions',
      id: before.id,
      data: {
        sql: DECLINE_RATE_SQL_BEFORE_DRILL,
        chart: DECLINE_RATE_CHART_BEFORE_DRILL as never,
        _status: 'published',
      },
      overrideAccess: true,
    })
    expect(await upgradeDeclineRateDrill(payload)).toEqual(['decline-rate'])
    const after = await find()
    const charts = after.chart as Array<{ drill?: unknown }>
    expect(charts[1].drill).toEqual({ report: 'decline-reasons', parameter: 'segment' })
    expect(after.sql).toBe(FIRST_REPORTS[0].sql)
    // Already upgraded: nothing to do.
    expect(await upgradeDeclineRateDrill(payload)).toEqual([])
  })

  it('application funnel by source and medium', async () => {
    expect(await rows('application-funnel', RANGE)).toEqual([
      {
        source_medium: 'google / cpc',
        acquisition: 'paid',
        started: 3,
        submitted: 3,
        decided: 2,
        approved: 1,
        funded: 1,
      },
      {
        source_medium: '(not recorded) / (none)',
        acquisition: 'not recorded',
        started: 1,
        submitted: 0,
        decided: 0,
        approved: 0,
        funded: 0,
      },
      {
        source_medium: '(paid) / (none)',
        acquisition: 'paid',
        started: 1,
        submitted: 0,
        decided: 0,
        approved: 0,
        funded: 0,
      },
      {
        source_medium: 'friend / referral',
        acquisition: 'referral',
        started: 1,
        submitted: 1,
        decided: 1,
        approved: 0,
        funded: 0,
      },
      {
        source_medium: 'google / organic',
        acquisition: 'organic',
        started: 1,
        submitted: 1,
        decided: 1,
        approved: 0,
        funded: 0,
      },
    ])
  })

  it('go-to-market numbers, excluding mock loans and keeping health without starts', async () => {
    const result = await rows('gtm-numbers', RANGE)
    expect(result.map((r) => r.source)).toEqual([
      'paid',
      'not recorded',
      'organic',
      'referral',
      'email',
      'All sources',
    ])
    expect(result[0]).toEqual({
      source: 'paid',
      starts: 4,
      share_of_starts_pct: 57.1,
      decided: 2,
      approved: 1,
      pass_rate_pct: 50,
      funded: 1,
      funded_rate_pct: 25,
      median_hours_to_money: 26,
      loans_disbursed: 1,
      loans_in_arrears: 0,
      arrears_rate_pct: 0,
    })
    expect(result[4]).toMatchObject({ source: 'email', starts: 0, loans_disbursed: 1 })
    expect(result[5]).toMatchObject({
      source: 'All sources',
      starts: 7,
      share_of_starts_pct: 100,
      decided: 4,
      approved: 1,
      pass_rate_pct: 25,
      funded: 1,
      funded_rate_pct: 14.3,
      median_hours_to_money: 26,
      // L1 and L9; the mock approval's loan L5 is excluded.
      loans_disbursed: 2,
    })
  })
})

describe('core reports', () => {
  it('daily applications: started, approved and funded per Sydney day, mock excluded', async () => {
    expect(await rows('daily-applications', RANGE)).toEqual([
      { day: '2001-03-05', applications: 7, approved: 1, funded: 1 },
    ])
  })

  it('approval rate by week: approved of decided, mock excluded', async () => {
    expect(await rows('approval-rate', RANGE)).toEqual([
      { week: '2001-03-05', decided: 4, approved: 1, approval_rate: 0.25 },
    ])
  })

  it('loans funded: count and amount per day, mock loans excluded', async () => {
    expect(await rows('loans-funded', RANGE)).toEqual([
      { day: '2001-03-02', loans: 1, amount_funded: 300 },
      { day: '2001-03-06', loans: 1, amount_funded: 300 },
    ])
  })

  it('arrears balance: runs with no period and always has its total row', async () => {
    const result = await rows('arrears-balance', {})
    expect(result.at(-1)?.bucket).toBe('All')
  })

  it('are featured with headline numbers, and created once', async () => {
    expect(await createReports(payload, CORE_REPORTS)).toEqual([])
    const docs = await payload.find({
      collection: 'report-definitions',
      where: { slug: { in: CORE_REPORTS.map((r) => r.slug) } },
      overrideAccess: true,
    })
    for (const doc of docs.docs) {
      expect(doc.featured).toBe(true)
      expect((doc.headline as unknown[]).length).toBeGreaterThan(0)
    }
  })
})

describe('comparing with the previous period', () => {
  it('runs the period just before (a month for a whole month), and says how fresh the data is', async () => {
    resetDataAsAtCache()
    const outcome = await runReport(
      payload,
      admin,
      'daily-applications',
      { parameters: RANGE, compare: true },
      { pool: reader },
    )
    if (outcome.status !== 200) throw new Error(JSON.stringify(outcome.body))
    // March is a whole month, so it is set against February.
    expect(outcome.body.previous).toMatchObject({
      from: '2001-02-01',
      to: '2001-02-28',
      rows: [{ day: '2001-02-20', applications: 1 }],
    })
    expect(outcome.body.dataAsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const logged = await payload.find({
      collection: 'report-runs',
      where: { reportSlug: { equals: 'daily-applications' } },
      sort: '-createdAt',
      limit: 2,
      overrideAccess: true,
    })
    expect(logged.docs.map((d) => (d.parameters as { from: string }).from).sort()).toEqual([
      '2001-02-01',
      '2001-03-01',
    ])
    // The previous period's run is marked, so usage does not count it as a read.
    expect(
      logged.docs.map((d) => [(d.parameters as { from: string }).from, d.comparison]).sort(),
    ).toEqual([
      ['2001-02-01', true],
      ['2001-03-01', false],
    ])
  })

  it('has nothing to compare for a report without a period', async () => {
    const outcome = await runReport(
      payload,
      admin,
      'arrears-balance',
      { parameters: {}, compare: true },
      { pool: reader },
    )
    expect(outcome.status).toBe(200)
    expect((outcome.body as { previous?: unknown }).previous).toBeNull()
  })
})

describe('upgrading the first reports', () => {
  it('gives an untouched first report its presentation, and leaves a changed one alone', async () => {
    const find = async (slug: string) =>
      (
        await payload.find({
          collection: 'report-definitions',
          where: { slug: { equals: slug } },
          limit: 1,
          overrideAccess: true,
        })
      ).docs[0]
    // As the reports were before this change: uncategorised, one chart.
    const decline = await find('decline-rate')
    await payload.update({
      collection: 'report-definitions',
      id: decline.id,
      data: {
        category: 'other',
        chart: {
          type: 'bar',
          x: 'segment',
          stacked: true,
          series: ['capacity', 'character', 'identity', 'eligibility', 'other'].map((c) => ({
            column: c,
            label: c.charAt(0).toUpperCase() + c.slice(1),
          })),
        },
        headline: [],
        columnSettings: [],
        _status: 'published',
      },
      overrideAccess: true,
    })
    const funnel = await find('application-funnel')
    await payload.update({
      collection: 'report-definitions',
      id: funnel.id,
      data: { category: 'other', sql: `${FIRST_REPORTS[1].sql}\n`, _status: 'published' },
      overrideAccess: true,
    })

    // A report with an unpublished draft, or any presentation of its own, is left alone.
    const gtm = await find('gtm-numbers')
    await payload.update({
      collection: 'report-definitions',
      id: gtm.id,
      data: {
        category: 'other',
        chart: null,
        headline: [],
        columnSettings: [],
        _status: 'published',
      },
      overrideAccess: true,
    })
    await payload.update({
      collection: 'report-definitions',
      id: gtm.id,
      data: { title: 'GTM (draft)' },
      draft: true,
      overrideAccess: true,
    })

    expect(await upgradeFirstReports(payload)).toEqual(['decline-rate'])
    const upgraded = await find('decline-rate')
    expect(upgraded.category).toBe('credit')
    expect((upgraded.chart as unknown[]).length).toBe(2)
    expect((await find('application-funnel')).category).toBe('other')
    const gtmAfter = await find('gtm-numbers')
    expect(gtmAfter.category).toBe('other')
    expect(gtmAfter.title).toBe('Go-to-market numbers')
  })
})

describe('Monday email', () => {
  // Monday 2001-03-12 08:00 Sydney (AEDT): defaults cover 5-11 March.
  const MONDAY = new Date('2001-03-11T21:00:00Z')
  const deliver = (now: Date = MONDAY) =>
    deliverScheduledReports(payload, {
      schedule: 'weekly_monday',
      now,
      appUrl: 'https://crm.example.test/',
      runOptions: { pool: reader },
    })

  beforeEach(async () => {
    await pool.query(`DELETE FROM report_runs WHERE report_slug = 'decline-rate'`)
    sendStaffEmail.mockReset().mockResolvedValue('email-id')
    delete process.env.REPORTS_EMAIL_LABEL
  })

  it('sends one email to supervisors with the CSV, then nothing more that day', async () => {
    const first = await deliver()
    expect(first.scheduledFor).toBe('2001-03-12')
    expect(first.reports).toHaveLength(1)
    expect(first.reports[0]).toMatchObject({ slug: 'decline-rate', status: 'sent', rows: 4 })
    expect(sendStaffEmail).toHaveBeenCalledTimes(1)
    const [email, key] = sendStaffEmail.mock.calls[0]
    expect(key).toBe('report-decline-rate-2001-03-12')
    expect(email.to).toContain(supervisorEmail)
    expect(email.subject).toBe('Weekly report: Decline rate and reasons (2001-03-12)')
    expect(email.html).toContain('https://crm.example.test/admin/reports/decline-rate')
    expect(email.html).toContain('From: 2001-03-05, To: 2001-03-11')
    const [attachment] = email.attachments
    expect(attachment.filename).toBe('decline-rate-2001-03-12.csv')
    const csv = Buffer.from(attachment.contentBase64, 'base64').toString('utf8')
    expect(csv).toContain('segment,decided,declined,decline_rate_pct')
    expect(csv).toContain('paid,2,1,50,1,0,0,0,0')

    const runs = await payload.find({
      collection: 'report-runs',
      where: { reportSlug: { equals: 'decline-rate' } },
      overrideAccess: true,
    })
    expect(runs.docs).toHaveLength(1)
    expect(runs.docs[0]).toMatchObject({
      outcome: 'ok',
      trigger: 'schedule',
      scheduledFor: '2001-03-12',
      rowCount: 4,
    })

    const again = await deliver(new Date('2001-03-12T03:00:00Z'))
    expect(again.reports).toEqual([{ slug: 'decline-rate', status: 'already_sent', recipients: 0 }])
    expect(sendStaffEmail).toHaveBeenCalledTimes(1)
  })

  it('sends once when two calls race', async () => {
    const [a, b] = await Promise.all([deliver(), deliver()])
    expect([a.reports[0].status, b.reports[0].status].sort()).toEqual(['already_sent', 'sent'])
    expect(sendStaffEmail).toHaveBeenCalledTimes(1)
  })

  it('a failed send is logged, releases the day, and the next call sends', async () => {
    sendStaffEmail.mockRejectedValueOnce(new Error('Resend is down'))
    const failed = await deliver()
    expect(failed.reports[0]).toMatchObject({ status: 'failed', error: 'EMAIL_FAILED' })
    const logged = await payload.find({
      collection: 'report-runs',
      where: { reportSlug: { equals: 'decline-rate' } },
      overrideAccess: true,
    })
    expect(logged.docs[0]).toMatchObject({ outcome: 'error', errorCode: 'EMAIL_FAILED' })
    expect(logged.docs[0].scheduledFor ?? null).toBeNull()

    const retry = await deliver()
    expect(retry.reports[0].status).toBe('sent')
    expect(sendStaffEmail).toHaveBeenCalledTimes(2)
  })

  it('labels a non-production environment in the subject and body', async () => {
    process.env.REPORTS_EMAIL_LABEL = 'DEMO'
    await deliver()
    const [email] = sendStaffEmail.mock.calls[0]
    expect(email.subject).toBe('[DEMO] Weekly report: Decline rate and reasons (2001-03-12)')
    expect(email.html).toContain('DEMO</strong> environment, not production data')
  })

  // Test files share one process, so an environment variable set here would
  // label every later file's emails.
  afterAll(() => {
    delete process.env.REPORTS_EMAIL_LABEL
  })
})
