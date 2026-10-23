import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * `report-asks.outcome = 'pending'`: the row held while a draft for staff
 * who are not authors is in progress, so the Ask allowance holds across
 * servers (src/server/reporting/ask/quota.ts).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`ALTER TYPE enum_report_asks_outcome ADD VALUE IF NOT EXISTS 'pending';`),
  )
}

/** Enum values cannot be removed from a Postgres type; held rows are cleared. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(`DELETE FROM report_asks WHERE outcome = 'pending';`))
}
