import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { FIRST_REPORTS, createFirstReports } from '../server/reporting/definitions/first-reports'

/**
 * BTB-507: publish the first three reports (decline rate, application
 * funnel, go-to-market numbers) in each environment. Reports are data, so
 * this only creates the ones whose slug is free; after this, authors own
 * them in the admin.
 *
 * It uses the Local API, which reads and writes every column of the
 * *current* report-definitions config. On a fresh database (every migration
 * replayed with today's code) it must therefore run after every migration
 * that adds a report-definitions column. When you add one, give your
 * migration an earlier timestamp than this one, or move this one later.
 */
export async function up({ payload, req }: MigrateUpArgs): Promise<void> {
  const created = await createFirstReports(payload, req)
  payload.logger.info(`[reports] first reports created: ${created.join(', ') || 'none'}`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Plain SQL, not the Local API: a rollback runs after later migrations'
  // down steps, and the Local API would query their dropped columns. Slugs
  // are constants from code. Versions go first; roles and lock rows cascade.
  const slugs = FIRST_REPORTS.map((r) => `'${r.slug.replace(/'/g, "''")}'`).join(', ')
  await db.execute(
    sql.raw(`
DELETE FROM _report_definitions_v
 WHERE parent_id IN (SELECT id FROM report_definitions WHERE slug IN (${slugs}));
DELETE FROM report_definitions WHERE slug IN (${slugs});
`),
  )
}
