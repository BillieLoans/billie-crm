import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "collection_cases_worklist_idx";
  ALTER TABLE "collection_cases" ADD COLUMN "rung" numeric;
  CREATE INDEX "collection_cases_rung_idx" ON "collection_cases" USING btree ("rung");
  CREATE INDEX "collection_cases_worklist_idx" ON "collection_cases" USING btree ("state","rung","updated_at" desc);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "collection_cases_rung_idx";
  DROP INDEX "collection_cases_worklist_idx";
  CREATE INDEX "collection_cases_worklist_idx" ON "collection_cases" USING btree ("state","updated_at" desc);
  ALTER TABLE "collection_cases" DROP COLUMN "rung";`)
}
