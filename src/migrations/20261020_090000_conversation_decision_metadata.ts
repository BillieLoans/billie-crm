import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * BTB-462: decision_metadata — non-PII evidence behind a credit decline,
 * projected from final_credit_decision.decision_metadata by the event
 * processor (additive jsonb merge).
 *
 * Mirrors the DDL Payload's push generates for the collection config.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "decision_metadata" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "decision_metadata";`)
}
