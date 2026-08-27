import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Adds the `llm_costs_id` relationship column Payload's document-locking
 * system table keeps per registered collection (BTB-302 follow-up).
 *
 * Registering the `llm-costs` collection made Payload's runtime query
 * `payload_locked_documents_rels.llm_costs_id` on EVERY admin detail view —
 * the hand-written llm_costs migration created only the collection's own
 * table, so every detail screen (Conversations included) failed with
 * "column llm_costs_id does not exist" and rendered blank.
 *
 * Shape copied from the newest sibling (issues): typed as the collection's
 * id type (llm_costs.id is integer), FK ON DELETE CASCADE, btree index.
 * The FK uses a guarded DO block because ADD CONSTRAINT has no IF NOT
 * EXISTS form.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "llm_costs_id" integer;`)
  await db.execute(sql`
  DO $$ BEGIN
    ALTER TABLE "payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_llm_costs_fk"
      FOREIGN KEY ("llm_costs_id") REFERENCES "llm_costs"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_llm_costs_id_idx"
    ON "payload_locked_documents_rels" ("llm_costs_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "llm_costs_id";`)
}
