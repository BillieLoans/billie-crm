import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

import { applyReportingSchema } from '../server/reporting/applySchema'

/**
 * BTB-504 / BTB-505: the `reporting` schema every report reads, and the
 * ruleset version on the conversation's decision detail.
 *
 * The schema statements live in src/server/reporting/schema.ts so dev/test
 * (which use `push`) apply exactly the same SQL at init. All are idempotent.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "decision_detail_ruleset_version" varchar;`)
  await applyReportingSchema(db, '20261023_090000_reporting_schema')
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP SCHEMA IF EXISTS reporting CASCADE;`)
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "decision_detail_ruleset_version";`)
}
