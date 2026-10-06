import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * BTB-406: network provenance (country, ASN, client IP) captured by the chat
 * at entry and projected from conversation_started. Labelling only.
 *
 * Mirrors the DDL Payload's push generates for the collection config.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "network" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "network";`)
}
