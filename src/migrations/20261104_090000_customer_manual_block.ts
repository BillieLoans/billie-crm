import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * The CRM's "Set manual block" (BTB-517).
 *
 * The event processor writes these on the canonical customer row:
 *
 * - `reapplication_block_manual_block_request_id`: written by
 *   reapplication_block.state.changed.v1 only, in its version-guarded upsert.
 *   The manual-set request that raised the block shown now; null when anything
 *   else did (a conversation kill, a merge, an unblock).
 * - `reapplication_block_manual_set_request_id` / `_reason_code`: the latest
 *   set billieChat applied (reapplication_block.manual_set_applied.v1).
 * - `reapplication_block_manual_set_rejected_request_id` / `_rejection`: the
 *   latest set billieChat refused (reapplication_block.manual_set_rejected.v1).
 *
 * The block's reason code is shown only when the first two name the same
 * request. Everything is IF NOT EXISTS, so it is a no-op where a `push: true`
 * sync already made the columns (dev, test).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "reapplication_block_manual_block_request_id" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "reapplication_block_manual_set_request_id" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "reapplication_block_manual_set_reason_code" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "reapplication_block_manual_set_rejected_request_id" varchar;
  ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "reapplication_block_manual_set_rejection" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "reapplication_block_manual_block_request_id";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "reapplication_block_manual_set_request_id";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "reapplication_block_manual_set_reason_code";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "reapplication_block_manual_set_rejected_request_id";
  ALTER TABLE "customers" DROP COLUMN IF EXISTS "reapplication_block_manual_set_rejection";`)
}
