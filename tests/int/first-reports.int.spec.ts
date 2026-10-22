/**
 * Integration coverage for the first reports and the Monday email (BTB-507).
 *
 * Built and checked with clearly marked TEST data only (BTB-462): every row
 * here is prefixed TEST-BTB507 and dated March 2001, far from real data.
 * Creates the reports exactly as the 20261025 migration does, runs each as
 * reporting_reader, and checks the numbers by hand-computed expectations.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { createFirstReports, FIRST_REPORTS } from '@/server/reporting/definitions/first-reports'
import { runReport } from '@/server/reporting/run-report'
import { deliverScheduledReports } from '@/server/reporting/scheduled'
import { reportingReaderPool } from '../utils/reportingReader'

let payload: Payload
let pool: Pool
let reader: Pool
const P = 'TEST-BTB507'
const RANGE = { from: '2001-03-01', to: '2001-03-31' }
let admin: { id: string; role: string }
let supervisorEmail: string

async function cleanup() {
  await pool.query(`DELETE FROM reporting.decision_event WHERE conversation_id LIKE '${P}%'`)
  await pool.query(`DELETE FROM loan_accounts WHERE loan_account_id LIKE '${P}%'`)
  await pool.query(`DELETE FROM conversations WHERE conversation_id LIKE '${P}%'`)
  await pool.query(
    `DELETE FROM report_runs WHERE report_slug IN (${FIRST_REPORTS.map((r) => `'${r.slug}'`).join(',')})`,
  )
  await payload.delete({
    collection: 'report-definitions',
    where: { slug: { in: FIRST_REPORTS.map((r) => r.slug) } },
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
  },
) {
  await pool.query(
    `INSERT INTO conversations
       (conversation_id, application_number, status, started_at, attribution, decision_status,
        decision_detail_reason, decision_detail_ruleset_version, statement_capture, version)
     VALUES ($1, $2, 'active', '2001-03-05T01:00:00Z', $3::jsonb, $4, $5, $6, $7::jsonb, 1)`,
    [
      `${P}-${suffix}`,
      opts.appNumber ?? '',
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
) {
  await pool.query(
    `INSERT INTO reporting.decision_event
       (decision_key, conversation_id, decision, reason, ruleset_version, mock_origin, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, '2001-03-05T03:00:00Z')`,
    [`${P}-${suffix}-key`, `${P}-${suffix}`, decision, reason, ruleset, mock],
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
  await pool.query(
    `INSERT INTO loan_accounts
       (loan_account_id, account_number, account_status, loan_terms_loan_amount,
        loan_terms_disbursed_date, application_number)
     VALUES ($1, 'ACC-TEST-BTB507', 'active', 300, '2001-03-06T03:00:00Z', $2)`,
    [`${P}-L1`, `${P}-APP1`],
  )
  // C2: paid, declined for capacity under r1.
  await conversation('C2', {
    attribution: paid,
    decisionStatus: 'declined',
    reason: 'CREDIT_ASSESSMENT:SERVICEABILITY',
    ruleset: 'r1',
  })
  await decided('C2', 'DECLINED', 'CREDIT_ASSESSMENT:SERVICEABILITY', 'r1')
  // C3: referral, declined for eligibility under r2.
  await conversation('C3', {
    attribution: { utm_source: 'friend', utm_medium: 'referral' },
    decisionStatus: 'declined',
    reason: 'BUSINESS_ACCOUNT',
    ruleset: 'r2',
  })
  await decided('C3', 'DECLINED', 'BUSINESS_ACCOUNT', 'r2')
  // C4: no attribution (before capture began), started only.
  await conversation('C4', {})
  // C5: a mock approval, excluded everywhere.
  await conversation('C5', { decisionStatus: 'approved' })
  await decided('C5', 'APPROVED', null, 'r1', true)
  // C6: paid, statements shared, not yet decided.
  await conversation('C6', { attribution: paid, statementComplete: true })

  await createFirstReports(payload)
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

  it('decline rate by source', async () => {
    expect(await rows('decline-rate', { ...RANGE, group_by: 'source' })).toEqual([
      {
        segment: 'paid',
        decided: 2,
        declined: 1,
        decline_rate_pct: 50,
        capacity: 1,
        character: 0,
        identity: 0,
        eligibility: 0,
        other: 0,
      },
      {
        segment: 'referral',
        decided: 1,
        declined: 1,
        decline_rate_pct: 100,
        capacity: 0,
        character: 0,
        identity: 0,
        eligibility: 1,
        other: 0,
      },
    ])
  })

  it('decline rate by ruleset version', async () => {
    const result = await rows('decline-rate', { ...RANGE, group_by: 'ruleset' })
    expect(result.map((r) => [r.segment, r.decided, r.declined])).toEqual([
      ['r1', 2, 1],
      ['r2', 1, 1],
    ])
  })

  it('application funnel by source and medium', async () => {
    expect(await rows('application-funnel', RANGE)).toEqual([
      {
        source_medium: 'google / cpc',
        channel: 'paid',
        started: 3,
        submitted: 3,
        decided: 2,
        approved: 1,
        funded: 1,
      },
      {
        source_medium: '(not recorded) / (none)',
        channel: 'direct',
        started: 1,
        submitted: 0,
        decided: 0,
        approved: 0,
        funded: 0,
      },
      {
        source_medium: 'friend / referral',
        channel: 'referral',
        started: 1,
        submitted: 1,
        decided: 1,
        approved: 0,
        funded: 0,
      },
    ])
  })

  it('go-to-market numbers', async () => {
    const result = await rows('gtm-numbers', RANGE)
    expect(result.map((r) => r.source)).toEqual(['paid', 'direct', 'referral', 'All sources'])
    expect(result[0]).toEqual({
      source: 'paid',
      starts: 3,
      share_of_starts_pct: 60,
      decided: 2,
      approved: 1,
      pass_rate_pct: 50,
      funded: 1,
      funded_rate_pct: 33.3,
      median_hours_to_money: 26,
      loans_disbursed: 1,
      loans_in_arrears: 0,
      arrears_rate_pct: 0,
    })
    expect(result[2]).toMatchObject({
      source: 'referral',
      share_of_starts_pct: 20,
      pass_rate_pct: 0,
    })
    expect(result[3]).toMatchObject({
      source: 'All sources',
      starts: 5,
      share_of_starts_pct: 100,
      decided: 3,
      pass_rate_pct: 33.3,
      funded_rate_pct: 20,
      median_hours_to_money: 26,
      loans_disbursed: 1,
    })
  })
})

describe('Monday email', () => {
  it('sends the scheduled report to supervisors with the CSV, once per Sydney day', async () => {
    const sent: Array<Record<string, unknown>> = []
    const spy = vi
      .spyOn(payload, 'sendEmail')
      .mockImplementation(async (message: Record<string, unknown>) => {
        sent.push(message)
        return { id: 'test' }
      })
    try {
      // Monday 2001-03-12 08:00 Sydney (AEDT): defaults cover 5-11 March.
      const now = new Date('2001-03-11T21:00:00Z')
      const first = await deliverScheduledReports(payload, {
        schedule: 'weekly_monday',
        now,
        appUrl: 'https://crm.example.test/',
        runOptions: { pool: reader },
      })
      expect(first.scheduledFor).toBe('2001-03-12')
      expect(first.reports).toEqual([
        { slug: 'decline-rate', status: 'sent', recipients: 1, rows: 2, attached: true },
      ])
      const toSupervisor = sent.filter((m) => m.to === supervisorEmail)
      expect(toSupervisor).toHaveLength(1)
      const [email] = toSupervisor
      expect(email.subject).toBe('Weekly report: Decline rate and reasons (2001-03-12)')
      expect(email.html).toContain('https://crm.example.test/admin/reports/decline-rate')
      expect(email.html).toContain('From: 2001-03-05, To: 2001-03-11')
      const [attachment] = email.attachments as Array<{ filename: string; content: string }>
      expect(attachment.filename).toBe('decline-rate-2001-03-12.csv')
      const csv = Buffer.from(attachment.content, 'base64').toString('utf8')
      expect(csv).toContain('segment,decided,declined,decline_rate_pct')
      expect(csv).toContain('paid,2,1,50,1,0,0,0,0')

      const runs = await payload.find({
        collection: 'report-runs',
        where: {
          and: [{ reportSlug: { equals: 'decline-rate' } }, { trigger: { equals: 'schedule' } }],
        },
        overrideAccess: true,
      })
      expect(runs.docs[0]).toMatchObject({ outcome: 'ok', scheduledFor: '2001-03-12', rowCount: 2 })

      const again = await deliverScheduledReports(payload, {
        schedule: 'weekly_monday',
        now: new Date('2001-03-11T22:00:00Z'),
        appUrl: 'https://crm.example.test',
        runOptions: { pool: reader },
      })
      expect(again.reports).toEqual([
        { slug: 'decline-rate', status: 'already_sent', recipients: 0 },
      ])
      expect(sent.filter((m) => m.to === supervisorEmail)).toHaveLength(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('records a failed send and does not mark the day as delivered', async () => {
    await pool.query(`DELETE FROM report_runs WHERE report_slug = 'decline-rate'`)
    const spy = vi.spyOn(payload, 'sendEmail').mockRejectedValue(new Error('Resend is down'))
    try {
      const result = await deliverScheduledReports(payload, {
        schedule: 'weekly_monday',
        now: new Date('2001-03-18T21:00:00Z'),
        appUrl: 'https://crm.example.test',
        runOptions: { pool: reader },
      })
      expect(result.reports[0]).toMatchObject({ status: 'failed', error: 'EMAIL_FAILED' })
      const delivered = await payload.find({
        collection: 'report-runs',
        where: { scheduledFor: { equals: '2001-03-19' } },
        overrideAccess: true,
      })
      expect(delivered.docs).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })
})
