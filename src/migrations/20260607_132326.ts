import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "customers" ADD COLUMN "merged_into" varchar;
  CREATE INDEX "customers_merged_into_idx" ON "customers" USING btree ("merged_into");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "customers_merged_into_idx";
  ALTER TABLE "customers" DROP COLUMN "merged_into";`)
}
