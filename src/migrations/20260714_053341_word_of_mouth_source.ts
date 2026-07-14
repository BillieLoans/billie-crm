import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * word_of_mouth source value (PO Decision H).
 *
 * The customers.fraud_risk_* columns are owned by 20260709_120104_fraud_risk;
 * they were re-added here as a "schema catch-up" on the mistaken belief that #63
 * shipped them without a committed migration. On any DB where that migration has
 * already run (e.g. demo/prod), a plain ADD COLUMN fails with "already exists".
 * All statements are therefore idempotent (IF NOT EXISTS / IF EXISTS) so this
 * migration heals drift regardless of whether the columns/enum value are present.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_contacts_source" ADD VALUE IF NOT EXISTS 'word_of_mouth' BEFORE 'organic';
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "fraud_risk_severity" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "fraud_risk_score" numeric;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "fraud_risk_categories" jsonb;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "fraud_risk_flagged_at" timestamp(3) with time zone;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "fraud_risk_active" boolean;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "contacts" ALTER COLUMN "source" SET DATA TYPE text;
  DROP TYPE "public"."enum_contacts_source";
  CREATE TYPE "public"."enum_contacts_source" AS ENUM('meta', 'google', 'campus', 'referral', 'social_dm', 'ai_search', 'organic', 'other');
  ALTER TABLE "contacts" ALTER COLUMN "source" SET DATA TYPE "public"."enum_contacts_source" USING "source"::"public"."enum_contacts_source";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "fraud_risk_severity";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "fraud_risk_score";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "fraud_risk_categories";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "fraud_risk_flagged_at";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "fraud_risk_active";`)
}
