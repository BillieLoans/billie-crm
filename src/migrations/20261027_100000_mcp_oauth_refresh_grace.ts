import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * MCP connections keep the access token a refresh replaced valid until it
 * expires, and record when they were last refreshed, so a retried refresh is
 * refused without revoking the connection. See
 * `src/server/reporting/mcp-oauth.ts`. Safe to re-run.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE mcp_oauth_grants ADD COLUMN IF NOT EXISTS previous_access_index character varying;
ALTER TABLE mcp_oauth_grants ADD COLUMN IF NOT EXISTS previous_access_expires_at timestamp(3) with time zone;
ALTER TABLE mcp_oauth_grants ADD COLUMN IF NOT EXISTS refreshed_at timestamp(3) with time zone;
CREATE INDEX IF NOT EXISTS mcp_oauth_grants_previous_access_index_idx
  ON mcp_oauth_grants USING btree (previous_access_index);
`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
DROP INDEX IF EXISTS mcp_oauth_grants_previous_access_index_idx;
ALTER TABLE mcp_oauth_grants DROP COLUMN IF EXISTS refreshed_at;
ALTER TABLE mcp_oauth_grants DROP COLUMN IF EXISTS previous_access_expires_at;
ALTER TABLE mcp_oauth_grants DROP COLUMN IF EXISTS previous_access_index;
`),
  )
}
