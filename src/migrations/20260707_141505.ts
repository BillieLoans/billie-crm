import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "contacts" ADD COLUMN "needs_review" boolean;
  CREATE INDEX "contacts_needs_review_idx" ON "contacts" USING btree ("needs_review");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "contacts_needs_review_idx";
  ALTER TABLE "contacts" DROP COLUMN "needs_review";`)
}
