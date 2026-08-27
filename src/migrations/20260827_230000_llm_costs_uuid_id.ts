import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Converts llm_costs ids from serial integer to uuid (BTB-302 follow-up #3).
 *
 * The pg adapter runs with `idType: 'uuid'` (payload.config.ts), so Payload's
 * runtime schema types llm_costs.id — and payload_locked_documents_rels
 * .llm_costs_id — as uuid. The hand-written 20260827_131500_llm_costs
 * migration created `id serial` instead, and 20260827_224500 followed suit
 * with an integer rels column. Payload's document-lock check compares the
 * opened record's id against EVERY rels column in one OR chain, so the lone
 * integer column made Postgres reject the uuid parameter
 * ("invalid input syntax for type integer") on EVERY admin detail view,
 * for every collection — pages rendered blank.
 *
 * Regenerating llm_costs ids is safe: rows are a projection keyed by
 * stream_id, and nothing references llm_costs.id except transient lock rows
 * (deleted below before the column is rebuilt).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  DELETE FROM "payload_locked_documents" WHERE "id" IN (
    SELECT "parent_id" FROM "payload_locked_documents_rels" WHERE "llm_costs_id" IS NOT NULL);`)
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_llm_costs_fk";`)
  await db.execute(sql`
  DROP INDEX IF EXISTS "payload_locked_documents_rels_llm_costs_id_idx";`)
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "llm_costs_id";`)

  // Guarded so a schema already at uuid (push:true envs) is never re-keyed.
  await db.execute(sql`
  DO $$ BEGIN
    IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'llm_costs' AND column_name = 'id') <> 'uuid' THEN
      ALTER TABLE "llm_costs" ALTER COLUMN "id" DROP DEFAULT;
      ALTER TABLE "llm_costs" ALTER COLUMN "id" SET DATA TYPE uuid USING gen_random_uuid();
      DROP SEQUENCE IF EXISTS "llm_costs_id_seq";
    END IF;
  END $$;`)
  await db.execute(sql`
  ALTER TABLE "llm_costs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();`)

  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "llm_costs_id" uuid;`)
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels"
    ADD CONSTRAINT "payload_locked_documents_rels_llm_costs_fk"
    FOREIGN KEY ("llm_costs_id") REFERENCES "public"."llm_costs"("id") ON DELETE cascade ON UPDATE no action;`)
  await db.execute(sql`
  CREATE INDEX "payload_locked_documents_rels_llm_costs_id_idx"
    ON "payload_locked_documents_rels" USING btree ("llm_costs_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_llm_costs_fk";`)
  await db.execute(sql`
  DROP INDEX IF EXISTS "payload_locked_documents_rels_llm_costs_id_idx";`)
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "llm_costs_id";`)
  await db.execute(sql`
  ALTER TABLE "llm_costs" ALTER COLUMN "id" DROP DEFAULT;`)
  await db.execute(sql`
  CREATE SEQUENCE IF NOT EXISTS "llm_costs_id_seq";`)
  await db.execute(sql`
  ALTER TABLE "llm_costs" ALTER COLUMN "id" SET DATA TYPE integer USING nextval('llm_costs_id_seq');`)
  await db.execute(sql`
  ALTER TABLE "llm_costs" ALTER COLUMN "id" SET DEFAULT nextval('llm_costs_id_seq');`)
  await db.execute(sql`
  ALTER SEQUENCE "llm_costs_id_seq" OWNED BY "llm_costs"."id";`)
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "llm_costs_id" integer;`)
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels"
    ADD CONSTRAINT "payload_locked_documents_rels_llm_costs_fk"
    FOREIGN KEY ("llm_costs_id") REFERENCES "llm_costs"("id") ON DELETE CASCADE;`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_llm_costs_id_idx"
    ON "payload_locked_documents_rels" ("llm_costs_id");`)
}
