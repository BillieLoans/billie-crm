import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_contacts_source" AS ENUM('meta', 'google', 'campus', 'referral', 'social_dm', 'ai_search', 'organic', 'other');
  CREATE TYPE "public"."enum_contacts_channel_preference" AS ENUM('whatsapp', 'sms');
  CREATE TYPE "public"."enum_contacts_derived_stage" AS ENUM('lead', 'waitlist', 'invited', 'applicant', 'customer', 'former_customer');
  CREATE TYPE "public"."enum_contacts_loan_status" AS ENUM('approved', 'disbursed', 'repaid');
  CREATE TYPE "public"."enum_interactions_kind" AS ENUM('signup', 'message_out', 'message_in', 'feedback_prompt', 'referral', 'stage_change', 'note', 'import');
  CREATE TYPE "public"."enum_interactions_direction" AS ENUM('inbound', 'outbound');
  ALTER TYPE "public"."enum_users_role" ADD VALUE 'marketing';
  CREATE TABLE "contacts" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"contact_id" varchar NOT NULL,
  	"first_name" varchar,
  	"email" varchar,
  	"mobile_e164" varchar,
  	"city" varchar,
  	"postcode" varchar,
  	"source" "enum_contacts_source",
  	"utm" jsonb,
  	"platforms" jsonb,
  	"channel_preference" "enum_contacts_channel_preference",
  	"referral_code" varchar,
  	"referred_by_contact_id" varchar,
  	"waitlist_joined_at" timestamp(3) with time zone,
  	"waitlist_position" numeric,
  	"batch_id" varchar,
  	"panel_member" boolean,
  	"customer_id" varchar,
  	"link_basis" varchar,
  	"linked_at" timestamp(3) with time zone,
  	"derived_stage" "enum_contacts_derived_stage",
  	"loan_status" "enum_contacts_loan_status",
  	"consent" jsonb,
  	"attributes" jsonb,
  	"erased" boolean,
  	"observed_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "interactions" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"interaction_id" varchar NOT NULL,
  	"contact_id_string" varchar NOT NULL,
  	"contact_id" uuid,
  	"occurred_at" timestamp(3) with time zone,
  	"kind" "enum_interactions_kind",
  	"channel" varchar,
  	"direction" "enum_interactions_direction",
  	"subject" varchar,
  	"body" varchar,
  	"source_system" varchar,
  	"metadata" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "contact_audit_log" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"contact_id_string" varchar NOT NULL,
  	"event_type" varchar NOT NULL,
  	"actor" varchar,
  	"occurred_at" timestamp(3) with time zone,
  	"detail" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "contacts_id" uuid;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "interactions_id" uuid;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "contact_audit_log_id" uuid;
  ALTER TABLE "interactions" ADD CONSTRAINT "interactions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "contacts_contact_id_idx" ON "contacts" USING btree ("contact_id");
  CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");
  CREATE INDEX "contacts_mobile_e164_idx" ON "contacts" USING btree ("mobile_e164");
  CREATE INDEX "contacts_referral_code_idx" ON "contacts" USING btree ("referral_code");
  CREATE INDEX "contacts_referred_by_contact_id_idx" ON "contacts" USING btree ("referred_by_contact_id");
  CREATE INDEX "contacts_customer_id_idx" ON "contacts" USING btree ("customer_id");
  CREATE INDEX "contacts_derived_stage_idx" ON "contacts" USING btree ("derived_stage");
  CREATE INDEX "contacts_updated_at_idx" ON "contacts" USING btree ("updated_at");
  CREATE INDEX "contacts_created_at_idx" ON "contacts" USING btree ("created_at");
  CREATE UNIQUE INDEX "interactions_interaction_id_idx" ON "interactions" USING btree ("interaction_id");
  CREATE INDEX "interactions_contact_id_string_idx" ON "interactions" USING btree ("contact_id_string");
  CREATE INDEX "interactions_contact_idx" ON "interactions" USING btree ("contact_id");
  CREATE INDEX "interactions_occurred_at_idx" ON "interactions" USING btree ("occurred_at");
  CREATE INDEX "interactions_updated_at_idx" ON "interactions" USING btree ("updated_at");
  CREATE INDEX "interactions_created_at_idx" ON "interactions" USING btree ("created_at");
  CREATE INDEX "contact_audit_log_contact_id_string_idx" ON "contact_audit_log" USING btree ("contact_id_string");
  CREATE INDEX "contact_audit_log_occurred_at_idx" ON "contact_audit_log" USING btree ("occurred_at");
  CREATE INDEX "contact_audit_log_updated_at_idx" ON "contact_audit_log" USING btree ("updated_at");
  CREATE INDEX "contact_audit_log_created_at_idx" ON "contact_audit_log" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_contacts_fk" FOREIGN KEY ("contacts_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_interactions_fk" FOREIGN KEY ("interactions_id") REFERENCES "public"."interactions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_contact_audit_log_fk" FOREIGN KEY ("contact_audit_log_id") REFERENCES "public"."contact_audit_log"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_contacts_id_idx" ON "payload_locked_documents_rels" USING btree ("contacts_id");
  CREATE INDEX "payload_locked_documents_rels_interactions_id_idx" ON "payload_locked_documents_rels" USING btree ("interactions_id");
  CREATE INDEX "payload_locked_documents_rels_contact_audit_log_id_idx" ON "payload_locked_documents_rels" USING btree ("contact_audit_log_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "contacts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "interactions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "contact_audit_log" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "contacts" CASCADE;
  DROP TABLE "interactions" CASCADE;
  DROP TABLE "contact_audit_log" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_contacts_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_interactions_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_contact_audit_log_fk";
  
  ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;
  ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'readonly'::text;
  DROP TYPE "public"."enum_users_role";
  CREATE TYPE "public"."enum_users_role" AS ENUM('admin', 'supervisor', 'operations', 'readonly', 'service');
  ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'readonly'::"public"."enum_users_role";
  ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."enum_users_role" USING "role"::"public"."enum_users_role";
  DROP INDEX "payload_locked_documents_rels_contacts_id_idx";
  DROP INDEX "payload_locked_documents_rels_interactions_id_idx";
  DROP INDEX "payload_locked_documents_rels_contact_audit_log_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "contacts_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "interactions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "contact_audit_log_id";
  DROP TYPE "public"."enum_contacts_source";
  DROP TYPE "public"."enum_contacts_channel_preference";
  DROP TYPE "public"."enum_contacts_derived_stage";
  DROP TYPE "public"."enum_contacts_loan_status";
  DROP TYPE "public"."enum_interactions_kind";
  DROP TYPE "public"."enum_interactions_direction";`)
}
