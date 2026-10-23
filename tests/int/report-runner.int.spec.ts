/**
 * Integration coverage for the report runner and report definitions (BTB-506).
 *
 * Runs against the real Postgres from tests/utils/globalSetup.ts, with the
 * runner logged in as `reporting_reader` exactly as in production. Proves the
 * ticket's guarantees end to end: non-SELECT SQL is refused, several
 * statements cannot run, the timeout fires, the row cap holds, a role
 * without access is refused, the runner cannot read outside `reporting` (by
 * any route found in review), every run is logged, and a new report is only
 * data (created here through the Local API, with no code).
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import type { Pool } from 'pg'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { reportingReaderPool } from '../utils/reportingReader'
import { ReportRunError, runReportSql, type RunOptions } from '@/server/reporting/runner'
import { listReports, runReport } from '@/server/reporting/run-report'

let payload: Payload
/** Payload's owner pool, for set-up and assertions. */
let pool: Pool
/** One connection logged in as reporting_reader, as REPORTING_DATABASE_URI is. */
let reader: Pool
const PREFIX = 'rptrun'
const users: Record<string, { id: string; role: string }> = {}

/** Run SQL through the reader connection, as REPORTING_DATABASE_URI would. */
function runSql(sql: string, values: unknown[], options: RunOptions = {}) {
  return runReportSql(sql, values, { pool: reader, ...options })
}

/** Run SQL logged in as the database owner, which the runner must refuse. */
function ownerRun(sql: string) {
  return runReportSql(sql, [], { pool })
}

/** Run a report through the reader connection. */
function run(user: unknown, slug: string, input: Parameters<typeof runReport>[3]) {
  return runReport(payload, user, slug, input, { pool: reader })
}

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
  reader = await reportingReaderPool(pool)
  await cleanup()
  for (const role of ['admin', 'operations', 'readonly']) users[role] = await makeUser(role)
}, 60_000)

afterAll(async () => {
  await cleanup()
  await reader?.end()
})

describe('runReportSql', () => {
  it('reads the reporting schema with bound parameters', async () => {
    const result = await runSql(
      'SELECT $1::int + 1 AS n, $2::date AS d, $3::text AS t, count(*) AS apps FROM application',
      [41, '2026-10-22', "x'; DROP TABLE users; --"],
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
    const result = await runSql('SELECT current_setting($1) AS p', ['search_path'])
    expect(result.rows[0].p).toBe('reporting')
  })

  it('refuses statements other than SELECT and WITH', async () => {
    await expectRunError(runSql('DELETE FROM decision_event', []), 'INVALID_SQL')
    await expectRunError(runSql('SELECT 1; DROP TABLE users', []), 'INVALID_SQL')
  })

  it('refuses a data-modifying CTE at the database', async () => {
    await expectRunError(
      runSql(`WITH gone AS (DELETE FROM decision_event RETURNING 1) SELECT count(*) FROM gone`, []),
      'INVALID_SQL',
    )
  })

  it('cannot read outside the reporting schema', async () => {
    await expectRunError(runSql('SELECT * FROM public.users', []), 'PERMISSION')
    await expectRunError(
      runSql('SELECT conversation_id FROM public.conversations', []),
      'PERMISSION',
    )
  })

  it('stops a query at the timeout', async () => {
    const started = Date.now()
    await expectRunError(runSql('SELECT pg_sleep(5) AS slept', [], { timeoutMs: 250 }), 'TIMEOUT')
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('caps the rows at 50,000 and says so', async () => {
    const result = await runSql('SELECT g AS n FROM generate_series(1, 50010) AS g', [])
    expect(result.rowCount).toBe(50_000)
    expect(result.rows).toHaveLength(50_000)
    expect(result.truncated).toBe(true)
  })

  it('leaves the connection clean for the next run', async () => {
    await expectRunError(runSql('SELECT pg_sleep(5) AS slept', [], { timeoutMs: 250 }), 'TIMEOUT')
    // The reader pool has one connection, so this query reuses it.
    const { rows } = await reader.query(
      "SELECT current_setting('search_path') AS p, current_setting('statement_timeout') AS t, current_setting('transaction_read_only') AS ro",
    )
    expect(rows[0].p).not.toBe('reporting')
    expect(rows[0].t).not.toBe('250ms')
    expect(rows[0].ro).toBe('off')
  })

  it('refuses to run unless logged in as reporting_reader', async () => {
    await expectRunError(ownerRun('SELECT 1 AS one'), 'UNAVAILABLE')
  })

  it('cannot run several statements, even when the guard is fooled', async () => {
    // Review finding: `x$$` once hid these semicolons from the guard, and
    // the simple protocol ran each statement. Both layers now refuse.
    for (const sql of [
      'SELECT 1 AS x$$ ) AS r; SET statement_timeout = 0; SELECT pg_sleep(2); SELECT * FROM (SELECT 1 AS y$$',
      'SELECT 1 AS x$$ ) AS r; ROLLBACK; DELETE FROM public.users; SELECT * FROM (SELECT 1 AS y$$',
    ]) {
      await expectRunError(runSql(sql, [], { timeoutMs: 500 }), 'INVALID_SQL')
    }
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users')
    expect(rows[0].n).toBeGreaterThan(0)
  })

  it('cannot reach outside reporting through dynamic SQL', async () => {
    // Review finding: set_config and query_to_xml undid a SET ROLE. With the
    // reader as the login role there is nothing stronger to return to.
    await expectRunError(
      runSql(
        `SELECT query_to_xml('select set_con' || 'fig(''role'', ''none'', true)', false, false, '') AS a,
                query_to_xml('select email from public.users', false, false, '') AS b`,
        [],
      ),
      'PERMISSION',
    )
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
    const outcome = await run(users.operations, `${PREFIX}-scaled`, {
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
    const outcome = await run(users.readonly, `${PREFIX}-scaled`, {})
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
    const outcome = await run(users.operations, `${PREFIX}-scaled`, {
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
    const viewer = await run(users.operations, `${PREFIX}-scaled`, {
      parameters: { factor: 1 },
    })
    expect(viewer.status === 200 && viewer.body.rows[0].scaled).toBe(1)

    const viewerDraft = await run(users.operations, `${PREFIX}-scaled`, {
      parameters: { factor: 1 },
      draft: true,
    })
    expect(viewerDraft.status).toBe(403)

    const author = await run(users.admin, `${PREFIX}-scaled`, {
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
    const viewer = await run(users.operations, `${PREFIX}-sneaky`, {})
    expect(viewer.status).toBe(422)
    if (viewer.status === 422) {
      expect(viewer.body.error.code).toBe('PERMISSION')
      expect(viewer.body.error.detail).toBeUndefined()
    }
    const author = await run(users.admin, `${PREFIX}-sneaky`, {})
    expect(author.status === 422 && author.body.error.detail).toMatch(/permission denied/)
  })

  it('an unknown report is not found, and the attempt is logged', async () => {
    const outcome = await run(users.admin, `${PREFIX}-missing`, {})
    expect(outcome.status).toBe(404)
    const runs = await payload.find({
      collection: 'report-runs',
      where: { reportSlug: { equals: `${PREFIX}-missing` } },
      overrideAccess: true,
    })
    expect(runs.docs[0]).toMatchObject({ outcome: 'refused', errorCode: 'NOT_FOUND' })
  })

  it('a draft-only report is hidden from viewers and runnable by authors as a draft', async () => {
    await payload.create({
      collection: 'report-definitions',
      data: {
        title: 'Draft only',
        slug: `${PREFIX}-draftonly`,
        sql: 'SELECT $1::int AS n',
        parameters: [{ name: 'n', label: 'N', type: 'integer', default: 7 }],
        roles: ['operations'],
      },
      draft: true,
      overrideAccess: true,
    })
    const viewerList = await listReports(payload, users.operations)
    expect(viewerList.find((r) => r.slug === `${PREFIX}-draftonly`)).toBeUndefined()
    const viewer = await run(users.operations, `${PREFIX}-draftonly`, {})
    expect(viewer.status).toBe(404)

    const authorList = await listReports(payload, users.admin)
    const entry = authorList.find((r) => r.slug === `${PREFIX}-draftonly`)
    expect(entry).toMatchObject({ published: false, draft: { parameters: [{ name: 'n' }] } })
    const author = await run(users.admin, `${PREFIX}-draftonly`, { draft: true })
    expect(author).toMatchObject({ status: 200, body: { rows: [{ n: 7 }] } })
  })

  it('authors see the newer draft form of a published report', async () => {
    const list = await listReports(payload, users.admin)
    const scaled = list.find((r) => r.slug === `${PREFIX}-scaled`)
    // The draft saved earlier in this suite changed the SQL, not the form.
    expect(scaled).toMatchObject({ published: true, draft: { parameters: [{ name: 'factor' }] } })
    const forViewer = (await listReports(payload, users.operations)).find(
      (r) => r.slug === `${PREFIX}-scaled`,
    )
    expect(forViewer).not.toHaveProperty('draft')
  })

  it('logs only the declared parameters, cut short', async () => {
    await run(users.operations, `${PREFIX}-scaled`, {
      parameters: { factor: 'x'.repeat(500), extra: { nested: true } },
    })
    const runs = await payload.find({
      collection: 'report-runs',
      where: {
        and: [
          { reportSlug: { equals: `${PREFIX}-scaled` } },
          { errorCode: { equals: 'INVALID_PARAMETERS' } },
        ],
      },
      sort: '-createdAt',
      limit: 1,
      overrideAccess: true,
    })
    expect(runs.docs[0].parameters).toEqual({ factor: 'x'.repeat(100) })
  })

  it('a viewer cannot read report versions through the API', async () => {
    await expect(
      payload.findVersions({
        collection: 'report-definitions',
        overrideAccess: false,
        user: { ...users.operations, collection: 'users' } as never,
      }),
    ).rejects.toThrow()
  })
})
