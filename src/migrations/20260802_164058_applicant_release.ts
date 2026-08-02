import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_interactions_kind" ADD VALUE 'released_to_apply';
  CREATE TYPE "public"."enum_release_batches_type" AS ENUM('waitlist', 'phone_list', 'open_quota');
  CREATE TYPE "public"."enum_release_batches_status" AS ENUM('active', 'revoked');
  CREATE TYPE "public"."enum_release_grants_source" AS ENUM('targeted', 'quota_claim');
  CREATE TYPE "public"."enum_release_grants_status" AS ENUM('granted', 'claimed', 'expired', 'revoked');
  CREATE TYPE "public"."enum_release_grants_sms_status" AS ENUM('sent', 'failed', 'not_sent');
  CREATE TYPE "public"."enum_release_gate_status_mode" AS ENUM('open', 'gated');
  CREATE TABLE "release_batches" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"release_id" varchar NOT NULL,
  	"name" varchar,
  	"type" "enum_release_batches_type",
  	"status" "enum_release_batches_status",
  	"quota_count" numeric,
  	"expires_at" timestamp(3) with time zone,
  	"send_invite_sms" boolean,
  	"granted_count" numeric,
  	"claimed_count" numeric,
  	"sms_sent_count" numeric,
  	"sms_failed_count" numeric,
  	"skipped_already_customer" numeric,
  	"skipped_invalid_number" numeric,
  	"skipped_already_released" numeric,
  	"skipped_needs_review" numeric,
  	"created_by_actor" varchar,
  	"released_at" timestamp(3) with time zone,
  	"revoked_by" varchar,
  	"revoked_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "release_grants" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"release_id" varchar NOT NULL,
  	"mobile_e164" varchar NOT NULL,
  	"contact_id" varchar,
  	"source" "enum_release_grants_source",
  	"status" "enum_release_grants_status",
  	"sms_status" "enum_release_grants_sms_status",
  	"claimed_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "release_gate_status" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"gate_id" varchar NOT NULL,
  	"mode" "enum_release_gate_status_mode",
  	"set_by" varchar,
  	"changed_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "release_batches_id" uuid;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "release_grants_id" uuid;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "release_gate_status_id" uuid;
  CREATE UNIQUE INDEX "release_batches_release_id_idx" ON "release_batches" USING btree ("release_id");
  CREATE INDEX "release_batches_updated_at_idx" ON "release_batches" USING btree ("updated_at");
  CREATE INDEX "release_batches_created_at_idx" ON "release_batches" USING btree ("created_at");
  CREATE INDEX "release_grants_release_id_idx" ON "release_grants" USING btree ("release_id");
  CREATE INDEX "release_grants_contact_id_idx" ON "release_grants" USING btree ("contact_id");
  CREATE INDEX "release_grants_updated_at_idx" ON "release_grants" USING btree ("updated_at");
  CREATE INDEX "release_grants_created_at_idx" ON "release_grants" USING btree ("created_at");
  CREATE UNIQUE INDEX "release_grants_natural_key_idx" ON "release_grants" USING btree ("release_id","mobile_e164");
  CREATE UNIQUE INDEX "release_gate_status_gate_id_idx" ON "release_gate_status" USING btree ("gate_id");
  CREATE INDEX "release_gate_status_updated_at_idx" ON "release_gate_status" USING btree ("updated_at");
  CREATE INDEX "release_gate_status_created_at_idx" ON "release_gate_status" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_release_batches_fk" FOREIGN KEY ("release_batches_id") REFERENCES "public"."release_batches"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_release_grants_fk" FOREIGN KEY ("release_grants_id") REFERENCES "public"."release_grants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_release_gate_status_fk" FOREIGN KEY ("release_gate_status_id") REFERENCES "public"."release_gate_status"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_release_batches_id_idx" ON "payload_locked_documents_rels" USING btree ("release_batches_id");
  CREATE INDEX "payload_locked_documents_rels_release_grants_id_idx" ON "payload_locked_documents_rels" USING btree ("release_grants_id");
  CREATE INDEX "payload_locked_documents_rels_release_gate_status_id_idx" ON "payload_locked_documents_rels" USING btree ("release_gate_status_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "release_batches" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "release_grants" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "release_gate_status" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "release_batches" CASCADE;
  DROP TABLE "release_grants" CASCADE;
  DROP TABLE "release_gate_status" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_release_batches_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_release_grants_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_release_gate_status_fk";
  
  DROP INDEX "payload_locked_documents_rels_release_batches_id_idx";
  DROP INDEX "payload_locked_documents_rels_release_grants_id_idx";
  DROP INDEX "payload_locked_documents_rels_release_gate_status_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "release_batches_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "release_grants_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "release_gate_status_id";
  DROP TYPE "public"."enum_release_batches_type";
  DROP TYPE "public"."enum_release_batches_status";
  DROP TYPE "public"."enum_release_grants_source";
  DROP TYPE "public"."enum_release_grants_status";
  DROP TYPE "public"."enum_release_grants_sms_status";
  DROP TYPE "public"."enum_release_gate_status_mode";
  ALTER TABLE "interactions" ALTER COLUMN "kind" SET DATA TYPE text;
  DROP TYPE "public"."enum_interactions_kind";
  CREATE TYPE "public"."enum_interactions_kind" AS ENUM('signup', 'message_out', 'message_in', 'feedback_prompt', 'referral', 'stage_change', 'note', 'import');
  ALTER TABLE "interactions" ALTER COLUMN "kind" SET DATA TYPE "public"."enum_interactions_kind" USING "kind"::"public"."enum_interactions_kind";`)
}
