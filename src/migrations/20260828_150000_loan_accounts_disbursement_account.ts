import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Adds the nominated salary account columns to loan_accounts, plus the
 * disbursement_access_log audit table (BTB-279).
 *
 * These back the `disbursementAccount` group and `applicationNumber` field on the
 * LoanAccounts collection,
 * projected from `account.created.v1.disbursement_account` (accounts-v2.11.0+).
 * They are what the manual-Osko disbursement queue copies out, so a 50-loan day
 * needs no account numbers typed by hand.
 *
 * All three are nullable text, never numeric: a leading zero is significant in
 * an Australian BSB ("013257"), and account numbers can carry them too. They stay
 * null on every loan created before the SDK bump — the queue flags those rows and
 * sends the operator to the signed agreement instead.
 *
 * IF NOT EXISTS throughout so this is a no-op on any environment that already
 * picked the columns up from a push:true dev/test schema sync.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "loan_accounts" ADD COLUMN IF NOT EXISTS "disbursement_account_holder" varchar;`)
  await db.execute(sql`
  ALTER TABLE "loan_accounts" ADD COLUMN IF NOT EXISTS "disbursement_account_bsb" varchar;`)
  await db.execute(sql`
  ALTER TABLE "loan_accounts" ADD COLUMN IF NOT EXISTS "disbursement_account_number" varchar;`)
  await db.execute(sql`
  ALTER TABLE "loan_accounts" ADD COLUMN IF NOT EXISTS "application_number" varchar;`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "loan_accounts_application_number_idx" ON "loan_accounts" ("application_number");`)

  // Audit trail for payout-detail reveals/copies (ux-standards §4).
  // id is uuid, NOT serial: the adapter runs with idType: 'uuid', and a serial id
  // here would give payload_locked_documents_rels an integer column, which breaks
  // the document-lock OR-chain and blanks EVERY admin detail view — the exact
  // BTB-302 failure that 20260827_230000_llm_costs_uuid_id had to undo.
  await db.execute(sql`
  CREATE TABLE IF NOT EXISTS "disbursement_access_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "loan_account_id" varchar NOT NULL,
    "account_number" varchar,
    "action" varchar NOT NULL,
    "field" varchar NOT NULL,
    "actor_id" uuid,
    "actor_email" varchar,
    "occurred_at" timestamp(3) with time zone NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "disbursement_access_log_loan_account_id_idx" ON "disbursement_access_log" ("loan_account_id");`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "disbursement_access_log_action_idx" ON "disbursement_access_log" ("action");`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "disbursement_access_log_actor_idx" ON "disbursement_access_log" ("actor_id");`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "disbursement_access_log_actor_email_idx" ON "disbursement_access_log" ("actor_email");`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "disbursement_access_log_occurred_at_idx" ON "disbursement_access_log" ("occurred_at");`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "disbursement_access_log_updated_at_idx" ON "disbursement_access_log" ("updated_at");`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "disbursement_access_log_created_at_idx" ON "disbursement_access_log" ("created_at");`)
  await db.execute(sql`
  DO $$ BEGIN
    ALTER TABLE "disbursement_access_log"
      ADD CONSTRAINT "disbursement_access_log_actor_id_users_id_fk"
      FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;`)

  // Payload's document-lock check ORs across every rels column, so a new
  // collection needs its column here or opening a locked doc errors.
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "disbursement_access_log_id" uuid;`)
  await db.execute(sql`
  DO $$ BEGIN
    ALTER TABLE "payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_disbursement_access_log_fk"
      FOREIGN KEY ("disbursement_access_log_id") REFERENCES "public"."disbursement_access_log"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_disbursement_access_log_id_idx"
    ON "payload_locked_documents_rels" USING btree ("disbursement_access_log_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_disbursement_access_log_fk";`)
  await db.execute(sql`
  DROP INDEX IF EXISTS "payload_locked_documents_rels_disbursement_access_log_id_idx";`)
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "disbursement_access_log_id";`)
  await db.execute(sql`
  DROP TABLE IF EXISTS "disbursement_access_log";`)
  await db.execute(sql`
  ALTER TABLE "loan_accounts" DROP COLUMN IF EXISTS "disbursement_account_holder";`)
  await db.execute(sql`
  ALTER TABLE "loan_accounts" DROP COLUMN IF EXISTS "disbursement_account_bsb";`)
  await db.execute(sql`
  ALTER TABLE "loan_accounts" DROP COLUMN IF EXISTS "disbursement_account_number";`)
  await db.execute(sql`
  DROP INDEX IF EXISTS "loan_accounts_application_number_idx";`)
  await db.execute(sql`
  ALTER TABLE "loan_accounts" DROP COLUMN IF EXISTS "application_number";`)
}
