import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

import { REPORTING_SCHEMA_STATEMENTS } from '../server/reporting/schema'

/**
 * Restricted reporting columns over the MCP connector (ADR 0002):
 *
 * - Report definitions gain `mcp_restricted_access`: an admin can let Claude
 *   run a published report that reads restricted columns. Off for every
 *   existing report.
 * - The reporting schema gains `reason_for_session()` and
 *   `block_reason_for_session()` (identity-category reasons read as one
 *   generic code for the connector's login), `suppress_small()`, and the
 *   `restricted_finding_summary` and `customer_risk_summary` views. It grants
 *   `reporting_mcp_reader`, where that role exists, every column except the
 *   restricted ones. The statements are idempotent and recreate every view.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE report_definitions ADD COLUMN IF NOT EXISTS mcp_restricted_access boolean DEFAULT false;
ALTER TABLE _report_definitions_v ADD COLUMN IF NOT EXISTS version_mcp_restricted_access boolean DEFAULT false;
`),
  )
  for (const statement of REPORTING_SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement))
  }
}

/** Removes the column. The schema additions stay; they are harmless without the role. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE _report_definitions_v DROP COLUMN IF EXISTS version_mcp_restricted_access;
ALTER TABLE report_definitions DROP COLUMN IF EXISTS mcp_restricted_access;
`),
  )
}
