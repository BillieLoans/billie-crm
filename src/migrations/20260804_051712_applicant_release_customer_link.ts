import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "release_grants" ADD COLUMN "customer_id" varchar;
  CREATE INDEX "release_grants_mobile_e164_idx" ON "release_grants" USING btree ("mobile_e164");
  CREATE INDEX "release_grants_customer_id_idx" ON "release_grants" USING btree ("customer_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "release_grants_mobile_e164_idx";
  DROP INDEX "release_grants_customer_id_idx";
  ALTER TABLE "release_grants" DROP COLUMN "customer_id";`)
}
