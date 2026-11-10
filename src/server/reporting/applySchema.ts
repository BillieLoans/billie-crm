import { sql } from '@payloadcms/db-postgres'

import { REPORTING_SCHEMA_STATEMENTS } from './schema'

/**
 * Applying the reporting schema from a migration (BTB-534).
 *
 * `REPORTING_SCHEMA_STATEMENTS` always describes the CURRENT reporting views.
 * Every migration that changes them re-applies the whole list, which is right
 * for a database that has run the earlier migrations. On an empty database it
 * is not: an older migration then creates today's views before the migrations
 * that add the columns those views read have run, and `payload migrate` fails
 * (`column la.cancellation_reason does not exist`).
 *
 * So only the newest migration that applies the schema must succeed. An older
 * one applies it inside a savepoint and, if the database is not yet far enough
 * along for today's views, rolls that back and leaves the views to a later
 * migration. On a database that is far enough along it behaves as before.
 */

/**
 * The newest migration that applies the reporting schema. It applies the
 * statements strictly: any failure fails the migration.
 *
 * When you add a migration that calls `applyReportingSchema`, set this to its
 * name. `tests/unit/migrations/reporting-schema-migrations.test.ts` fails
 * until you do.
 */
export const LATEST_REPORTING_SCHEMA_MIGRATION = '20261103_090000_loan_account_cancellation'

/**
 * SQLSTATEs that mean "this database does not have something today's views
 * need yet": undefined_column, undefined_table, undefined_object (a type or a
 * role) and undefined_function. Anything else is a real error and is raised.
 */
const SCHEMA_BEHIND_CODES = new Set(['42703', '42P01', '42704', '42883'])

const SAVEPOINT = 'reporting_schema_apply'

/** The slice of the migration's `db` this helper uses. */
type MigrationDb = { execute: (query: ReturnType<typeof sql.raw>) => Promise<unknown> }

/** The Postgres SQLSTATE of an error, looking through driver wrappers. */
export function sqlStateOf(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

/**
 * Apply the current reporting schema from the migration named `migration`.
 *
 * Returns `true` when the statements were applied, `false` when an older
 * migration skipped them because the database is not far enough along yet.
 */
export async function applyReportingSchema(db: MigrationDb, migration: string): Promise<boolean> {
  if (migration === LATEST_REPORTING_SCHEMA_MIGRATION) {
    for (const statement of REPORTING_SCHEMA_STATEMENTS) {
      await db.execute(sql.raw(statement))
    }
    return true
  }

  await db.execute(sql.raw(`SAVEPOINT ${SAVEPOINT}`))
  try {
    for (const statement of REPORTING_SCHEMA_STATEMENTS) {
      await db.execute(sql.raw(statement))
    }
  } catch (error) {
    const code = sqlStateOf(error)
    if (!code || !SCHEMA_BEHIND_CODES.has(code)) throw error
    await db.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`))
    await db.execute(sql.raw(`RELEASE SAVEPOINT ${SAVEPOINT}`))
    console.log(
      `[migrate] ${migration}: reporting schema not applied yet (SQLSTATE ${code}); ` +
        `${LATEST_REPORTING_SCHEMA_MIGRATION} applies it.`,
    )
    return false
  }
  await db.execute(sql.raw(`RELEASE SAVEPOINT ${SAVEPOINT}`))
  return true
}

/**
 * Columns of the report-definitions collection that were added by a migration
 * LATER than a migration that writes reports through the Local API (BTB-534).
 *
 * The Local API reads and writes every column of the current config, so on an
 * empty database `20261026_100000_first_reports` and `20261030_170000_core_reports`
 * fail unless these exist. Each statement is the same idempotent `ADD COLUMN
 * IF NOT EXISTS` its own migration runs, so that migration is then a no-op.
 *
 * When you add a column to report-definitions, add its statements here too.
 */
const REPORT_DEFINITION_COLUMNS_ADDED_LATER = [
  // 20261102_090000_mcp_restricted_columns
  `ALTER TABLE report_definitions ADD COLUMN IF NOT EXISTS mcp_restricted_access boolean DEFAULT false`,
  `ALTER TABLE _report_definitions_v ADD COLUMN IF NOT EXISTS version_mcp_restricted_access boolean DEFAULT false`,
]

/** Run before a migration writes report definitions through the Local API. */
export async function ensureReportDefinitionColumns(db: MigrationDb): Promise<void> {
  for (const statement of REPORT_DEFINITION_COLUMNS_ADDED_LATER) {
    await db.execute(sql.raw(statement))
  }
}
