import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Ordering account events by `account_version` (BTB-537).
 *
 * The platform stamps every `account.*` event with one counter per account.
 * The event processor (handlers/account.py) writes the highest version it has
 * applied onto the loan account row, and an older event then overwrites
 * nothing. These columns must exist before that processor deploys:
 *
 * - `account_state_version`: from account-state events (created, updated,
 *   status changed, closed, cancelled).
 * - `account_schedule_version`: from schedule events (schedule created and
 *   updated).
 *
 * They are separate because the counter is shared by both families: a schedule
 * event numbered 6 must not make a state event numbered 5 look old. Null means
 * no versioned event has been applied yet, and the next one is applied.
 *
 * `numeric` is what Payload's push creates for a `number` field. No reporting
 * view reads these, so the reporting schema is not applied again. Everything
 * is IF NOT EXISTS, so it is a no-op where a `push: true` sync already made
 * the columns (dev, test).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "loan_accounts" ADD COLUMN IF NOT EXISTS "account_state_version" numeric;
  ALTER TABLE "loan_accounts" ADD COLUMN IF NOT EXISTS "account_schedule_version" numeric;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "loan_accounts" DROP COLUMN IF EXISTS "account_state_version";
  ALTER TABLE "loan_accounts" DROP COLUMN IF EXISTS "account_schedule_version";`)
}
