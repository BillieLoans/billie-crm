import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "loan_accounts" ADD COLUMN "commencement_date" timestamp(3) with time zone;
  CREATE INDEX "loan_accounts_commencement_date_idx" ON "loan_accounts" USING btree ("commencement_date");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "loan_accounts_commencement_date_idx";
  ALTER TABLE "loan_accounts" DROP COLUMN "commencement_date";`)
}
