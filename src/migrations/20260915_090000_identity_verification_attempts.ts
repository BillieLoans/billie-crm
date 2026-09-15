import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Per-attempt identity verification results (billieChat spec 2026-09-15):
 * one entry per LAB verify call, keyed by LAB request id (or `attempt-<n>`
 * without one), merged by the event-processor from
 * `identity_verification.attempt.v1` and `identity_verification.report.archived.v1`.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "identity_verification_attempts" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "identity_verification_attempts";`)
}
