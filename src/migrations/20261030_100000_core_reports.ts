import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import {
  CORE_REPORTS,
  createReports,
  upgradeFirstReports,
} from '../server/reporting/definitions/first-reports'

/**
 * Reports UX: publish the core reports behind the Reports home's headline
 * numbers (daily applications, approval rate, loans funded, arrears
 * balance), and give the first three reports their charts, headline and
 * column settings where authors have not changed them.
 *
 * Uses the Local API, which writes every report-definitions column of the
 * current config: keep this after every migration that adds one.
 */
export async function up({ payload, req }: MigrateUpArgs): Promise<void> {
  const created = await createReports(payload, CORE_REPORTS, req)
  const upgraded = await upgradeFirstReports(payload, req)
  payload.logger.info(
    `[reports] core reports created: ${created.join(', ') || 'none'}; first reports upgraded: ${
      upgraded.join(', ') || 'none'
    }`,
  )
}

/** Removes the core reports. The first reports keep their presentation. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Plain SQL, not the Local API: a rollback runs after later migrations'
  // down steps, and the Local API would query their dropped columns. Slugs
  // are constants from code. Versions go first; roles and lock rows cascade.
  const slugs = CORE_REPORTS.map((r) => `'${r.slug.replace(/'/g, "''")}'`).join(', ')
  await db.execute(
    sql.raw(`
DELETE FROM _report_definitions_v
 WHERE parent_id IN (SELECT id FROM report_definitions WHERE slug IN (${slugs}));
DELETE FROM report_definitions WHERE slug IN (${slugs});
`),
  )
}
