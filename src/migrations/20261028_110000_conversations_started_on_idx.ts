import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Index the Sydney date a conversation started, so reports filtering on
 * reporting.application.started_on read the matching rows instead of
 * scanning every conversation. The expression is reporting.sydney_date's
 * body; it is declared for push in payload.config.ts's afterSchemaInit.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
CREATE INDEX IF NOT EXISTS "conversations_started_on_idx"
  ON "conversations" USING btree ((("started_at" AT TIME ZONE 'Australia/Sydney')::date));
`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(`DROP INDEX IF EXISTS "conversations_started_on_idx";`))
}
