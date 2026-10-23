import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

import { REPORTING_SCHEMA_STATEMENTS } from '../server/reporting/schema'

/**
 * Adds reporting.data_freshness, which the Reports view shows beside each
 * result ("Data to 10:29 today"). Re-applies the current schema
 * statements, which are idempotent and recreate every view.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of REPORTING_SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement))
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(`DROP VIEW IF EXISTS reporting.data_freshness`))
}
