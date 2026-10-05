import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * BTB-404: ad-click attribution (gclid/gbraid/wbraid/UTM/matchtype) captured
 * by the chat at entry and projected from conversation_started.
 *
 * Mirrors the DDL Payload's push generates for the collection config.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "attribution" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "attribution";`)
}
