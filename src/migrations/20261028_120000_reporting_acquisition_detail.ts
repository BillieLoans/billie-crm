import { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-postgres'

import { applyReportingSchema } from '../server/reporting/applySchema'

/**
 * The application view's keyword, click_id_type and attribution_captured_at.
 * Re-applies the current schema statements, which are idempotent and
 * recreate every view.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await applyReportingSchema(db, '20261028_120000_reporting_acquisition_detail')
}

/** The columns stay until the schema is next applied; nothing reads them but reports. */
export async function down(_args: MigrateDownArgs): Promise<void> {}
