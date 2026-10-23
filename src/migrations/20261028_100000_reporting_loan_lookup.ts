import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

import { REPORTING_SCHEMA_STATEMENTS } from '../server/reporting/schema'

/**
 * The loan view finds each loan's conversation through the
 * application_number index instead of scanning every conversation per loan.
 * Re-applies the current schema statements, which are idempotent and
 * recreate every view.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of REPORTING_SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement))
  }
}

/** Nothing to undo: the loan view's columns are unchanged. */
export async function down(_args: MigrateDownArgs): Promise<void> {}
