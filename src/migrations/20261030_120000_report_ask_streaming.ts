import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Ask Claude streams its drafts: report-asks records the time to the first
 * streamed text (`first_output_ms`) and the whole request with checks and
 * preview (`total_ms`), and a `cancelled` outcome when the person stops a
 * draft.
 *
 * Mirrors the DDL Payload's push generates (diffed from a pushed schema),
 * made safe to re-run.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TYPE enum_report_asks_outcome ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TABLE report_asks ADD COLUMN IF NOT EXISTS first_output_ms numeric;
ALTER TABLE report_asks ADD COLUMN IF NOT EXISTS total_ms numeric;
`),
  )
}

/** Drops the timings. The enum value cannot be removed from a Postgres type; it stays unused. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE report_asks DROP COLUMN IF EXISTS total_ms;
ALTER TABLE report_asks DROP COLUMN IF EXISTS first_output_ms;
`),
  )
}
