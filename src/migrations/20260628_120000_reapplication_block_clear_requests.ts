import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_reapplication_block_clear_requests_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');
    CREATE TABLE "reapplication_block_clear_requests" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "request_id" varchar NOT NULL,
      "event_id" varchar,
      "request_number" varchar,
      "canonical_customer_id" varchar NOT NULL,
      "conversation_id" varchar,
      "customer_name" varchar,
      "reasons" jsonb,
      "justification" varchar,
      "status" "enum_reapplication_block_clear_requests_status" DEFAULT 'pending' NOT NULL,
      "requested_by_id" uuid,
      "requested_by_name" varchar,
      "requested_at" timestamp(3) with time zone,
      "approval_details_approved_by" varchar,
      "approval_details_approved_by_name" varchar,
      "approval_details_approved_at" timestamp(3) with time zone,
      "approval_details_comment" varchar,
      "approval_details_rejected_by" varchar,
      "approval_details_rejected_by_name" varchar,
      "approval_details_reason" varchar,
      "approval_details_rejected_at" timestamp(3) with time zone,
      "cancellation_details_cancelled_by" varchar,
      "cancellation_details_cancelled_by_name" varchar,
      "cancellation_details_cancelled_at" timestamp(3) with time zone,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    CREATE UNIQUE INDEX "rbcr_request_id_idx" ON "reapplication_block_clear_requests" ("request_id");
    CREATE INDEX "rbcr_status_created_idx" ON "reapplication_block_clear_requests" ("status","created_at");
    ALTER TABLE "reapplication_block_clear_requests" ADD CONSTRAINT "rbcr_requested_by_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

    ALTER TABLE "conversations" ADD COLUMN "reapplication_block_clear_status" varchar;
    ALTER TABLE "conversations" ADD COLUMN "reapplication_block_cleared_at" timestamp(3) with time zone;
    ALTER TABLE "conversations" ADD COLUMN "reapplication_block_cleared_by" varchar;
    ALTER TABLE "conversations" ADD COLUMN "reapplication_block_clear_justification" varchar;
    ALTER TABLE "conversations" ADD COLUMN "reapplication_block_clear_request_id" varchar;
    ALTER TABLE "customers" ADD COLUMN "reapplication_block_clear_status" varchar;
    ALTER TABLE "customers" ADD COLUMN "reapplication_block_cleared_at" timestamp(3) with time zone;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "reapplication_block_clear_requests" CASCADE;
    DROP TYPE "public"."enum_reapplication_block_clear_requests_status";
    ALTER TABLE "conversations" DROP COLUMN "reapplication_block_clear_status";
    ALTER TABLE "conversations" DROP COLUMN "reapplication_block_cleared_at";
    ALTER TABLE "conversations" DROP COLUMN "reapplication_block_cleared_by";
    ALTER TABLE "conversations" DROP COLUMN "reapplication_block_clear_justification";
    ALTER TABLE "conversations" DROP COLUMN "reapplication_block_clear_request_id";
    ALTER TABLE "customers" DROP COLUMN "reapplication_block_clear_status";
    ALTER TABLE "customers" DROP COLUMN "reapplication_block_cleared_at";
  `)
}
