import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { REPORTING_SCHEMA_STATEMENTS } from '../server/reporting/schema'

/**
 * BTB-507: scheduled report delivery, and the funnel columns the first
 * reports read.
 *
 * - report_runs gains `trigger` and `scheduled_for`, a `sending` outcome and
 *   a unique key on (report_slug, scheduled_for) that lets a delivery claim
 *   its Sydney day. Mirrors the DDL Payload's push generates.
 * - Re-applies the reporting schema statements (idempotent), which add
 *   `submitted`, `decided`, `approved` and `acquisition` to the views.
 *
 * Safe to run whether or not the 20261023 and 20261024 migrations ran
 * before these changes were made.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
DO $$ BEGIN
  CREATE TYPE enum_report_runs_trigger AS ENUM ('view', 'schedule');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TYPE enum_report_runs_outcome ADD VALUE IF NOT EXISTS 'sending' AFTER 'ok';
ALTER TABLE report_runs
  ADD COLUMN IF NOT EXISTS trigger enum_report_runs_trigger DEFAULT 'view'::enum_report_runs_trigger;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS scheduled_for character varying;
CREATE UNIQUE INDEX IF NOT EXISTS report_runs_scheduled_delivery_key
  ON report_runs USING btree (report_slug, scheduled_for);
`),
  )
  for (const statement of REPORTING_SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement))
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // The enum value 'sending' stays: Postgres cannot drop an enum value.
  await db.execute(
    sql.raw(`
DROP INDEX IF EXISTS report_runs_scheduled_delivery_key;
ALTER TABLE report_runs DROP COLUMN IF EXISTS scheduled_for;
ALTER TABLE report_runs DROP COLUMN IF EXISTS trigger;
DROP TYPE IF EXISTS enum_report_runs_trigger;
`),
  )
}
