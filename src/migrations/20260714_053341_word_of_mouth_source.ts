import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * word_of_mouth source value (PO Decision H) — plus schema catch-up: the
 * customers.fraud_risk_* columns shipped in #63 without a committed
 * migration (dev runs push:true so nobody noticed); this migration heals
 * that drift for demo/prod.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_contacts_source" ADD VALUE 'word_of_mouth' BEFORE 'organic';
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_severity" varchar;
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_score" numeric;
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_categories" jsonb;
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_flagged_at" timestamp(3) with time zone;
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_active" boolean;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "contacts" ALTER COLUMN "source" SET DATA TYPE text;
  DROP TYPE "public"."enum_contacts_source";
  CREATE TYPE "public"."enum_contacts_source" AS ENUM('meta', 'google', 'campus', 'referral', 'social_dm', 'ai_search', 'organic', 'other');
  ALTER TABLE "contacts" ALTER COLUMN "source" SET DATA TYPE "public"."enum_contacts_source" USING "source"::"public"."enum_contacts_source";
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_severity";
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_score";
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_categories";
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_flagged_at";
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_active";`)
}
