import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

import { REPORTING_SCHEMA_STATEMENTS } from '../server/reporting/schema'

/**
 * The application view's loan_purpose becomes loan_purpose_category: the
 * purpose is the customer's own words and can carry health and family
 * details. Re-applies the current schema statements, which are idempotent
 * and recreate every view.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of REPORTING_SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement))
  }
}

/** The view keeps the category until the schema is next applied; nothing reads it but reports. */
export async function down(_args: MigrateDownArgs): Promise<void> {}
