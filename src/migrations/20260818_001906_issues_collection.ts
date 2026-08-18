import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_issues_status" AS ENUM('open', 'resolved');
  CREATE TABLE "issues" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar,
  	"description" varchar NOT NULL,
  	"trigger_reason" varchar,
  	"screenshot_uri" varchar,
  	"diagnostics" jsonb NOT NULL,
  	"status" "enum_issues_status" DEFAULT 'open' NOT NULL,
  	"resolution_note" varchar,
  	"resolved_at" timestamp(3) with time zone,
  	"resolved_by_id" uuid,
  	"reported_by_id" uuid,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "issues_id" uuid;
  ALTER TABLE "issues" ADD CONSTRAINT "issues_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "issues" ADD CONSTRAINT "issues_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "issues_status_idx" ON "issues" USING btree ("status");
  CREATE INDEX "issues_resolved_by_idx" ON "issues" USING btree ("resolved_by_id");
  CREATE INDEX "issues_reported_by_idx" ON "issues" USING btree ("reported_by_id");
  CREATE INDEX "issues_updated_at_idx" ON "issues" USING btree ("updated_at");
  CREATE INDEX "issues_created_at_idx" ON "issues" USING btree ("created_at");
  CREATE INDEX "issues_triage_grid_idx" ON "issues" USING btree ("status","created_at" desc);
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_issues_fk" FOREIGN KEY ("issues_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_issues_id_idx" ON "payload_locked_documents_rels" USING btree ("issues_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "issues" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "issues" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_issues_fk";
  
  DROP INDEX "payload_locked_documents_rels_issues_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "issues_id";
  DROP TYPE "public"."enum_issues_status";`)
}
