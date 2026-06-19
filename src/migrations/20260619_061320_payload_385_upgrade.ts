import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "payload_kv" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  DROP INDEX "write_off_requests_approval_details_approval_details_decided_by_idx";
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "write_off_requests_approval_details_approval_details_dec_idx" ON "write_off_requests" USING btree ("approval_details_decided_by_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_kv" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "payload_kv" CASCADE;
  DROP INDEX "write_off_requests_approval_details_approval_details_dec_idx";
  CREATE INDEX "write_off_requests_approval_details_approval_details_decided_by_idx" ON "write_off_requests" USING btree ("approval_details_decided_by_id");`)
}
