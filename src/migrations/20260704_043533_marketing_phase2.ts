import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "batches" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"batch_id" varchar NOT NULL,
  	"name" varchar,
  	"criteria" jsonb,
  	"created_by_actor" varchar,
  	"batch_created_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "feedback" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"feedback_id" varchar NOT NULL,
  	"contact_id_string" varchar,
  	"customer_id" varchar,
  	"feedback_type" varchar,
  	"severity" varchar,
  	"body" varchar,
  	"product_area" varchar,
  	"received_at" timestamp(3) with time zone,
  	"status" varchar,
  	"status_changed_at" timestamp(3) with time zone,
  	"status_actor" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "batches_id" uuid;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "feedback_id" uuid;
  CREATE UNIQUE INDEX "batches_batch_id_idx" ON "batches" USING btree ("batch_id");
  CREATE INDEX "batches_updated_at_idx" ON "batches" USING btree ("updated_at");
  CREATE INDEX "batches_created_at_idx" ON "batches" USING btree ("created_at");
  CREATE UNIQUE INDEX "feedback_feedback_id_idx" ON "feedback" USING btree ("feedback_id");
  CREATE INDEX "feedback_contact_id_string_idx" ON "feedback" USING btree ("contact_id_string");
  CREATE INDEX "feedback_customer_id_idx" ON "feedback" USING btree ("customer_id");
  CREATE INDEX "feedback_product_area_idx" ON "feedback" USING btree ("product_area");
  CREATE INDEX "feedback_status_idx" ON "feedback" USING btree ("status");
  CREATE INDEX "feedback_updated_at_idx" ON "feedback" USING btree ("updated_at");
  CREATE INDEX "feedback_created_at_idx" ON "feedback" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_batches_fk" FOREIGN KEY ("batches_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_feedback_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_batches_id_idx" ON "payload_locked_documents_rels" USING btree ("batches_id");
  CREATE INDEX "payload_locked_documents_rels_feedback_id_idx" ON "payload_locked_documents_rels" USING btree ("feedback_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "batches" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "feedback" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "batches" CASCADE;
  DROP TABLE "feedback" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_batches_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_feedback_fk";
  
  DROP INDEX "payload_locked_documents_rels_batches_id_idx";
  DROP INDEX "payload_locked_documents_rels_feedback_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "batches_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "feedback_id";`)
}
