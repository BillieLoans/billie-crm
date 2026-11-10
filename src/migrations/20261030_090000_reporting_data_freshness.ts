import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

import { applyReportingSchema } from '../server/reporting/applySchema'

/**
 * Adds reporting.data_freshness, which the Reports view shows beside each
 * result ("Data to 10:29 today"). Re-applies the current schema
 * statements, which are idempotent and recreate every view.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await applyReportingSchema(db, '20261030_090000_reporting_data_freshness')
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(`DROP VIEW IF EXISTS reporting.data_freshness`))
}
