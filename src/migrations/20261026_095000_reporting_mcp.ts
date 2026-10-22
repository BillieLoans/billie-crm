import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * BTB-509: the reporting MCP connector. The API key collection
 * (`payload-mcp-api-keys`, a plain collection: see `restrictApiKeys`), its
 * locked-documents relation, and the `mcp` values for report origin, run
 * trigger and the report-asks kind.
 *
 * Mirrors the DDL Payload's push generates for the collection configs
 * (diffed from a pushed schema), made safe to re-run. Runs before
 * `first_reports`, which uses the Local API on report definitions.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TYPE enum_report_definitions_origin ADD VALUE IF NOT EXISTS 'mcp';
ALTER TYPE enum__report_definitions_v_version_origin ADD VALUE IF NOT EXISTS 'mcp';
ALTER TYPE enum_report_runs_trigger ADD VALUE IF NOT EXISTS 'mcp';
ALTER TYPE enum_report_asks_kind ADD VALUE IF NOT EXISTS 'mcp_query';

CREATE TABLE IF NOT EXISTS payload_mcp_api_keys (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  label character varying,
  description character varying,
  report_definitions_find boolean DEFAULT false,
  report_definitions_create boolean DEFAULT false,
  report_definitions_update boolean DEFAULT false,
  payload_mcp_tool_describe_reporting_schema boolean DEFAULT true,
  payload_mcp_tool_run_report_query boolean DEFAULT true,
  payload_mcp_tool_run_report boolean DEFAULT true,
  api_key character varying,
  api_key_index character varying,
  updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
  created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE payload_mcp_api_keys ADD CONSTRAINT payload_mcp_api_keys_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE payload_mcp_api_keys ADD CONSTRAINT payload_mcp_api_keys_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS payload_mcp_api_keys_api_key_index_idx
  ON payload_mcp_api_keys USING btree (api_key_index);
CREATE INDEX IF NOT EXISTS payload_mcp_api_keys_created_at_idx
  ON payload_mcp_api_keys USING btree (created_at);
CREATE INDEX IF NOT EXISTS payload_mcp_api_keys_updated_at_idx
  ON payload_mcp_api_keys USING btree (updated_at);
CREATE INDEX IF NOT EXISTS payload_mcp_api_keys_user_idx
  ON payload_mcp_api_keys USING btree (user_id);

ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS payload_mcp_api_keys_id uuid;
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_payload_mcp_api_keys_id_idx
  ON payload_locked_documents_rels USING btree (payload_mcp_api_keys_id);
DO $$ BEGIN
  ALTER TABLE payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_payload_mcp_api_keys_fk
    FOREIGN KEY (payload_mcp_api_keys_id) REFERENCES payload_mcp_api_keys(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`),
  )
}

/** Enum values cannot be dropped in Postgres; the `mcp` values stay. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE payload_locked_documents_rels DROP COLUMN IF EXISTS payload_mcp_api_keys_id;
DROP TABLE IF EXISTS payload_mcp_api_keys;
`),
  )
}
