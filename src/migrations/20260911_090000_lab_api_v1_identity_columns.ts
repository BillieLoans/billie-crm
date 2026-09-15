import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * LAB Identity Verification API v1 (billieChat spec 2026-09-11): per-check
 * outcomes and screening verdicts on the customer identity mirror, and the
 * per-check screening report PDF + verification number on the conversation.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "identity_verification_verification_number" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "identity_verification_identity_outcome" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "identity_verification_screening_outcome" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "identity_verification_pep_result" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "identity_verification_sanctions_result" varchar;
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "identity_verification_report_verification_number" varchar;
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "identity_verification_report_screening_report_file_location" varchar;
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "identity_verification_report_screening_report_file_name" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "identity_verification_verification_number";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "identity_verification_identity_outcome";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "identity_verification_screening_outcome";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "identity_verification_pep_result";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "identity_verification_sanctions_result";
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "identity_verification_report_verification_number";
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "identity_verification_report_screening_report_file_location";
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "identity_verification_report_screening_report_file_name";`)
}
