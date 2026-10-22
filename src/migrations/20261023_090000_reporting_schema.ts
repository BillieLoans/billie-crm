import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

import { REPORTING_SCHEMA_STATEMENTS } from '../server/reporting/schema'

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
  for (const statement of REPORTING_SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement))
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP SCHEMA IF EXISTS reporting CASCADE;`)
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "decision_detail_ruleset_version";`)
}
