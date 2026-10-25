import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

import { REPORTING_SCHEMA_STATEMENTS } from '../server/reporting/schema'

/**
 * October 2026 security review of reporting and the MCP connector:
 *
 * - MCP API keys expire (`expires_at`; existing keys get 90 days from now
 *   for personal keys, a year for dashboard keys) and record their last
 *   use (`last_used_at`).
 * - A connection records the sign-in request it answered (`request_id`,
 *   unique), so a request is approved once.
 * - Report runs and Ask Claude requests record the MCP actor (key or
 *   connection), so a run by a shared dashboard key is told from its
 *   owner's own.
 * - The reporting views pass attribution text (utm_* values, which anyone
 *   can put in a link) through `reporting.attribution_text`, which keeps
 *   printable characters only and cuts at 80. The schema statements are
 *   idempotent and recreate every view.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE payload_mcp_api_keys ADD COLUMN IF NOT EXISTS expires_at timestamp(3) with time zone;
ALTER TABLE payload_mcp_api_keys ADD COLUMN IF NOT EXISTS last_used_at timestamp(3) with time zone;
CREATE INDEX IF NOT EXISTS payload_mcp_api_keys_expires_at_idx
  ON payload_mcp_api_keys USING btree (expires_at);
UPDATE payload_mcp_api_keys
   SET expires_at = now() + CASE WHEN scope = 'dashboard' THEN interval '365 days' ELSE interval '90 days' END
 WHERE expires_at IS NULL;

ALTER TABLE mcp_oauth_grants ADD COLUMN IF NOT EXISTS request_id character varying;
CREATE UNIQUE INDEX IF NOT EXISTS mcp_oauth_grants_request_id_idx
  ON mcp_oauth_grants USING btree (request_id);

ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS actor_scope character varying;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS actor_key character varying;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS actor_grant character varying;
ALTER TABLE report_asks ADD COLUMN IF NOT EXISTS actor_scope character varying;
ALTER TABLE report_asks ADD COLUMN IF NOT EXISTS actor_key character varying;
ALTER TABLE report_asks ADD COLUMN IF NOT EXISTS actor_grant character varying;
`),
  )
  for (const statement of REPORTING_SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement))
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE report_asks DROP COLUMN IF EXISTS actor_grant;
ALTER TABLE report_asks DROP COLUMN IF EXISTS actor_key;
ALTER TABLE report_asks DROP COLUMN IF EXISTS actor_scope;
ALTER TABLE report_runs DROP COLUMN IF EXISTS actor_grant;
ALTER TABLE report_runs DROP COLUMN IF EXISTS actor_key;
ALTER TABLE report_runs DROP COLUMN IF EXISTS actor_scope;
DROP INDEX IF EXISTS mcp_oauth_grants_request_id_idx;
ALTER TABLE mcp_oauth_grants DROP COLUMN IF EXISTS request_id;
DROP INDEX IF EXISTS payload_mcp_api_keys_expires_at_idx;
ALTER TABLE payload_mcp_api_keys DROP COLUMN IF EXISTS last_used_at;
ALTER TABLE payload_mcp_api_keys DROP COLUMN IF EXISTS expires_at;
DROP FUNCTION IF EXISTS reporting.attribution_text(text);
`),
  )
}
