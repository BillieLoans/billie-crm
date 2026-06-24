import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_collection_cases_state" AS ENUM('open', 'awaiting_human', 'cured');
  CREATE TABLE "collection_cases" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"account_id" varchar NOT NULL,
  	"customer_ref_id" uuid,
  	"customer_id" varchar,
  	"state" "enum_collection_cases_state",
  	"hardship_paused" boolean,
  	"stopped_contact" boolean,
  	"overdue_amount" numeric,
  	"days_overdue" numeric,
  	"last_step" numeric,
  	"due_date" timestamp(3) with time zone,
  	"opened_at" timestamp(3) with time zone,
  	"cured_at" timestamp(3) with time zone,
  	"exhausted_at" timestamp(3) with time zone,
  	"paused_at" timestamp(3) with time zone,
  	"resumed_at" timestamp(3) with time zone,
  	"stop_contact_at" timestamp(3) with time zone,
  	"correlation_id" varchar,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "collection_cases_id" uuid;
  ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_customer_ref_id_customers_id_fk" FOREIGN KEY ("customer_ref_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "collection_cases_account_id_idx" ON "collection_cases" USING btree ("account_id");
  CREATE INDEX "collection_cases_customer_ref_idx" ON "collection_cases" USING btree ("customer_ref_id");
  CREATE INDEX "collection_cases_customer_id_idx" ON "collection_cases" USING btree ("customer_id");
  CREATE INDEX "collection_cases_state_idx" ON "collection_cases" USING btree ("state");
  CREATE INDEX "collection_cases_hardship_paused_idx" ON "collection_cases" USING btree ("hardship_paused");
  CREATE INDEX "collection_cases_stopped_contact_idx" ON "collection_cases" USING btree ("stopped_contact");
  CREATE INDEX "collection_cases_opened_at_idx" ON "collection_cases" USING btree ("opened_at");
  CREATE INDEX "collection_cases_worklist_idx" ON "collection_cases" USING btree ("state","updated_at" desc);
  CREATE INDEX "collection_cases_by_customer_idx" ON "collection_cases" USING btree ("customer_id","updated_at" desc);
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_collection_cases_fk" FOREIGN KEY ("collection_cases_id") REFERENCES "public"."collection_cases"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_collection_cases_id_idx" ON "payload_locked_documents_rels" USING btree ("collection_cases_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "collection_cases" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "collection_cases" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_collection_cases_fk";
  
  DROP INDEX "payload_locked_documents_rels_collection_cases_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "collection_cases_id";
  DROP TYPE "public"."enum_collection_cases_state";`)
}
