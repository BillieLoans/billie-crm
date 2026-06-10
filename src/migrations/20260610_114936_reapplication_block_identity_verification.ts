import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "customers" ADD COLUMN "reapplication_block_reason" varchar;
  ALTER TABLE "customers" ADD COLUMN "reapplication_block_blocked_until" timestamp(3) with time zone;
  ALTER TABLE "customers" ADD COLUMN "reapplication_block_blocked_at" timestamp(3) with time zone;
  ALTER TABLE "customers" ADD COLUMN "reapplication_block_application_number" varchar;
  ALTER TABLE "customers" ADD COLUMN "identity_verification_overall_result" varchar;
  ALTER TABLE "customers" ADD COLUMN "identity_verification_provider" varchar;
  ALTER TABLE "customers" ADD COLUMN "identity_verification_provider_reference" varchar;
  ALTER TABLE "customers" ADD COLUMN "identity_verification_lab_request_id" varchar;
  ALTER TABLE "customers" ADD COLUMN "identity_verification_checked_at" timestamp(3) with time zone;
  ALTER TABLE "customers" ADD COLUMN "identity_verification_report_archived" boolean;
  ALTER TABLE "customers" ADD COLUMN "identity_verification_archived_at" timestamp(3) with time zone;
  ALTER TABLE "conversations" ADD COLUMN "decision_detail_reason" varchar;
  ALTER TABLE "conversations" ADD COLUMN "decision_detail_retry_eligible" boolean;
  ALTER TABLE "conversations" ADD COLUMN "decision_detail_source_application_number" varchar;
  ALTER TABLE "conversations" ADD COLUMN "decision_detail_blocked_until" timestamp(3) with time zone;
  ALTER TABLE "conversations" ADD COLUMN "reapplication_block_reason" varchar;
  ALTER TABLE "conversations" ADD COLUMN "reapplication_block_message_variant" varchar;
  ALTER TABLE "conversations" ADD COLUMN "reapplication_block_stop_message" varchar;
  ALTER TABLE "conversations" ADD COLUMN "reapplication_block_source_application_number" varchar;
  ALTER TABLE "conversations" ADD COLUMN "reapplication_block_source_account_id" varchar;
  ALTER TABLE "conversations" ADD COLUMN "reapplication_block_source_decided_at" timestamp(3) with time zone;
  ALTER TABLE "conversations" ADD COLUMN "reapplication_block_blocked_until" timestamp(3) with time zone;
  ALTER TABLE "conversations" ADD COLUMN "reapplication_block_blocked_at" timestamp(3) with time zone;
  ALTER TABLE "conversations" ADD COLUMN "reapplication_block_canonical_customer_id" varchar;
  ALTER TABLE "conversations" ADD COLUMN "identity_verification_report_lab_request_id" varchar;
  ALTER TABLE "conversations" ADD COLUMN "identity_verification_report_provider_reference" varchar;
  ALTER TABLE "conversations" ADD COLUMN "identity_verification_report_report_file_location" varchar;
  ALTER TABLE "conversations" ADD COLUMN "identity_verification_report_report_file_name" varchar;
  ALTER TABLE "conversations" ADD COLUMN "identity_verification_report_raw_response_file_location" varchar;
  ALTER TABLE "conversations" ADD COLUMN "identity_verification_report_raw_response_file_name" varchar;
  ALTER TABLE "conversations" ADD COLUMN "identity_verification_report_archived_at" timestamp(3) with time zone;
  -- Snapshot-drift cleanup: customer_name became a virtual field in dac2da1 and the
  -- column was already hand-dropped (20260518_232948); IF EXISTS keeps this idempotent.
  ALTER TABLE "loan_accounts" DROP COLUMN IF EXISTS "customer_name";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "loan_accounts" ADD COLUMN IF NOT EXISTS "customer_name" varchar;
  ALTER TABLE "customers" DROP COLUMN "reapplication_block_reason";
  ALTER TABLE "customers" DROP COLUMN "reapplication_block_blocked_until";
  ALTER TABLE "customers" DROP COLUMN "reapplication_block_blocked_at";
  ALTER TABLE "customers" DROP COLUMN "reapplication_block_application_number";
  ALTER TABLE "customers" DROP COLUMN "identity_verification_overall_result";
  ALTER TABLE "customers" DROP COLUMN "identity_verification_provider";
  ALTER TABLE "customers" DROP COLUMN "identity_verification_provider_reference";
  ALTER TABLE "customers" DROP COLUMN "identity_verification_lab_request_id";
  ALTER TABLE "customers" DROP COLUMN "identity_verification_checked_at";
  ALTER TABLE "customers" DROP COLUMN "identity_verification_report_archived";
  ALTER TABLE "customers" DROP COLUMN "identity_verification_archived_at";
  ALTER TABLE "conversations" DROP COLUMN "decision_detail_reason";
  ALTER TABLE "conversations" DROP COLUMN "decision_detail_retry_eligible";
  ALTER TABLE "conversations" DROP COLUMN "decision_detail_source_application_number";
  ALTER TABLE "conversations" DROP COLUMN "decision_detail_blocked_until";
  ALTER TABLE "conversations" DROP COLUMN "reapplication_block_reason";
  ALTER TABLE "conversations" DROP COLUMN "reapplication_block_message_variant";
  ALTER TABLE "conversations" DROP COLUMN "reapplication_block_stop_message";
  ALTER TABLE "conversations" DROP COLUMN "reapplication_block_source_application_number";
  ALTER TABLE "conversations" DROP COLUMN "reapplication_block_source_account_id";
  ALTER TABLE "conversations" DROP COLUMN "reapplication_block_source_decided_at";
  ALTER TABLE "conversations" DROP COLUMN "reapplication_block_blocked_until";
  ALTER TABLE "conversations" DROP COLUMN "reapplication_block_blocked_at";
  ALTER TABLE "conversations" DROP COLUMN "reapplication_block_canonical_customer_id";
  ALTER TABLE "conversations" DROP COLUMN "identity_verification_report_lab_request_id";
  ALTER TABLE "conversations" DROP COLUMN "identity_verification_report_provider_reference";
  ALTER TABLE "conversations" DROP COLUMN "identity_verification_report_report_file_location";
  ALTER TABLE "conversations" DROP COLUMN "identity_verification_report_report_file_name";
  ALTER TABLE "conversations" DROP COLUMN "identity_verification_report_raw_response_file_location";
  ALTER TABLE "conversations" DROP COLUMN "identity_verification_report_raw_response_file_name";
  ALTER TABLE "conversations" DROP COLUMN "identity_verification_report_archived_at";`)
}
