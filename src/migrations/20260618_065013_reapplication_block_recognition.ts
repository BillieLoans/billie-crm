import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "conversations" ADD COLUMN "reapplication_block_disposition_kind" varchar;
  ALTER TABLE "conversations" ADD COLUMN "reapplication_block_manual_review_candidate" boolean;
  ALTER TABLE "conversations" ADD COLUMN "reapplication_block_recognition" jsonb;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "conversations" DROP COLUMN "reapplication_block_disposition_kind";
  ALTER TABLE "conversations" DROP COLUMN "reapplication_block_manual_review_candidate";
  ALTER TABLE "conversations" DROP COLUMN "reapplication_block_recognition";`)
}
