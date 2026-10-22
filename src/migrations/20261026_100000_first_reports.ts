import { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-postgres'
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

export async function down({ payload, req }: MigrateDownArgs): Promise<void> {
  await payload.delete({
    collection: 'report-definitions',
    where: { slug: { in: FIRST_REPORTS.map((r) => r.slug) } },
    overrideAccess: true,
    req,
  })
}
