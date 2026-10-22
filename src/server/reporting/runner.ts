/**
 * The report runner (BTB-506): the one path every report query takes, for
 * published reports, drafts and ad-hoc test queries alike.
 *
 * Each run:
 *  - passes the static check in `sql-guard.ts`;
 *  - opens a READ ONLY transaction and switches to `reporting_reader`, which
 *    can read the `reporting` schema and nothing else (granted by the schema
 *    script in `schema.ts`);
 *  - sets a statement timeout and `search_path = reporting`;
 *  - binds parameters as `$1..$n`;
 *  - wraps the SQL as a subquery with a row cap, which also makes a second
 *    statement or a data-modifying CTE a Postgres error;
 *  - always rolls back.
 *
 * It connects with `REPORTING_DATABASE_URI`: in deployed environments the
 * Neon read replica, logged in as `reporting_reader` (enforced). Dev and
 * test fall back to `DATABASE_URI` and rely on `SET LOCAL ROLE`, which the
 * guard backs by refusing `set_config`.
 */
import type { Pool, PoolClient, QueryResult } from 'pg'
import type { ReportColumn } from '@/lib/schemas/reports'
import { checkReportSql } from './sql-guard'

export const ROW_CAP = 50_000
export const STATEMENT_TIMEOUT_MS = 15_000
export const READER_ROLE = 'reporting_reader'

export type ReportRunErrorCode =
  | 'INVALID_SQL'
  | 'TIMEOUT'
  | 'PERMISSION'
  | 'QUERY_FAILED'
  | 'UNAVAILABLE'

/** A run that did not produce rows. `detail` is the Postgres message, for authors only. */
export class ReportRunError extends Error {
  constructor(
    readonly code: ReportRunErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'ReportRunError'
  }
}

export interface ReportRunResult {
  columns: ReportColumn[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  /** True when the query returned more than the cap and rows were cut. */
  truncated: boolean
  durationMs: number
}

export interface RunOptions {
  pool?: Pick<Pool, 'connect'>
  timeoutMs?: number
  rowCap?: number
}

// Postgres type OIDs the view formats specially.
const OID = {
  bool: 16,
  int8: 20,
  int2: 21,
  int4: 23,
  float4: 700,
  float8: 701,
  numeric: 1700,
  date: 1082,
  timestamp: 1114,
  timestamptz: 1184,
} as const

function kindOf(oid: number): ReportColumn['kind'] {
  switch (oid) {
    case OID.int2:
    case OID.int4:
    case OID.int8:
    case OID.float4:
    case OID.float8:
    case OID.numeric:
      return 'number'
    case OID.date:
      return 'date'
    case OID.timestamp:
    case OID.timestamptz:
      return 'datetime'
    case OID.bool:
      return 'boolean'
    default:
      return 'text'
  }
}

/** A numeric string as a number, or the string when a number would lose digits. */
function toNumber(text: string): number | string {
  const n = Number(text)
  if (!Number.isFinite(n)) return text
  if (Number.isInteger(n) && !Number.isSafeInteger(n)) return text
  return n
}

/**
 * Parse values for JSON: numbers as numbers, dates as `YYYY-MM-DD` (never a
 * JavaScript Date, which would shift with the server's time zone),
 * timestamps as ISO 8601 UTC.
 */
const typeParsers = {
  getTypeParser: (oid: number) => {
    switch (oid) {
      case OID.int2:
      case OID.int4:
      case OID.int8:
      case OID.float4:
      case OID.float8:
      case OID.numeric:
        return toNumber
      case OID.bool:
        return (text: string) => text === 't'
      case OID.date:
        return (text: string) => text
      case OID.timestamptz:
        return (text: string) => new Date(text).toISOString()
      case OID.timestamp:
        return (text: string) => text.replace(' ', 'T')
      case 114: // json
      case 3802: // jsonb
        return (text: string) => JSON.parse(text) as unknown
      default:
        return (text: string) => text
    }
  },
}

let sharedPool: Pool | undefined

/** The pool for the reporting connection, created on first use. */
export async function getReportingPool(): Promise<Pool> {
  if (sharedPool) return sharedPool
  const connectionString =
    process.env.REPORTING_DATABASE_URI ||
    (process.env.NODE_ENV !== 'production' ? process.env.DATABASE_URI : undefined)
  if (!connectionString) {
    throw new ReportRunError('UNAVAILABLE', 'Reporting is not configured in this environment')
  }
  const { Pool: PgPool } = await import('pg')
  sharedPool = new PgPool({ connectionString, max: 4, idleTimeoutMillis: 30_000 })
  return sharedPool
}

function classify(error: unknown, timeoutMs: number): ReportRunError {
  const pgError = error as { code?: string; message?: string }
  const detail = pgError?.message
  switch (pgError?.code) {
    case '57014':
      return new ReportRunError(
        'TIMEOUT',
        `The report took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped. Narrow the date range or simplify the query.`,
        detail,
      )
    case '42501':
      return new ReportRunError(
        'PERMISSION',
        'The query reads something outside the reporting schema.',
        detail,
      )
    case '25006': // read_only_sql_transaction
    case '0A000': // feature_not_supported: e.g. a data-modifying CTE in the wrapper
      return new ReportRunError('INVALID_SQL', 'Reports can only read data.', detail)
    default:
      if (pgError?.code?.startsWith('42') || pgError?.code?.startsWith('22')) {
        return new ReportRunError('INVALID_SQL', 'The query is not valid.', detail)
      }
      return new ReportRunError('QUERY_FAILED', 'The report could not be run.', detail)
  }
}

/**
 * Run report SQL with bound parameters and return the rows.
 *
 * @throws ReportRunError for invalid SQL, a timeout, a permission failure or
 *   any other database error.
 */
export async function runReportSql(
  sql: string,
  values: readonly unknown[],
  options: RunOptions = {},
): Promise<ReportRunResult> {
  const check = checkReportSql(sql)
  if (!check.ok) throw new ReportRunError('INVALID_SQL', check.error)

  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? STATEMENT_TIMEOUT_MS))
  const rowCap = Math.max(1, Math.floor(options.rowCap ?? ROW_CAP))
  const pool = options.pool ?? (await getReportingPool())

  const started = performance.now()
  let client: PoolClient | undefined
  let broken = false
  try {
    client = (await pool.connect()) as PoolClient
    try {
      await client.query('BEGIN READ ONLY')
      if (process.env.NODE_ENV === 'production') {
        // In deployed environments isolation rests on the login role, not
        // on SET ROLE, which a member of a stronger role could undo.
        const login = await client.query<{ u: string }>('SELECT session_user AS u')
        if (login.rows[0]?.u !== READER_ROLE) {
          throw new Error(`connected as ${login.rows[0]?.u ?? 'unknown'}, not ${READER_ROLE}`)
        }
      }
      await client.query(`SET LOCAL ROLE ${READER_ROLE}`)
      await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`)
      await client.query('SET LOCAL search_path = reporting')
    } catch (error) {
      // Usually: the role does not exist, or the connecting role is not a
      // member of it. See docs/reporting.md, "Roles and grants".
      throw new ReportRunError(
        'UNAVAILABLE',
        'Reporting access is not set up in this environment.',
        (error as Error)?.message,
      )
    }
    // The newlines keep a trailing `--` comment from swallowing the wrapper.
    const result: QueryResult<Record<string, unknown>> = await client.query({
      text: `SELECT * FROM (\n${check.sql}\n) AS report LIMIT ${rowCap + 1}`,
      values: [...values],
      types: typeParsers,
    })
    await client.query('ROLLBACK')
    const truncated = result.rows.length > rowCap
    const rows = truncated ? result.rows.slice(0, rowCap) : result.rows
    return {
      columns: result.fields.map((f) => ({ name: f.name, kind: kindOf(f.dataTypeID) })),
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: Math.round(performance.now() - started),
    }
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {
        broken = true
      })
    }
    if (error instanceof ReportRunError) throw error
    if (!client) {
      throw new ReportRunError('UNAVAILABLE', 'The reporting database is not reachable.')
    }
    throw classify(error, timeoutMs)
  } finally {
    client?.release(broken)
  }
}
