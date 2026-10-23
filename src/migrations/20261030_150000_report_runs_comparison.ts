import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * `report-runs.comparison`: marks the previous-period run made alongside a
 * report for a comparison, so the usage page does not count it as a read.
 * Older rows stay false (they cannot be told apart).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS comparison boolean DEFAULT false;
`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(`ALTER TABLE report_runs DROP COLUMN IF EXISTS comparison;`))
}
