import { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-postgres'

import { applyReportingSchema } from '../server/reporting/applySchema'

/**
 * The loan view finds each loan's conversation through the
 * application_number index instead of scanning every conversation per loan.
 * Re-applies the current schema statements, which are idempotent and
 * recreate every view.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await applyReportingSchema(db, '20261028_100000_reporting_loan_lookup')
}

/** Nothing to undo: the loan view's columns are unchanged. */
export async function down(_args: MigrateDownArgs): Promise<void> {}
