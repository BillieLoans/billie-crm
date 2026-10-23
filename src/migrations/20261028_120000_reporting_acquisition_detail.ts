import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

import { REPORTING_SCHEMA_STATEMENTS } from '../server/reporting/schema'

/**
 * The application view's keyword, click_id_type and attribution_captured_at.
 * Re-applies the current schema statements, which are idempotent and
 * recreate every view.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of REPORTING_SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement))
  }
}

/** The columns stay until the schema is next applied; nothing reads them but reports. */
export async function down(_args: MigrateDownArgs): Promise<void> {}
