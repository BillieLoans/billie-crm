import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  LATEST_REPORTING_SCHEMA_MIGRATION,
  applyReportingSchema,
  sqlStateOf,
} from '@/server/reporting/applySchema'
import { REPORTING_SCHEMA_STATEMENTS } from '@/server/reporting/schema'

/**
 * BTB-534: `payload migrate` on an empty database. Older migrations apply
 * today's reporting views before the migrations that add the columns those
 * views read, so they must be able to stand aside; the newest one must not.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../src/migrations')
const OLDER = '20261023_090000_reporting_schema'

/** The raw SQL text of a drizzle `sql.raw(...)` object. */
function textOf(query: unknown): string {
  const chunks = (query as { queryChunks?: Array<{ value?: string[] }> }).queryChunks ?? []
  return chunks.map((chunk) => (chunk.value ?? []).join('')).join('')
}

/** A `db` that records what it ran and fails on the statement at `failAt`. */
function fakeDb(failAt: number | null, error?: unknown) {
  const ran: string[] = []
  let statements = 0
  const execute = vi.fn(async (query: unknown) => {
    const text = textOf(query)
    ran.push(text)
    if (/SAVEPOINT/.test(text)) return
    statements += 1
    if (failAt !== null && statements === failAt) throw error
  })
  return { db: { execute }, ran }
}

function pgError(code: string, message: string): Error {
  // The shape drizzle raises: the driver's error is the `cause`.
  return Object.assign(new Error('Failed query'), {
    cause: Object.assign(new Error(message), { code }),
  })
}

describe('sqlStateOf', () => {
  it('reads the SQLSTATE through the query wrapper', () => {
    expect(sqlStateOf(pgError('42703', 'column la.cancellation_reason does not exist'))).toBe(
      '42703',
    )
  })

  it('is undefined for an error with no SQLSTATE', () => {
    expect(sqlStateOf(new Error('socket hang up'))).toBeUndefined()
    expect(sqlStateOf(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBeUndefined()
    expect(sqlStateOf(undefined)).toBeUndefined()
  })
})

describe('applyReportingSchema', () => {
  it('applies every statement when the database is far enough along', async () => {
    const { db, ran } = fakeDb(null)

    await expect(applyReportingSchema(db, OLDER)).resolves.toBe(true)

    const statements = ran.filter((text) => !/SAVEPOINT/.test(text))
    expect(statements).toEqual([...REPORTING_SCHEMA_STATEMENTS])
    expect(ran[0]).toMatch(/^SAVEPOINT /)
    expect(ran[ran.length - 1]).toMatch(/^RELEASE SAVEPOINT /)
  })

  it.each(['42703', '42P01', '42704', '42883'])(
    'an older migration stands aside when the database is behind (SQLSTATE %s)',
    async (code) => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { db, ran } = fakeDb(3, pgError(code, 'missing'))

      await expect(applyReportingSchema(db, OLDER)).resolves.toBe(false)

      // Whatever it had applied is undone, so the transaction is still usable.
      expect(ran.slice(-2)).toEqual([
        expect.stringMatching(/^ROLLBACK TO SAVEPOINT /),
        expect.stringMatching(/^RELEASE SAVEPOINT /),
      ])
      expect(log).toHaveBeenCalledWith(expect.stringContaining(OLDER))
      log.mockRestore()
    },
  )

  it('an older migration still fails on any other error', async () => {
    const syntaxError = pgError('42601', 'syntax error at or near "VIEW"')
    const { db, ran } = fakeDb(3, syntaxError)

    await expect(applyReportingSchema(db, OLDER)).rejects.toBe(syntaxError)
    expect(ran.some((text) => /^ROLLBACK TO SAVEPOINT/.test(text))).toBe(false)
  })

  it('the newest migration never stands aside', async () => {
    const missingColumn = pgError('42703', 'column la.cancellation_reason does not exist')
    const { db, ran } = fakeDb(3, missingColumn)

    await expect(applyReportingSchema(db, LATEST_REPORTING_SCHEMA_MIGRATION)).rejects.toBe(
      missingColumn,
    )
    expect(ran.some((text) => /SAVEPOINT/.test(text))).toBe(false)
  })
})

describe('reporting schema migrations', () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.ts') && file !== 'index.ts')
    .sort()
  const source = (file: string) => readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')

  it('no migration applies the live statements directly', () => {
    // Importing REPORTING_SCHEMA_STATEMENTS into a migration is what broke a
    // fresh database: use applyReportingSchema(db, '<migration name>').
    const direct = files.filter((file) => source(file).includes('REPORTING_SCHEMA_STATEMENTS'))
    expect(direct).toEqual([])
  })

  it('each migration uses the migration helper and passes its own name', () => {
    for (const file of files) {
      const text = source(file)
      const calls = text.match(/applyReportingSchema\(/g) ?? []
      if (calls.length === 0) continue
      // schema.ts exports an unrelated one-argument applyReportingSchema.
      expect(text, file).toContain("from '../server/reporting/applySchema'")
      // Every call is the literal form with this file's own name.
      const named = [...text.matchAll(/applyReportingSchema\(db, '([^']+)'\)/g)]
      expect(named.length, file).toBe(calls.length)
      for (const call of named) {
        expect(call[1]).toBe(file.replace(/\.ts$/, ''))
      }
    }
  })

  it('LATEST_REPORTING_SCHEMA_MIGRATION is the newest one that applies the schema', () => {
    const applying = files.filter((file) => source(file).includes('applyReportingSchema('))
    expect(applying.length).toBeGreaterThan(0)
    expect(LATEST_REPORTING_SCHEMA_MIGRATION).toBe(
      applying[applying.length - 1].replace(/\.ts$/, ''),
    )
  })
})
