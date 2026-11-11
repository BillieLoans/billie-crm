import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * "Clear: different person" for a verified-contact stop (BTB-569).
 *
 * A verified-contact stop is cleared per stopped conversation, not per
 * customer, so billieChat's refusal of that clear has to be kept on the
 * conversation. The event processor writes
 * `reapplication_block_clear_rejection` ("CODE: detail") from
 * reapplication_block.clear_rejected.v1; who asked, when it was cleared and
 * why reuse the clear-audit columns the conversation already has.
 *
 * IF NOT EXISTS, so it is a no-op where a `push: true` sync already made the
 * column (dev, test).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "reapplication_block_clear_rejection" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "reapplication_block_clear_rejection";`)
}
