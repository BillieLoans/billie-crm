/**
 * Keeps the Ask Claude schema description in step with the reporting
 * schema (BTB-508). Fails when a reporting table or column exists in the
 * database but is not described, or is described but no longer exists, so
 * a schema change cannot ship without updating
 * src/server/reporting/schema-description.ts.
 */
import { getPayload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, expect } from 'vitest'
import { getDashboardPool, type QueryablePool } from '@/lib/dashboard-aggregates'
import { REPORTING_TABLES } from '@/server/reporting/schema-description'

let pool: QueryablePool

beforeAll(async () => {
  const payload = await getPayload({ config })
  pool = getDashboardPool(payload) as QueryablePool
})

describe('reporting schema description', () => {
  it('describes every reporting table and column, and nothing else', async () => {
    const { rows } = await pool.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'reporting'
        ORDER BY table_name, ordinal_position`,
    )
    const actual: Record<string, string[]> = {}
    for (const r of rows) {
      ;(actual[r.table_name as string] ??= []).push(r.column_name as string)
    }
    const described = Object.fromEntries(
      REPORTING_TABLES.map((t) => [t.name, t.columns.map((c) => c.name)]),
    )
    expect(Object.keys(described).sort()).toEqual(Object.keys(actual).sort())
    for (const table of Object.keys(actual)) {
      expect({ table, columns: described[table] }).toEqual({ table, columns: actual[table] })
    }
  })

  it('gives every column a meaning', () => {
    for (const t of REPORTING_TABLES) {
      expect(t.grain.length).toBeGreaterThan(10)
      for (const c of t.columns) expect(c.meaning.length, `${t.name}.${c.name}`).toBeGreaterThan(5)
    }
  })
})
