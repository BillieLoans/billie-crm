/**
 * Integration coverage for the report runner and report definitions (BTB-506).
 *
 * Runs against the real Postgres from tests/utils/globalSetup.ts. Proves the
 * ticket's guarantees end to end: non-SELECT SQL is refused, the timeout
 * fires, the row cap holds, a role without access is refused, the runner
 * cannot read outside `reporting`, every run is logged, and a new report is
 * only data (created here through the Local API, with no code).
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import type { Pool } from 'pg'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { applyReportingSchema } from '@/server/reporting/schema'
import { ReportRunError, runReportSql } from '@/server/reporting/runner'
import { listReports, runReport } from '@/server/reporting/run-report'

let payload: Payload
let pool: Pool
const PREFIX = 'rptrun'
const users: Record<string, { id: string; role: string }> = {}

async function expectRunError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ReportRunError)
  await promise.catch((e: ReportRunError) => expect(e.code).toBe(code))
}

/** The field messages of a Payload ValidationError. */
async function fieldErrors(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const data = (error as { data?: { errors?: Array<{ message: string }> } }).data
    return (data?.errors ?? []).map((e) => e.message).join(' | ')
  }
  throw new Error('expected the save to be refused')
}

async function makeUser(role: string) {
  const user = await payload.create({
    collection: 'users',
    data: {
      email: `${PREFIX}-${role}-${Date.now()}@billie.loans`,
      password: 'Test1234!',
      role: role as 'admin',
      firstName: 'Report',
      lastName: role,
    },
  })
  return { id: String(user.id), role }
}

async function cleanup() {
  await pool.query(`DELETE FROM report_runs WHERE report_slug LIKE '${PREFIX}%'`)
  const defs = await payload.find({
    collection: 'report-definitions',
    where: { slug: { like: PREFIX } },
    limit: 100,
    overrideAccess: true,
  })
  for (const doc of defs.docs) {
    await payload.delete({ collection: 'report-definitions', id: doc.id, overrideAccess: true })
  }
  await pool.query(`DELETE FROM users WHERE email LIKE '${PREFIX}-%'`)
}

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as unknown as Pool
  // The runner switches to reporting_reader; create it as the test owner,
  // then re-apply the schema so its grants reach the role.
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_reader') THEN
      CREATE ROLE reporting_reader NOLOGIN;
    END IF;
  END $$`)
  await applyReportingSchema(pool)
  await cleanup()
  for (const role of ['admin', 'operations', 'readonly']) users[role] = await makeUser(role)
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('runReportSql', () => {
  it('reads the reporting schema with bound parameters', async () => {
    const result = await runReportSql(
      'SELECT $1::int + 1 AS n, $2::date AS d, $3::text AS t, count(*) AS apps FROM application',
      [41, '2026-10-22', "x'; DROP TABLE users; --"],
      { pool },
    )
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ n: 42, d: '2026-10-22', t: "x'; DROP TABLE users; --" })
    expect(typeof result.rows[0].apps).toBe('number')
    expect(result.columns).toEqual([
      { name: 'n', kind: 'number' },
      { name: 'd', kind: 'date' },
      { name: 't', kind: 'text' },
      { name: 'apps', kind: 'number' },
    ])
    expect(result.truncated).toBe(false)
  })

  it('resolves unqualified names in the reporting schema', async () => {
    const result = await runReportSql('SELECT current_setting($1) AS p', ['search_path'], { pool })
    expect(result.rows[0].p).toBe('reporting')
  })

  it('refuses statements other than SELECT and WITH', async () => {
    await expectRunError(runReportSql('DELETE FROM decision_event', [], { pool }), 'INVALID_SQL')
    await expectRunError(runReportSql('SELECT 1; DROP TABLE users', [], { pool }), 'INVALID_SQL')
  })

  it('refuses a data-modifying CTE at the database', async () => {
    await expectRunError(
      runReportSql(
        `WITH gone AS (DELETE FROM decision_event RETURNING 1) SELECT count(*) FROM gone`,
        [],
        { pool },
      ),
      'INVALID_SQL',
    )
  })

  it('cannot read outside the reporting schema', async () => {
    await expectRunError(runReportSql('SELECT * FROM public.users', [], { pool }), 'PERMISSION')
    await expectRunError(
      runReportSql('SELECT conversation_id FROM public.conversations', [], { pool }),
      'PERMISSION',
    )
  })

  it('stops a query at the timeout', async () => {
    const started = Date.now()
    await expectRunError(
      runReportSql('SELECT pg_sleep(5) AS slept', [], { pool, timeoutMs: 250 }),
      'TIMEOUT',
    )
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('caps the rows at 50,000 and says so', async () => {
    const result = await runReportSql('SELECT g AS n FROM generate_series(1, 50010) AS g', [], {
      pool,
    })
    expect(result.rowCount).toBe(50_000)
    expect(result.rows).toHaveLength(50_000)
    expect(result.truncated).toBe(true)
  })

  it('leaves the connection clean for the next user of the pool', async () => {
    await runReportSql('SELECT 1 AS one', [], { pool })
    const { rows } = await pool.query(
      "SELECT current_user AS u, current_setting('search_path') AS p, current_setting('transaction_read_only') AS ro",
    )
    expect(rows[0].u).not.toBe('reporting_reader')
    expect(rows[0].p).not.toBe('reporting')
    expect(rows[0].ro).toBe('off')
  })
})

describe('report definitions and runs', () => {
  const sql = 'SELECT g AS day_number, g * $1::int AS scaled FROM generate_series(1, 3) AS g'
  let reportId: string

  beforeAll(async () => {
    const doc = await payload.create({
      collection: 'report-definitions',
      data: {
        title: 'Run test',
        slug: `${PREFIX}-scaled`,
        sql,
        parameters: [{ name: 'factor', label: 'Factor', type: 'integer', default: 2 }],
        chart: { type: 'line', x: 'day_number', series: [{ column: 'scaled' }] },
        roles: ['operations'],
        _status: 'published',
      },
      overrideAccess: true,
    })
    reportId = String(doc.id)
  })

  it('refuses an invalid definition when it is saved', async () => {
    expect(
      await fieldErrors(
        payload.create({
          collection: 'report-definitions',
          data: {
            title: 'Bad',
            slug: `${PREFIX}-bad`,
            sql: 'DELETE FROM decision_event',
            roles: ['admin'],
            _status: 'published',
          },
          overrideAccess: true,
        }),
      ),
    ).toMatch(/SELECT or WITH/)
    expect(
      await fieldErrors(
        payload.create({
          collection: 'report-definitions',
          data: {
            title: 'Unbound',
            slug: `${PREFIX}-unbound`,
            sql: 'SELECT $1::int AS n',
            parameters: [],
            roles: ['admin'],
            _status: 'published',
          },
          overrideAccess: true,
        }),
      ),
    ).toMatch(/uses \$1 but the report has 0 parameters/)
  })

  it('lists the report only for roles it is shared with, without its SQL', async () => {
    const forOps = await listReports(payload, users.operations)
    const mine = forOps.find((r) => r.slug === `${PREFIX}-scaled`)
    expect(mine).toBeDefined()
    expect(mine).not.toHaveProperty('sql')
    const forReadonly = await listReports(payload, users.readonly)
    expect(forReadonly.find((r) => r.slug === `${PREFIX}-scaled`)).toBeUndefined()
  })

  it('runs a published report and logs the run', async () => {
    const outcome = await runReport(payload, users.operations, `${PREFIX}-scaled`, {
      parameters: { factor: '5' },
    })
    expect(outcome.status).toBe(200)
    if (outcome.status !== 200) return
    expect(outcome.body.rows).toEqual([
      { day_number: 1, scaled: 5 },
      { day_number: 2, scaled: 10 },
      { day_number: 3, scaled: 15 },
    ])
    expect(outcome.body.report.version).not.toBe('unknown')

    const runs = await payload.find({
      collection: 'report-runs',
      where: { report: { equals: reportId } },
      sort: '-createdAt',
      limit: 1,
      overrideAccess: true,
      depth: 0,
    })
    expect(runs.docs[0]).toMatchObject({
      reportSlug: `${PREFIX}-scaled`,
      outcome: 'ok',
      rowCount: 3,
      truncated: false,
      user: users.operations.id,
      parameters: { factor: 5 },
      version: outcome.body.report.version,
    })
  })

  it('refuses a role the report is not shared with, and logs the refusal', async () => {
    const outcome = await runReport(payload, users.readonly, `${PREFIX}-scaled`, {})
    expect(outcome.status).toBe(403)
    const runs = await payload.find({
      collection: 'report-runs',
      where: { and: [{ report: { equals: reportId } }, { user: { equals: users.readonly.id } }] },
      overrideAccess: true,
      depth: 0,
    })
    expect(runs.docs[0]).toMatchObject({ outcome: 'refused', errorCode: 'FORBIDDEN' })
  })

  it('rejects bad parameter values with a message per field', async () => {
    const outcome = await runReport(payload, users.operations, `${PREFIX}-scaled`, {
      parameters: { factor: 'lots' },
    })
    expect(outcome.status).toBe(400)
    if (outcome.status === 400) {
      expect(outcome.body.error.fields).toEqual({ factor: 'Factor must be a whole number' })
    }
  })

  it('runs drafts for authors only, and viewers keep the published version', async () => {
    await payload.update({
      collection: 'report-definitions',
      id: reportId,
      data: {
        sql: 'SELECT g AS day_number, g * $1::int * 100 AS scaled FROM generate_series(1, 3) AS g',
      },
      draft: true,
      overrideAccess: true,
    })
    const viewer = await runReport(payload, users.operations, `${PREFIX}-scaled`, {
      parameters: { factor: 1 },
    })
    expect(viewer.status === 200 && viewer.body.rows[0].scaled).toBe(1)

    const viewerDraft = await runReport(payload, users.operations, `${PREFIX}-scaled`, {
      parameters: { factor: 1 },
      draft: true,
    })
    expect(viewerDraft.status).toBe(403)

    const author = await runReport(payload, users.admin, `${PREFIX}-scaled`, {
      parameters: { factor: 1 },
      draft: true,
    })
    expect(author.status === 200 && author.body.rows[0].scaled).toBe(100)
    expect(author.status === 200 && author.body.report).toMatchObject({
      version: 'draft',
      draft: true,
    })
  })

  it('shows database detail to authors only', async () => {
    await payload.create({
      collection: 'report-definitions',
      data: {
        title: 'Reads users',
        slug: `${PREFIX}-sneaky`,
        sql: 'SELECT email FROM public.users',
        roles: ['operations'],
        _status: 'published',
      },
      overrideAccess: true,
    })
    const viewer = await runReport(payload, users.operations, `${PREFIX}-sneaky`, {})
    expect(viewer.status).toBe(422)
    if (viewer.status === 422) {
      expect(viewer.body.error.code).toBe('PERMISSION')
      expect(viewer.body.error.detail).toBeUndefined()
    }
    const author = await runReport(payload, users.admin, `${PREFIX}-sneaky`, {})
    expect(author.status === 422 && author.body.error.detail).toMatch(/permission denied/)
  })

  it('an unpublished or unknown report is not found', async () => {
    const outcome = await runReport(payload, users.admin, `${PREFIX}-missing`, {})
    expect(outcome.status).toBe(404)
  })
})
