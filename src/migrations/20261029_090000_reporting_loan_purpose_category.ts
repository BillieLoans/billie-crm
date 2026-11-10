import { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-postgres'

import { applyReportingSchema } from '../server/reporting/applySchema'

/**
 * The application view's loan_purpose becomes loan_purpose_category: the
 * purpose is the customer's own words and can carry health and family
 * details. Re-applies the current schema statements, which are idempotent
 * and recreate every view.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await applyReportingSchema(db, '20261029_090000_reporting_loan_purpose_category')
}

/** The view keeps the category until the schema is next applied; nothing reads it but reports. */
export async function down(_args: MigrateDownArgs): Promise<void> {}
