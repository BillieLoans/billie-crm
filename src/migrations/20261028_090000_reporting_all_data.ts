import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

import { REPORTING_SCHEMA_STATEMENTS } from '../server/reporting/schema'

/**
 * The reporting schema with the CRM's non-personal data: the customer,
 * collection_case, write_off, block_clear_request, notification, llm_cost and
 * contact_note views, the application and loan views' new columns, and the
 * lenient JSON readers. Re-applies the current schema statements, which are
 * idempotent and recreate every view.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of REPORTING_SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement))
  }
}

/** The new views go; application and loan keep their new columns until the schema is next applied. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
DROP VIEW IF EXISTS reporting.contact_note;
DROP VIEW IF EXISTS reporting.llm_cost;
DROP VIEW IF EXISTS reporting.notification;
DROP VIEW IF EXISTS reporting.block_clear_request;
DROP VIEW IF EXISTS reporting.write_off;
DROP VIEW IF EXISTS reporting.collection_case;
DROP VIEW IF EXISTS reporting.customer;
`),
  )
}
