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

describe('cancelled loans (BTB-517)', () => {
  // `cancellation_reason = 'fraud_hold'` names fraud by value, on a loan row
  // that joins to the customer: the same disclosure as `kill_reason`. The
  // generic restricted-column cases above cover it because it is listed; these
  // say why, and pin that the dates stay open.
  const LOAN = `${P}-LOAN`

  beforeAll(async () => {
    await pool.query('DELETE FROM loan_accounts WHERE loan_account_id = $1', [LOAN])
    await pool.query(
      `INSERT INTO loan_accounts
         (loan_account_id, account_number, account_status, cancellation_reason,
          cancellation_cancelled_at)
       VALUES ($1, $2, 'cancelled', 'fraud_hold', '2026-10-30T22:30:00Z')`,
      [LOAN, `${P}-1`],
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM loan_accounts WHERE loan_account_id = $1', [LOAN])
  })

  it('lists the cancellation reason as restricted', () => {
    expect(RESTRICTED_COLUMNS.loan).toContain('cancellation_reason')
  })

  it('does not let the connector read, or probe for, why a loan was cancelled', async () => {
    await expectPermissionError(
      asMcp('SELECT cancellation_reason FROM loan WHERE loan_account_id = $1', [LOAN]),
    )
    // Filtering on the value is as revealing as reading it.
    await expectPermissionError(
      asMcp(`SELECT count(*) AS n FROM loan WHERE cancellation_reason = 'fraud_hold'`),
    )
    await expectPermissionError(asMcp('SELECT * FROM loan WHERE loan_account_id = $1', [LOAN]))
  })

  it('still shows the connector that, and when, the loan was cancelled', async () => {
    const { rows } = await asMcp(
      `SELECT account_status, cancelled_at, cancelled_on::text AS cancelled_on
         FROM loan WHERE loan_account_id = $1`,
      [LOAN],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].account_status).toBe('cancelled')
    expect(new Date(rows[0].cancelled_at).toISOString()).toBe('2026-10-30T22:30:00.000Z')
    // 22:30Z on 30 Oct is the morning of 31 Oct in Sydney.
    expect(rows[0].cancelled_on).toBe('2026-10-31')
  })

  it('stays readable as reporting_reader for reviewed reports', async () => {
    const { rows } = await asReader(
      'SELECT cancellation_reason FROM loan WHERE loan_account_id = $1',
      [LOAN],
    )
    expect(rows).toEqual([{ cancellation_reason: 'fraud_hold' }])
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
  it('hide a count that could single out a person', async () => {
    const { rows } = await asMcp(
      `SELECT reporting.suppress_small(0, 20) AS none_of_many,
              reporting.suppress_small(3, 20) AS few,
              reporting.suppress_small(10, 20) AS half,
              reporting.suppress_small(17, 20) AS all_but_few,
              reporting.suppress_small(20, 20) AS all_of_them,
              reporting.suppress_small(0, 3) AS none_of_few`,
    )
    expect(rows[0]).toEqual({
      none_of_many: 0,
      few: null,
      half: 10,
      all_but_few: null,
      // Every member has it: as identifying as 1 of 1.
      all_of_them: null,
      // In a group under 5, even a zero says something about each member.
      none_of_few: null,
    })
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
