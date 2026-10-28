// @vitest-environment node
/**
 * Integration coverage for the MCP connector's database role (ADR 0002).
 *
 * Runs against the real Postgres from tests/utils/globalSetup.ts, logged in
 * as `reporting_mcp_reader` exactly as REPORTING_MCP_DATABASE_URI is in a
 * deployed environment. Proves that the restricted columns (PEP, sanctions,
 * vulnerability, fraud, kill reasons) cannot be read in any part of a query,
 * that every other described column can, that identity-category reasons are
 * generalised for this login only, and that the summary views hide small
 * counts. TEST data only.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import type { Pool } from 'pg'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { reportingMcpReaderPool, reportingReaderPool } from '../utils/reportingReader'
import { MCP_READER_ROLE, ReportRunError, runReportSql } from '@/server/reporting/runner'
import { REPORTING_TABLES, RESTRICTED_COLUMNS } from '@/server/reporting/schema-description'

const P = 'TEST-ADR0002'
let payload: Payload
/** Payload's owner pool, for set-up. */
let pool: Pool
let reader: Pool
let mcpReader: Pool

const asMcp = (sql: string, values: unknown[] = []) =>
  runReportSql(sql, values, { pool: mcpReader, role: MCP_READER_ROLE })
const asReader = (sql: string, values: unknown[] = []) =>
  runReportSql(sql, values, { pool: reader })

async function expectPermissionError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ReportRunError)
  expect((error as ReportRunError).code).toBe('PERMISSION')
}

const RESTRICTED = Object.entries(RESTRICTED_COLUMNS).flatMap(([table, columns]) =>
  columns.map((column) => ({ table, column })),
)

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as unknown as Pool
  reader = await reportingReaderPool(pool)
  mcpReader = await reportingMcpReaderPool(pool)
  await pool.query(`DELETE FROM reporting.decision_event WHERE conversation_id LIKE '${P}%'`)
  for (const [suffix, reason] of [
    ['pep', 'CREDIT_ASSESSMENT:PEP'],
    ['idv', 'CREDIT_ASSESSMENT:ID_VERIFICATION'],
    ['svc', 'CREDIT_ASSESSMENT:SERVICEABILITY'],
    ['blk', 'REAPPLICATION_BLOCK:PEP'],
  ]) {
    await pool.query(
      `INSERT INTO reporting.decision_event (decision_key, conversation_id, decision, reason, decided_at)
       VALUES ($1, $2, 'DECLINED', $3, '2001-05-02T03:00:00Z')`,
      [`${P}-${suffix}`, `${P}-${suffix}`, reason],
    )
  }
}, 60_000)

afterAll(async () => {
  await pool.query(`DELETE FROM reporting.decision_event WHERE conversation_id LIKE '${P}%'`)
  await reader?.end()
  await mcpReader?.end()
})

describe('the restricted columns', () => {
  it('are listed for columns that exist', () => {
    for (const { table, column } of RESTRICTED) {
      const described = REPORTING_TABLES.find((t) => t.name === table)
      expect(
        described?.columns.map((c) => c.name),
        `${table}.${column}`,
      ).toContain(column)
    }
  })

  it('cover every column whose name points at a restricted finding', () => {
    // A guard against adding, say, `fraud_reason` and forgetting to restrict
    // it. A name listed here was reviewed and is open on purpose.
    const reviewedOpen = new Set(['application.fraud_turns_assessed'])
    const pattern = /(pep|sanction|screening|vulnerab|fraud|kill_reason|killed_by)/i
    for (const table of REPORTING_TABLES) {
      if (table.name.endsWith('_summary')) continue
      for (const c of table.columns) {
        const key = `${table.name}.${c.name}`
        if (!pattern.test(c.name) || reviewedOpen.has(key)) continue
        expect(RESTRICTED_COLUMNS[table.name] ?? [], key).toContain(c.name)
      }
    }
  })

  it.each(RESTRICTED)(
    '$table.$column cannot be selected, aliased or counted',
    async ({ table, column }) => {
      await expectPermissionError(asMcp(`SELECT "${column}" FROM ${table} LIMIT 1`))
      await expectPermissionError(asMcp(`SELECT "${column}" AS x FROM ${table} LIMIT 1`))
      await expectPermissionError(asMcp(`SELECT count("${column}") AS n FROM ${table}`))
      await expectPermissionError(asMcp(`SELECT * FROM ${table} LIMIT 1`))
    },
  )

  it.each(RESTRICTED)(
    '$table.$column cannot be filtered, sorted, grouped or joined on',
    async ({ table, column }) => {
      await expectPermissionError(
        asMcp(`SELECT count(*) AS n FROM ${table} WHERE "${column}" IS NOT NULL`),
      )
      await expectPermissionError(asMcp(`SELECT 1 AS x FROM ${table} ORDER BY "${column}" LIMIT 1`))
      await expectPermissionError(asMcp(`SELECT count(*) AS n FROM ${table} GROUP BY "${column}"`))
      await expectPermissionError(
        asMcp(
          `WITH t AS (SELECT "${column}" AS v FROM ${table}) SELECT count(*) AS n FROM t WHERE v IS NOT NULL`,
        ),
      )
      await expectPermissionError(
        asMcp(
          `SELECT count(*) AS n FROM ${table} a JOIN ${table} b ON a."${column}" = b."${column}"`,
        ),
      )
    },
  )

  it('stay readable as reporting_reader, for the Reports view and reviewed reports', async () => {
    for (const { table, column } of RESTRICTED) {
      await expect(asReader(`SELECT "${column}" FROM ${table} LIMIT 1`)).resolves.toBeTruthy()
    }
  })
})

describe('every other column', () => {
  it.each(REPORTING_TABLES.map((t) => ({ table: t.name })))(
    '$table: the open columns can be selected',
    async ({ table }) => {
      const open = REPORTING_TABLES.find((t) => t.name === table)!
        .columns.filter((c) => !(RESTRICTED_COLUMNS[table] ?? []).includes(c.name))
        .map((c) => `"${c.name}"`)
      const result = await asMcp(`SELECT ${open.join(', ')} FROM ${table} LIMIT 1`)
      expect(result.columns).toHaveLength(open.length)
    },
  )

  it('nothing outside the reporting schema', async () => {
    await expectPermissionError(asMcp('SELECT count(*) AS n FROM public.conversations'))
    await expectPermissionError(asMcp('SELECT count(*) AS n FROM public.customers'))
  })
})

describe('decline and block reasons', () => {
  const reasons = (run: typeof asMcp) =>
    run(`SELECT conversation_id, reason FROM decision WHERE conversation_id LIKE $1 ORDER BY 1`, [
      `${P}%`,
    ]).then((r) => Object.fromEntries(r.rows.map((x) => [x.conversation_id, x.reason])))

  it('read as one generic identity code for the connector, so a PEP decline is not told apart', async () => {
    expect(await reasons(asMcp)).toEqual({
      [`${P}-blk`]: 'REAPPLICATION_BLOCK:IDENTITY',
      [`${P}-idv`]: 'CREDIT_ASSESSMENT:IDENTITY',
      [`${P}-pep`]: 'CREDIT_ASSESSMENT:IDENTITY',
      [`${P}-svc`]: 'CREDIT_ASSESSMENT:SERVICEABILITY',
    })
    // Filtering on the raw code finds nothing.
    const filtered = await asMcp(
      `SELECT count(*) AS n FROM decision WHERE conversation_id LIKE $1 AND reason LIKE '%PEP%'`,
      [`${P}%`],
    )
    expect(filtered.rows[0].n).toBe(0)
    // The category is unchanged: identity either way.
    const categories = await asMcp(
      `SELECT DISTINCT decline_category FROM decision WHERE conversation_id IN ($1, $2)`,
      [`${P}-pep`, `${P}-idv`],
    )
    expect(categories.rows).toEqual([{ decline_category: 'identity' }])
  })

  it('read as recorded for reporting_reader', async () => {
    expect(await reasons(asReader)).toMatchObject({
      [`${P}-pep`]: 'CREDIT_ASSESSMENT:PEP',
      [`${P}-blk`]: 'REAPPLICATION_BLOCK:PEP',
    })
  })

  it('a PEP block reads IDENTITY for the connector', async () => {
    const sql = `SELECT reporting.block_reason_for_session('PEP') AS pep,
                        reporting.block_reason_for_session('ACTIVE_LOAN') AS active`
    expect((await asMcp(sql)).rows[0]).toEqual({ pep: 'IDENTITY', active: 'ACTIVE_LOAN' })
    expect((await asReader(sql)).rows[0]).toEqual({ pep: 'PEP', active: 'ACTIVE_LOAN' })
  })
})

describe('the summary views', () => {
  it('hide a count from 1 to 4', async () => {
    const { rows } = await asMcp(
      `SELECT reporting.suppress_small(0) AS zero, reporting.suppress_small(1) AS one,
              reporting.suppress_small(4) AS four, reporting.suppress_small(5) AS five`,
    )
    expect(rows[0]).toEqual({ zero: 0, one: null, four: null, five: 5 })
  })

  it('can be read by the connector', async () => {
    await expect(
      asMcp('SELECT sum(applications) AS n, sum(pep_hits) AS pep FROM restricted_finding_summary'),
    ).resolves.toBeTruthy()
    await expect(
      asMcp('SELECT sum(customers) AS n, sum(vulnerable) AS v FROM customer_risk_summary'),
    ).resolves.toBeTruthy()
  })
})
