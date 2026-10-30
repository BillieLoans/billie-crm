import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

import { REPORTING_SCHEMA_STATEMENTS } from '../server/reporting/schema'

/**
 * Loans cancelled before disbursement (BTB-517).
 *
 * The event processor's handle_account_cancelled writes these straight into
 * Postgres on `account.cancelled.v1`, so they must exist before it deploys:
 *
 * - `loan_accounts.account_status` gains `cancelled`.
 * - `loan_accounts_repayment_schedule_payments.status` gains `void`, the status
 *   of every instalment of a cancelled loan.
 * - The `cancellation` group's columns (reason, note, evidence ref, who, when).
 *   `cancellation_reason` is plain text: the processor stores the platform's
 *   lower-case code verbatim.
 * - `reporting.loan` gains `cancellation_reason`, `cancelled_at` and
 *   `cancelled_on`, so the reporting schema statements are applied again
 *   (idempotent; they recreate every view). The note and the supervisor's name
 *   are free text and a person, so reporting does not carry them.
 *
 * `ALTER TYPE ... ADD VALUE` inside the migration transaction is fine here
 * because this migration only DEFINES the values; Postgres forbids using a new
 * enum value in the same transaction that adds it, not adding it. Everything
 * is IF NOT EXISTS so it is a no-op on any environment that already picked the
 * schema up from a `push: true` sync (dev, test).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_loan_accounts_account_status" ADD VALUE IF NOT EXISTS 'cancelled';
  ALTER TYPE "public"."enum_loan_accounts_repayment_schedule_payments_status" ADD VALUE IF NOT EXISTS 'void';
  ALTER TABLE "loan_accounts" ADD COLUMN IF NOT EXISTS "cancellation_reason" varchar;
  ALTER TABLE "loan_accounts" ADD COLUMN IF NOT EXISTS "cancellation_note" varchar;
  ALTER TABLE "loan_accounts" ADD COLUMN IF NOT EXISTS "cancellation_evidence_ref" varchar;
  ALTER TABLE "loan_accounts" ADD COLUMN IF NOT EXISTS "cancellation_cancelled_by_id" varchar;
  ALTER TABLE "loan_accounts" ADD COLUMN IF NOT EXISTS "cancellation_cancelled_by_name" varchar;
  ALTER TABLE "loan_accounts" ADD COLUMN IF NOT EXISTS "cancellation_cancelled_at" timestamp(3) with time zone;`)

  for (const statement of REPORTING_SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement))
  }
}

/**
 * Enum values are not dropped: any row still holding them would break the type.
 * The columns stay too: they are nullable and harmless, and `reporting.loan`
 * reads two of them, so Postgres would refuse to drop them while that view
 * exists. Nothing but the cancellation display reads them.
 */
export async function down(_args: MigrateDownArgs): Promise<void> {}
