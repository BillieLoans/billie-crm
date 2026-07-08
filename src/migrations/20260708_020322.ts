import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "batches" ADD COLUMN "invited_at" timestamp(3) with time zone;
  ALTER TABLE "batches" ADD COLUMN "invited_count" numeric;
  ALTER TABLE "batches" ADD COLUMN "skipped_unconsented" numeric;
  ALTER TABLE "batches" ADD COLUMN "skipped_needs_review" numeric;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "batches" DROP COLUMN "invited_at";
  ALTER TABLE "batches" DROP COLUMN "invited_count";
  ALTER TABLE "batches" DROP COLUMN "skipped_unconsented";
  ALTER TABLE "batches" DROP COLUMN "skipped_needs_review";`)
}
