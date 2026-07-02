import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   -- heal 20260628 gap: locked-documents rel for reapplication_block_clear_requests (shipped without snapshot)
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "reapplication_block_clear_requests_id" uuid;
  CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_reapplication_block_clear__idx" ON "payload_locked_documents_rels" USING btree ("reapplication_block_clear_requests_id");
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'payload_locked_documents_rels_reapplication_block_clear_r_fk'
    ) THEN
      ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_reapplication_block_clear_r_fk" FOREIGN KEY ("reapplication_block_clear_requests_id") REFERENCES "public"."reapplication_block_clear_requests"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
  END $$;

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
  ALTER TABLE "collection_cases" DROP COLUMN "rung";

  -- heal 20260628 gap: locked-documents rel for reapplication_block_clear_requests (shipped without snapshot)
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_reapplication_block_clear_r_fk";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_reapplication_block_clear__idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "reapplication_block_clear_requests_id";`)
}
