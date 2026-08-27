import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Adds `llm_costs.has_usage` (BTB-302).
 *
 * This column was originally appended to 20260827_131500_llm_costs, but that
 * migration had already been applied — Payload records migrations by name and
 * skips them on re-run, so the appended ALTER never executed and any
 * environment already carrying batch 24 was left with code expecting a column
 * the schema did not have. Schema changes must always land in a NEW migration.
 *
 * Both statements are IF [NOT] EXISTS, so this is a no-op on a fresh database
 * that picked the column up from the earlier migration.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "llm_costs" ADD COLUMN IF NOT EXISTS "has_usage" boolean;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "llm_costs" DROP COLUMN IF EXISTS "has_usage";`)
}
