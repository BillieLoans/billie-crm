/**
 * The report runner (BTB-506): the one path every report query takes, for
 * published reports, drafts and ad-hoc test queries alike.
 *
 * Each run:
 *  - passes the static check in `sql-guard.ts` (for a clear message only);
 *  - checks it is logged in as `reporting_reader`, which can read the
 *    `reporting` schema and nothing else (granted by `schema.ts`), or for
 *    the MCP connector's ad-hoc queries as `reporting_mcp_reader`, which
 *    also cannot read the restricted columns (ADR 0002). The login role is
 *    the control: a session that could `SET ROLE` back to a stronger role
 *    would let one SELECT undo the isolation;
 *  - opens a READ ONLY transaction with a statement timeout and
 *    `search_path = reporting`;
 *  - sends the query with the extended protocol, so Postgres refuses a
 *    second statement, and binds parameters as `$1..$n`;
 *  - wraps the SQL as a subquery with a row cap, which also makes a
 *    data-modifying CTE an error;
 *  - always rolls back.
 *
 * It connects with `REPORTING_DATABASE_URI` (`REPORTING_MCP_DATABASE_URI`
 * for the connector's ad-hoc queries), in every environment: in deployed
 * ones the Neon read replica. See docs/reporting.md for the roles.
 */
import type { Pool, PoolClient, QueryConfig, QueryResult } from 'pg'
import type { ReportColumn } from '@/lib/schemas/reports'
import { checkReportSql } from './sql-guard'

export const ROW_CAP = 50_000
export const STATEMENT_TIMEOUT_MS = 15_000
export const READER_ROLE = 'reporting_reader'
/** The MCP connector's ad-hoc query role: no restricted columns (ADR 0002). */
export const MCP_READER_ROLE = 'reporting_mcp_reader'

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
  /** The login the pool must be connected as. Default `reporting_reader`. */
  role?: string
  timeoutMs?: number
  rowCap?: number
}

/** Pools by purpose: which connection string, which login, how many connections. */
const POOL_SETUP = {
  reports: { env: 'REPORTING_DATABASE_URI', role: READER_ROLE, max: 4 },
  // Published reports run over MCP: the reader, in a smaller pool.
  mcp: { env: 'REPORTING_DATABASE_URI', role: READER_ROLE, max: 2 },
  // Ad-hoc queries over MCP, and published reports not allowed restricted columns.
  'mcp-query': { env: 'REPORTING_MCP_DATABASE_URI', role: MCP_READER_ROLE, max: 2 },
} as const

export type PoolPurpose = keyof typeof POOL_SETUP

/** The login a purpose's pool connects as, for `RunOptions.role`. */
export const roleFor = (purpose: PoolPurpose): string => POOL_SETUP[purpose].role

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

const pools = new Map<string, Promise<Pool>>()

/**
 * The pool for the reporting connection, created once per purpose on first
 * use, and again if it has been closed. The MCP connector (BTB-509) has its
 * own, smaller pools, so an agent running queries cannot hold every
 * connection the Reports view and the scheduled jobs need.
 */
export async function getReportingPool(purpose: PoolPurpose = 'reports'): Promise<Pool> {
  const setup = POOL_SETUP[purpose]
  const connectionString = process.env[setup.env]
  if (!connectionString) {
    throw new ReportRunError(
      'UNAVAILABLE',
      purpose === 'mcp-query'
        ? 'Queries over the Claude connector are not set up in this environment.'
        : 'Reporting is not configured in this environment',
    )
  }
  const existing = pools.get(purpose)
  if (existing && !(await existing).ended) return existing
  const pool = import('pg').then(({ Pool: PgPool }) => {
    const created = new PgPool({
      connectionString,
      max: setup.max,
      idleTimeoutMillis: 30_000,
    })
    // An idle client dropped by the server (a replica restart, a network
    // blip) emits 'error' on the pool; unhandled, it would crash the process.
    created.on('error', (error) =>
      console.error('[reports] idle reporting connection failed:', error),
    )
    return created
  })
  pools.set(purpose, pool)
  return pool
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
      const role = options.role ?? READER_ROLE
      const login = await client.query<{ u: string }>('SELECT session_user AS u')
      if (login.rows[0]?.u !== role) {
        throw new Error(`connected as ${login.rows[0]?.u ?? 'unknown'}, not ${role}`)
      }
      await client.query('BEGIN READ ONLY')
      await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`)
      await client.query('SET LOCAL search_path = reporting')
    } catch (error) {
      // Usually: REPORTING_DATABASE_URI (or REPORTING_MCP_DATABASE_URI) logs
      // in as another role. See docs/reporting.md, "Roles and grants".
      throw new ReportRunError(
        'UNAVAILABLE',
        'Reporting access is not set up in this environment.',
        (error as Error)?.message,
      )
    }
    // The newlines keep a trailing `--` comment from swallowing the wrapper.
    const query: QueryConfig & { queryMode: 'extended' } = {
      text: `SELECT * FROM (\n${check.sql}\n) AS report LIMIT ${rowCap + 1}`,
      values: [...values],
      types: typeParsers,
      // Always the extended protocol, even with no parameters: the simple
      // protocol would run `...; SET statement_timeout = 0; ...` as several
      // statements. (pg reads queryMode; @types/pg does not declare it.)
      queryMode: 'extended',
    }
    const result: QueryResult<Record<string, unknown>> = await client.query(query)
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
