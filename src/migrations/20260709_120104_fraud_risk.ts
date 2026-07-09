import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_severity" varchar;
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_score" numeric;
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_categories" jsonb;
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_flagged_at" timestamp(3) with time zone;
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_active" boolean;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_severity";
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_score";
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_categories";
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_flagged_at";
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_active";`)
}
