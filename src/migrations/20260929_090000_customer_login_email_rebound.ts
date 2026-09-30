import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Customer data ownership SP5 (BTB-400): when the identity service last
 * moved the customer's login (Zitadel) to the record's BOUND email —
 * projected from customer.login_email.rebound.v1.
 *
 * Mirrors the DDL Payload's push generates for the collection config.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "login_email_rebound_at" timestamp(3) with time zone;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "login_email_rebound_at";`)
}
