import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Customer data ownership SP4 (BTB-392): what the platform customerService now
 * says about a customer, projected by the event processor.
 *
 * - customers: contact provenance from customer.changed.v1 (customers SDK 3.x)
 *   — tier / source / verified-at per contact type, the verbatim `contacts`
 *   list, canonical id and customer id status, and who last wrote the row —
 *   plus the platform link id and reason behind `merged_into`.
 * - conversations: `identity_resolution` (link outcome, resolver assessments,
 *   recognition review case for the journey).
 * - conversations / loan_accounts / applications: `identity_origin_customer_id`,
 *   the id a row arrived under before an identity link re-attributed it, so a
 *   cut link can be undone without ledger archaeology.
 *
 * Mirrors the DDL Payload's push generated for the collection configs.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "merged_link_id" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "merged_reason" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "canonical_id" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "customer_id_status" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "email_tier" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "email_source" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp(3) with time zone;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "mobile_phone_tier" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "mobile_phone_source" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "mobile_phone_verified_at" timestamp(3) with time zone;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "contacts" jsonb;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "contacts_changed_by" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "contacts_changed_at" timestamp(3) with time zone;
  CREATE INDEX IF NOT EXISTS "customers_canonical_id_idx" ON "customers" USING btree ("canonical_id");
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "identity_resolution" jsonb;
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "identity_origin_customer_id" varchar;
  CREATE INDEX IF NOT EXISTS "conversations_identity_origin_customer_id_idx" ON "conversations" USING btree ("identity_origin_customer_id");
  ALTER TABLE "loan_accounts" ADD COLUMN IF NOT EXISTS "identity_origin_customer_id" varchar;
  CREATE INDEX IF NOT EXISTS "loan_accounts_identity_origin_customer_id_idx" ON "loan_accounts" USING btree ("identity_origin_customer_id");
  ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "identity_origin_customer_id" varchar;
  CREATE INDEX IF NOT EXISTS "applications_identity_origin_customer_id_idx" ON "applications" USING btree ("identity_origin_customer_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP INDEX IF EXISTS "applications_identity_origin_customer_id_idx";
  ALTER TABLE "applications" DROP COLUMN IF EXISTS "identity_origin_customer_id";
  DROP INDEX IF EXISTS "loan_accounts_identity_origin_customer_id_idx";
  ALTER TABLE "loan_accounts" DROP COLUMN IF EXISTS "identity_origin_customer_id";
  DROP INDEX IF EXISTS "conversations_identity_origin_customer_id_idx";
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "identity_origin_customer_id";
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "identity_resolution";
  DROP INDEX IF EXISTS "customers_canonical_id_idx";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "contacts_changed_at";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "contacts_changed_by";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "contacts";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "mobile_phone_verified_at";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "mobile_phone_source";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "mobile_phone_tier";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "email_verified_at";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "email_source";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "email_tier";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "customer_id_status";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "canonical_id";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "merged_reason";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "merged_link_id";`)
}
