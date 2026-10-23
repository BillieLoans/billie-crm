import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * OAuth sign-in for the reporting MCP connector: registered clients
 * (`mcp-oauth-clients`), connections (`mcp-oauth-grants`) and their
 * locked-documents relations. See `src/server/reporting/mcp-oauth.ts`.
 *
 * Mirrors the DDL Payload's push generates for the collection configs
 * (diffed from a pushed schema), made safe to re-run.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
DO $$ BEGIN
  CREATE TYPE enum_mcp_oauth_clients_token_endpoint_auth_method AS ENUM
    ('none', 'client_secret_post', 'client_secret_basic');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  client_id character varying NOT NULL,
  client_name character varying,
  redirect_uris jsonb NOT NULL,
  token_endpoint_auth_method enum_mcp_oauth_clients_token_endpoint_auth_method
    DEFAULT 'none'::enum_mcp_oauth_clients_token_endpoint_auth_method NOT NULL,
  secret_index character varying,
  updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
  created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE mcp_oauth_clients ADD CONSTRAINT mcp_oauth_clients_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS mcp_oauth_clients_client_id_idx
  ON mcp_oauth_clients USING btree (client_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_clients_created_at_idx
  ON mcp_oauth_clients USING btree (created_at);
CREATE INDEX IF NOT EXISTS mcp_oauth_clients_updated_at_idx
  ON mcp_oauth_clients USING btree (updated_at);

CREATE TABLE IF NOT EXISTS mcp_oauth_grants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  client_id character varying NOT NULL,
  client_name character varying,
  redirect_uri character varying NOT NULL,
  redirect_host character varying,
  scope character varying,
  resource character varying NOT NULL,
  code_index character varying,
  code_challenge character varying,
  code_expires_at timestamp(3) with time zone,
  code_used boolean DEFAULT false,
  access_index character varying,
  access_expires_at timestamp(3) with time zone,
  refresh_index character varying,
  previous_refresh_index character varying,
  refresh_expires_at timestamp(3) with time zone,
  last_used_at timestamp(3) with time zone,
  updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
  created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE mcp_oauth_grants ADD CONSTRAINT mcp_oauth_grants_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE mcp_oauth_grants ADD CONSTRAINT mcp_oauth_grants_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS mcp_oauth_grants_access_index_idx
  ON mcp_oauth_grants USING btree (access_index);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_oauth_grants_code_index_idx
  ON mcp_oauth_grants USING btree (code_index);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_oauth_grants_refresh_index_idx
  ON mcp_oauth_grants USING btree (refresh_index);
CREATE INDEX IF NOT EXISTS mcp_oauth_grants_previous_refresh_index_idx
  ON mcp_oauth_grants USING btree (previous_refresh_index);
CREATE INDEX IF NOT EXISTS mcp_oauth_grants_client_id_idx
  ON mcp_oauth_grants USING btree (client_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_grants_user_idx
  ON mcp_oauth_grants USING btree (user_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_grants_created_at_idx
  ON mcp_oauth_grants USING btree (created_at);
CREATE INDEX IF NOT EXISTS mcp_oauth_grants_updated_at_idx
  ON mcp_oauth_grants USING btree (updated_at);

ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS mcp_oauth_clients_id uuid;
ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS mcp_oauth_grants_id uuid;
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_mcp_oauth_clients_id_idx
  ON payload_locked_documents_rels USING btree (mcp_oauth_clients_id);
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_mcp_oauth_grants_id_idx
  ON payload_locked_documents_rels USING btree (mcp_oauth_grants_id);
DO $$ BEGIN
  ALTER TABLE payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_mcp_oauth_clients_fk
    FOREIGN KEY (mcp_oauth_clients_id) REFERENCES mcp_oauth_clients(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_mcp_oauth_grants_fk
    FOREIGN KEY (mcp_oauth_grants_id) REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE payload_locked_documents_rels DROP COLUMN IF EXISTS mcp_oauth_grants_id;
ALTER TABLE payload_locked_documents_rels DROP COLUMN IF EXISTS mcp_oauth_clients_id;
DROP TABLE IF EXISTS mcp_oauth_grants;
DROP TABLE IF EXISTS mcp_oauth_clients;
DROP TYPE IF EXISTS enum_mcp_oauth_clients_token_endpoint_auth_method;
`),
  )
}
