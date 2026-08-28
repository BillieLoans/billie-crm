import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Re-issues the conversations LLM rollup columns (BTB-302/BTB-307).
 *
 * These columns live in 20260827_131500_llm_costs, but that migration was
 * amended after environments had already recorded it as applied — Payload
 * records migrations by name and skips them on re-run, so prod was left with
 * code selecting conversations.llm_cost_total_usd against a schema that never
 * received it, and every /api/conversations query failed (issue report
 * 9851ff6f, "No applications are being displayed"). Same trap and same remedy
 * as 20260827_214500_llm_costs_has_usage: schema changes must always land in
 * a NEW migration.
 *
 * All statements are IF [NOT] EXISTS, so this is a no-op on any database that
 * picked the columns up from the earlier migration (demo, fresh installs).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "llm_cost_total_usd" numeric;`)
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "llm_call_count" numeric;`)
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "llm_unpriced_count" numeric;`)
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "data_quality_alert" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "llm_cost_total_usd";`)
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "llm_call_count";`)
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "llm_unpriced_count";`)
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "data_quality_alert";`)
}
