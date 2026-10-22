import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * BTB-508: Ask Claude. The report-asks request log, and `author` and
 * `origin` on report definitions (and their versions).
 *
 * Mirrors the DDL Payload's push generates for the collection configs
 * (diffed from a pushed schema), made safe to re-run.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
DO $$ BEGIN
  CREATE TYPE enum__report_definitions_v_version_origin AS ENUM ('manual', 'ask');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE enum_report_definitions_origin AS ENUM ('manual', 'ask');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE enum_report_asks_kind AS ENUM ('ask', 'refine', 'check');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE enum_report_asks_outcome AS ENUM
    ('ok', 'invalid', 'unanswerable', 'refused', 'invalid_output', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE report_definitions ADD COLUMN IF NOT EXISTS author_id uuid;
ALTER TABLE report_definitions ADD COLUMN IF NOT EXISTS origin enum_report_definitions_origin
  DEFAULT 'manual'::enum_report_definitions_origin;
ALTER TABLE _report_definitions_v ADD COLUMN IF NOT EXISTS version_author_id uuid;
ALTER TABLE _report_definitions_v ADD COLUMN IF NOT EXISTS version_origin
  enum__report_definitions_v_version_origin
  DEFAULT 'manual'::enum__report_definitions_v_version_origin;

CREATE TABLE IF NOT EXISTS report_asks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  kind enum_report_asks_kind NOT NULL,
  question character varying,
  refinement character varying,
  outcome enum_report_asks_outcome NOT NULL,
  model character varying,
  effort character varying,
  prompt_version character varying,
  schema_version character varying,
  input_tokens numeric,
  output_tokens numeric,
  cache_read_tokens numeric,
  cache_write_tokens numeric,
  latency_ms numeric,
  error_count numeric,
  warning_count numeric,
  definition jsonb,
  updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
  created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS report_asks_id uuid;

DO $$ BEGIN
  ALTER TABLE ONLY report_asks ADD CONSTRAINT report_asks_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS _report_definitions_v_version_version_author_idx
  ON _report_definitions_v USING btree (version_author_id);
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_report_asks_id_idx
  ON payload_locked_documents_rels USING btree (report_asks_id);
CREATE INDEX IF NOT EXISTS report_asks_created_at_idx ON report_asks USING btree (created_at);
CREATE INDEX IF NOT EXISTS report_asks_updated_at_idx ON report_asks USING btree (updated_at);
CREATE INDEX IF NOT EXISTS report_asks_user_idx ON report_asks USING btree (user_id);
CREATE INDEX IF NOT EXISTS report_definitions_author_idx
  ON report_definitions USING btree (author_id);

DO $$ BEGIN
  ALTER TABLE ONLY _report_definitions_v ADD CONSTRAINT _report_definitions_v_version_author_id_users_id_fk
    FOREIGN KEY (version_author_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY payload_locked_documents_rels ADD CONSTRAINT payload_locked_documents_rels_report_asks_fk
    FOREIGN KEY (report_asks_id) REFERENCES report_asks(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY report_asks ADD CONSTRAINT report_asks_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY report_definitions ADD CONSTRAINT report_definitions_author_id_users_id_fk
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE payload_locked_documents_rels DROP COLUMN IF EXISTS report_asks_id;
DROP TABLE IF EXISTS report_asks;
ALTER TABLE _report_definitions_v DROP COLUMN IF EXISTS version_origin;
ALTER TABLE _report_definitions_v DROP COLUMN IF EXISTS version_author_id;
ALTER TABLE report_definitions DROP COLUMN IF EXISTS origin;
ALTER TABLE report_definitions DROP COLUMN IF EXISTS author_id;
DROP TYPE IF EXISTS enum_report_asks_outcome;
DROP TYPE IF EXISTS enum_report_asks_kind;
DROP TYPE IF EXISTS enum_report_definitions_origin;
DROP TYPE IF EXISTS enum__report_definitions_v_version_origin;
`),
  )
}
