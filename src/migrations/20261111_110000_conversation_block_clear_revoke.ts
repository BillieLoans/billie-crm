import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * "Undo clear" of a different-person clear on a verified-contact stop
 * (BTB-569).
 *
 * The applicant turned out to be the earlier customer after all, so the
 * contact must stop applications again. The undo, like the clear, belongs to
 * one stopped conversation. The event processor writes:
 *
 * - `reapplication_block_clear_revoke_status` ("pending" / "revoked" /
 *   "rejected") and `..._clear_revoke_request_id`: the latest undo request;
 * - `..._clear_revoked_at` / `_clear_revoked_by` /
 *   `_clear_revoke_justification`: the last undo billieChat applied
 *   (reapplication_block.clear_revoked.v1). `clear_revoked_at` also orders an
 *   undo against clears that arrive late;
 * - `..._clear_revoke_rejection` ("CODE: detail"): why billieChat refused the
 *   latest undo (reapplication_block.clear_revoke_rejected.v1);
 * - `..._revoked_clear_at` / `_revoked_clear_by` /
 *   `_revoked_clear_justification`: the clear that undo removed. An undo sets
 *   the conversation back to uncleared, so the clear-audit columns are free
 *   for the next clear; these keep the record of the one that was undone.
 *
 * IF NOT EXISTS, so it is a no-op where a `push: true` sync already made the
 * columns (dev, test).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "reapplication_block_clear_revoke_status" varchar;
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "reapplication_block_clear_revoke_request_id" varchar;
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "reapplication_block_clear_revoked_at" timestamp(3) with time zone;
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "reapplication_block_clear_revoked_by" varchar;
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "reapplication_block_clear_revoke_justification" varchar;
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "reapplication_block_clear_revoke_rejection" varchar;
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "reapplication_block_revoked_clear_at" timestamp(3) with time zone;
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "reapplication_block_revoked_clear_by" varchar;
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "reapplication_block_revoked_clear_justification" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "reapplication_block_clear_revoke_status";
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "reapplication_block_clear_revoke_request_id";
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "reapplication_block_clear_revoked_at";
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "reapplication_block_clear_revoked_by";
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "reapplication_block_clear_revoke_justification";
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "reapplication_block_clear_revoke_rejection";
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "reapplication_block_revoked_clear_at";
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "reapplication_block_revoked_clear_by";
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "reapplication_block_revoked_clear_justification";`)
}
