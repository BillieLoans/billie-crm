import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { REPORTING_SCHEMA_STATEMENTS } from '../server/reporting/schema'
import {
  createReports,
  DECLINE_DETAIL_REPORTS,
  upgradeDeclineRateDrill,
} from '../server/reporting/definitions/first-reports'

/**
 * Decline reasons in detail: report a decline by the credit rule that
 * failed (for example the G4 leakage gate), not only by the component.
 *
 * - The reporting schema gains `credit_rule` (rule id to family and label),
 *   `decline_reason_label()` and, on `application`, the failed rule ids and
 *   declined components that billieChat's assessment and decision events
 *   carry. The statements are idempotent and recreate every view.
 * - Two reports are published where their slug is free: "Decline reasons
 *   in detail" (`decline-reasons`) and "Decline reasons by week"
 *   (`decline-reasons-trend`).
 * - "Decline rate and reasons" gets a drill-down into the detail report,
 *   where an author has not changed its SQL or chart.
 *
 * Uses the Local API for the reports, so it must run after every migration
 * that adds a report-definitions column or a collection (see the
 * core_reports migration).
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  for (const statement of REPORTING_SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement))
  }
  const created = await createReports(payload, DECLINE_DETAIL_REPORTS, req)
  const upgraded = await upgradeDeclineRateDrill(payload, req)
  payload.logger.info(
    `[reports] decline detail reports created: ${created.join(', ') || 'none'}; drill-down added: ${
      upgraded.join(', ') || 'none'
    }`,
  )
}

/** Removes the two detail reports. The schema and the drill-down stay. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  const slugs = DECLINE_DETAIL_REPORTS.map((r) => `'${r.slug.replace(/'/g, "''")}'`).join(', ')
  await db.execute(
    sql.raw(`
DELETE FROM _report_definitions_v
 WHERE parent_id IN (SELECT id FROM report_definitions WHERE slug IN (${slugs}));
DELETE FROM report_definitions WHERE slug IN (${slugs});
`),
  )
}
