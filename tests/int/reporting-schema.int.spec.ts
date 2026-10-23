/**
 * Integration coverage for the `reporting` schema (BTB-504).
 *
 * Runs against the real Postgres from tests/utils/globalSetup.ts, where the
 * schema is applied by the payload.config onInit hook after `push`. Verifies
 * the views against Payload's actual column names, the Sydney-day arithmetic,
 * the decline-category mapping and the grants.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { getDashboardPool, type QueryablePool } from '@/lib/dashboard-aggregates'
import { applyReportingSchema } from '@/server/reporting/schema'

let payload: Payload
let pool: QueryablePool

const PREFIX = 'RPTSCHEMA'

async function reset() {
  await pool.query(
    `DELETE FROM loan_accounts_repayment_schedule_payments
      WHERE _parent_id IN (SELECT id FROM loan_accounts WHERE loan_account_id LIKE $1)`,
    [`${PREFIX}%`],
  )
  await pool.query('DELETE FROM loan_accounts WHERE loan_account_id LIKE $1', [`${PREFIX}%`])
  await pool.query('DELETE FROM conversations WHERE conversation_id LIKE $1', [`${PREFIX}%`])
  await pool.query('DELETE FROM reporting.decision_event WHERE conversation_id LIKE $1', [
    `${PREFIX}%`,
  ])
  await pool.query(`DELETE FROM reporting.snap_portfolio WHERE as_at_date = '1999-12-31'`)
}

async function insertConversation(opts: {
  suffix: string
  applicationNumber?: string
  startedAt: string
  attribution?: Record<string, string> | null
  decisionStatus?: string | null
  reason?: string | null
  rulesetVersion?: string | null
}): Promise<string> {
  const id = `${PREFIX}-${opts.suffix}`
  await pool.query(
    `INSERT INTO conversations
       (conversation_id, application_number, status, started_at, attribution,
        decision_status, decision_detail_reason, decision_detail_ruleset_version, version)
     VALUES ($1, $2, 'active', $3, $4::jsonb, $5, $6, $7, 1)`,
    [
      id,
      opts.applicationNumber ?? '',
      opts.startedAt,
      opts.attribution ? JSON.stringify(opts.attribution) : null,
      opts.decisionStatus ?? null,
      opts.reason ?? null,
      opts.rulesetVersion ?? null,
    ],
  )
  return id
}

async function insertLoan(opts: {
  suffix: string
  applicationNumber: string
  disbursedAt: string | null
  amount: number
}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO loan_accounts
       (loan_account_id, account_number, account_status, loan_terms_loan_amount,
        loan_terms_disbursed_date, application_number)
     VALUES ($1, $2, 'active', $3, $4, $5)
     RETURNING id`,
    [
      `${PREFIX}-${opts.suffix}`,
      `ACC-${opts.suffix}`,
      opts.amount,
      opts.disbursedAt,
      opts.applicationNumber,
    ],
  )
  return rows[0].id as string
}

async function insertDecisionEvent(opts: {
  key: string
  conversationId: string
  decision: string
  reason?: string | null
  decidedAt: string
  rulesetVersion?: string | null
}) {
  await pool.query(
    `INSERT INTO reporting.decision_event
       (decision_key, conversation_id, decision, reason, decided_at, ruleset_version)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      opts.key,
      opts.conversationId,
      opts.decision,
      opts.reason ?? null,
      opts.decidedAt,
      opts.rulesetVersion ?? null,
    ],
  )
}

beforeAll(async () => {
  payload = await getPayload({ config })
  const p = getDashboardPool(payload)
  if (!p) throw new Error('Postgres pool not available')
  pool = p
})

afterAll(async () => {
  await reset()
})

beforeEach(async () => {
  await reset()
})

describe('reporting schema', () => {
  it('can be applied again without error', async () => {
    await applyReportingSchema(pool)
    await applyReportingSchema(pool)
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.views WHERE table_schema = 'reporting'
        ORDER BY table_name`,
    )
    expect(rows.map((r) => r.table_name)).toEqual([
      'application',
      'block_clear_request',
      'collection_case',
      'contact_note',
      'customer',
      'decision',
      'instalment',
      'llm_cost',
      'loan',
      'notification',
      'write_off',
    ])
  })

  it('maps decline reasons to the BTB-462 categories by longest prefix', async () => {
    const cases: Array<[string | null, string | null]> = [
      ['CREDIT_ASSESSMENT:SERVICEABILITY', 'capacity'],
      ['CREDIT_ASSESSMENT:ACCOUNT_CONDUCT', 'character'],
      ['CREDIT_ASSESSMENT:IDENTITYRISK_ASSESSMENT', 'identity'],
      ['CREDIT_ASSESSMENT:PEP', 'identity'],
      ['CREDIT_ASSESSMENT:FINAL_RULE', 'other'],
      ['BUSINESS_ACCOUNT', 'eligibility'],
      ['NO_PERSONAL_ACCOUNT', 'eligibility'],
      ['REAPPLICATION_BLOCK:ID_VERIFICATION', 'eligibility'],
      ['SYSTEM_FAILURE:serviceability', 'other'],
      ['G5_TIMEOUT:serviceability', 'other'],
      ['SOMETHING_NEW', 'other'],
      [null, null],
      ['', null],
    ]
    for (const [reason, category] of cases) {
      const { rows } = await pool.query('SELECT reporting.decline_category($1) AS c', [reason])
      expect(rows[0].c, String(reason)).toBe(category)
    }
  })

  it('projects an application with channel, Sydney date, decline category and funding', async () => {
    // 2026-10-04T14:30Z is 01:30 on 5 Oct in Sydney (AEDT began 4 Oct 2026).
    const conv = await insertConversation({
      suffix: 'A',
      applicationNumber: `${PREFIX}-APP-A`,
      startedAt: '2026-10-04T14:30:00Z',
      attribution: { gclid: 'x', utm_source: 'google', utm_campaign: 'cellA' },
      decisionStatus: 'declined',
      reason: 'CREDIT_ASSESSMENT:SERVICEABILITY',
      rulesetVersion: '0123456789abcdef',
    })
    await insertConversation({
      suffix: 'B',
      applicationNumber: `${PREFIX}-APP-B`,
      startedAt: '2026-10-10T01:00:00Z',
      decisionStatus: 'approved',
    })
    await insertLoan({
      suffix: 'B',
      applicationNumber: `${PREFIX}-APP-B`,
      disbursedAt: '2026-10-10T23:30:00Z',
      amount: 300,
    })

    const { rows } = await pool.query(
      `SELECT * FROM reporting.application WHERE conversation_id LIKE $1 ORDER BY conversation_id`,
      [`${PREFIX}%`],
    )
    expect(rows).toHaveLength(2)
    const [a, b] = rows
    expect(a.conversation_id).toBe(conv)
    expect(a.channel).toBe('paid')
    expect(a.source).toBe('google')
    expect(a.campaign).toBe('cellA')
    const { rows: dateRows } = await pool.query(
      `SELECT started_on::text AS d FROM reporting.application WHERE conversation_id = $1`,
      [conv],
    )
    expect(dateRows[0].d).toBe('2026-10-05')
    expect(a.decision_status).toBe('declined')
    expect(a.decline_category).toBe('capacity')
    expect(a.ruleset_version).toBe('0123456789abcdef')
    expect(a.funded).toBe(false)

    expect(b.channel).toBe('direct')
    expect(b.decline_reason).toBeNull()
    expect(b.decline_category).toBeNull()
    expect(b.funded).toBe(true)
    const { rows: fundedRows } = await pool.query(
      `SELECT funded_on::text AS d FROM reporting.application WHERE conversation_id = $1`,
      [`${PREFIX}-B`],
    )
    expect(fundedRows[0].d).toBe('2026-10-11')
  })

  it('keeps the latest decision per conversation and dates it in Sydney', async () => {
    const conv = `${PREFIX}-D`
    await insertDecisionEvent({
      key: `${PREFIX}-k1`,
      conversationId: conv,
      decision: 'DECLINED',
      reason: 'SYSTEM_FAILURE:serviceability',
      decidedAt: '2026-10-20T01:00:00Z',
    })
    await insertDecisionEvent({
      key: `${PREFIX}-k2`,
      conversationId: conv,
      decision: 'APPROVED',
      decidedAt: '2026-10-20T13:30:00Z',
      rulesetVersion: 'aaaaaaaaaaaaaaaa',
    })
    const { rows } = await pool.query(
      `SELECT decision, decline_category, ruleset_version, decided_on::text AS d
         FROM reporting.decision WHERE conversation_id = $1`,
      [conv],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      decision: 'APPROVED',
      decline_category: null,
      ruleset_version: 'aaaaaaaaaaaaaaaa',
      d: '2026-10-21',
    })
  })

  it('links a loan to its acquisition source and lists its instalments', async () => {
    await insertConversation({
      suffix: 'L',
      applicationNumber: `${PREFIX}-APP-L`,
      startedAt: '2026-10-01T00:00:00Z',
      attribution: { utm_source: 'chatgpt', utm_medium: 'llm' },
    })
    const loanId = await insertLoan({
      suffix: 'L',
      applicationNumber: `${PREFIX}-APP-L`,
      disbursedAt: '2026-10-02T00:00:00Z',
      amount: 200,
    })
    await pool.query(
      `INSERT INTO loan_accounts_repayment_schedule_payments
         (id, _order, _parent_id, payment_number, due_date, amount, status)
       VALUES ($1, 1, $2, 1, '2026-10-16T00:00:00Z', 110, 'scheduled')`,
      [`${PREFIX}-pay-1`, loanId],
    )
    const { rows } = await pool.query(
      `SELECT channel, source, loan_amount FROM reporting.loan WHERE loan_account_id = $1`,
      [`${PREFIX}-L`],
    )
    expect(rows[0]).toMatchObject({ channel: 'llm', source: 'chatgpt' })
    expect(Number(rows[0].loan_amount)).toBe(200)
    const { rows: inst } = await pool.query(
      `SELECT payment_number, status, due_on::text AS d FROM reporting.instalment
        WHERE loan_account_id = $1`,
      [`${PREFIX}-L`],
    )
    expect(inst).toEqual([{ payment_number: 1, status: 'scheduled', d: '2026-10-16' }])
  })

  it("finds a loan's conversation through the application_number index", async () => {
    // With sequential scans priced out, a lookup that cannot use the index
    // still shows one. That is the bug this guards: matching on the
    // application view's NULLIF'd column scanned every conversation per loan.
    const results = (await pool.query(
      `BEGIN;
       SET LOCAL enable_seqscan = off;
       EXPLAIN SELECT acquisition FROM reporting.loan;
       COMMIT;`,
    )) as unknown as Array<{ rows: Array<{ 'QUERY PLAN': string }> }>
    const plan = results[2].rows.map((r) => r['QUERY PLAN']).join('\n')
    expect(plan).toContain('conversations_application_number_idx')
    expect(plan).not.toMatch(/Seq Scan on conversations/)
  })

  it('filters applications by Sydney start date through conversations_started_on_idx', async () => {
    const results = (await pool.query(
      `BEGIN;
       SET LOCAL enable_seqscan = off;
       EXPLAIN SELECT count(*) FROM reporting.application
                WHERE started_on BETWEEN DATE '2026-10-01' AND DATE '2026-10-07';
       COMMIT;`,
    )) as unknown as Array<{ rows: Array<{ 'QUERY PLAN': string }> }>
    const plan = results[2].rows.map((r) => r['QUERY PLAN']).join('\n')
    expect(plan).toContain('conversations_started_on_idx')
  })

  it('stores ledger figures exactly', async () => {
    await pool.query(
      `INSERT INTO reporting.snap_portfolio
         (as_at_date, total_active_accounts, principal_receivable, fees_receivable,
          total_receivables)
       VALUES ('1999-12-31', 3, '1234.567', '0.10', '1234.667')`,
    )
    const { rows } = await pool.query(
      `SELECT principal_receivable::text AS p FROM reporting.snap_portfolio
        WHERE as_at_date = '1999-12-31'`,
    )
    expect(rows[0].p).toBe('1234.567')
  })

  it('grants the runtime role writes and the reader role views only', async () => {
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rpt_test_app') THEN
        CREATE ROLE rpt_test_app; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_reader') THEN
        CREATE ROLE reporting_reader; END IF;
    END $$`)
    await pool.query('GRANT INSERT ON public.conversations TO rpt_test_app')
    await applyReportingSchema(pool)
    const { rows } = await pool.query(`SELECT
      has_table_privilege('rpt_test_app', 'reporting.decision_event', 'INSERT') AS app_insert,
      has_table_privilege('rpt_test_app', 'reporting.application', 'SELECT') AS app_select,
      has_table_privilege('reporting_reader', 'reporting.application', 'SELECT') AS reader_select,
      has_table_privilege('reporting_reader', 'reporting.decision_event', 'INSERT') AS reader_insert,
      has_table_privilege('reporting_reader', 'public.conversations', 'SELECT') AS reader_public`)
    expect(rows[0]).toEqual({
      app_insert: true,
      app_select: true,
      reader_select: true,
      reader_insert: false,
      reader_public: false,
    })
  })
})
