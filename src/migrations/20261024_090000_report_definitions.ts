import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * BTB-506: the report-definitions collection (with drafts and versions) and
 * the append-only report-runs log.
 *
 * Mirrors the DDL Payload's push generates for the collection configs
 * (diffed from a pushed schema), made safe to re-run.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(`
DO $$ BEGIN
  CREATE TYPE enum__report_definitions_v_version_roles AS ENUM (
      'admin',
      'supervisor',
      'operations',
      'readonly'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE enum__report_definitions_v_version_schedule AS ENUM (
      'none',
      'weekly_monday'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE enum__report_definitions_v_version_status AS ENUM (
      'draft',
      'published'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE enum_report_definitions_roles AS ENUM (
      'admin',
      'supervisor',
      'operations',
      'readonly'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE enum_report_definitions_schedule AS ENUM (
      'none',
      'weekly_monday'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE enum_report_definitions_status AS ENUM (
      'draft',
      'published'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE enum_report_runs_outcome AS ENUM (
      'ok',
      'timeout',
      'refused',
      'error'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS _report_definitions_v (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_id uuid,
    version_title character varying,
    version_slug character varying,
    version_description character varying,
    version_sql character varying,
    version_parameters jsonb DEFAULT '[]'::jsonb,
    version_chart jsonb,
    version_schedule enum__report_definitions_v_version_schedule DEFAULT 'none'::enum__report_definitions_v_version_schedule,
    version_updated_at timestamp(3) with time zone,
    version_created_at timestamp(3) with time zone,
    version__status enum__report_definitions_v_version_status DEFAULT 'draft'::enum__report_definitions_v_version_status,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    latest boolean
);

CREATE TABLE IF NOT EXISTS _report_definitions_v_version_roles (
    "order" integer NOT NULL,
    parent_id uuid NOT NULL,
    value enum__report_definitions_v_version_roles,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);

CREATE TABLE IF NOT EXISTS report_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying,
    slug character varying,
    description character varying,
    sql character varying,
    parameters jsonb DEFAULT '[]'::jsonb,
    chart jsonb,
    schedule enum_report_definitions_schedule DEFAULT 'none'::enum_report_definitions_schedule,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    _status enum_report_definitions_status DEFAULT 'draft'::enum_report_definitions_status
);

CREATE TABLE IF NOT EXISTS report_definitions_roles (
    "order" integer NOT NULL,
    parent_id uuid NOT NULL,
    value enum_report_definitions_roles,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);

CREATE TABLE IF NOT EXISTS report_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_slug character varying,
    report_id uuid,
    version character varying,
    user_id uuid,
    parameters jsonb,
    outcome enum_report_runs_outcome NOT NULL,
    error_code character varying,
    duration_ms numeric,
    row_count numeric,
    truncated boolean DEFAULT false,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS report_definitions_id uuid;
ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS report_runs_id uuid;

DO $$ BEGIN
  ALTER TABLE ONLY _report_definitions_v
      ADD CONSTRAINT _report_definitions_v_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY _report_definitions_v_version_roles
      ADD CONSTRAINT _report_definitions_v_version_roles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY report_definitions
      ADD CONSTRAINT report_definitions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY report_definitions_roles
      ADD CONSTRAINT report_definitions_roles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY report_runs
      ADD CONSTRAINT report_runs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS _report_definitions_v_created_at_idx ON _report_definitions_v USING btree (created_at);

CREATE INDEX IF NOT EXISTS _report_definitions_v_latest_idx ON _report_definitions_v USING btree (latest);

CREATE INDEX IF NOT EXISTS _report_definitions_v_parent_idx ON _report_definitions_v USING btree (parent_id);

CREATE INDEX IF NOT EXISTS _report_definitions_v_updated_at_idx ON _report_definitions_v USING btree (updated_at);

CREATE INDEX IF NOT EXISTS _report_definitions_v_version_roles_order_idx ON _report_definitions_v_version_roles USING btree ("order");

CREATE INDEX IF NOT EXISTS _report_definitions_v_version_roles_parent_idx ON _report_definitions_v_version_roles USING btree (parent_id);

CREATE INDEX IF NOT EXISTS _report_definitions_v_version_version__status_idx ON _report_definitions_v USING btree (version__status);

CREATE INDEX IF NOT EXISTS _report_definitions_v_version_version_created_at_idx ON _report_definitions_v USING btree (version_created_at);

CREATE INDEX IF NOT EXISTS _report_definitions_v_version_version_slug_idx ON _report_definitions_v USING btree (version_slug);

CREATE INDEX IF NOT EXISTS _report_definitions_v_version_version_updated_at_idx ON _report_definitions_v USING btree (version_updated_at);

CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_report_definitions_id_idx ON payload_locked_documents_rels USING btree (report_definitions_id);

CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_report_runs_id_idx ON payload_locked_documents_rels USING btree (report_runs_id);

CREATE INDEX IF NOT EXISTS report_definitions__status_idx ON report_definitions USING btree (_status);

CREATE INDEX IF NOT EXISTS report_definitions_created_at_idx ON report_definitions USING btree (created_at);

CREATE INDEX IF NOT EXISTS report_definitions_roles_order_idx ON report_definitions_roles USING btree ("order");

CREATE INDEX IF NOT EXISTS report_definitions_roles_parent_idx ON report_definitions_roles USING btree (parent_id);

CREATE UNIQUE INDEX IF NOT EXISTS report_definitions_slug_idx ON report_definitions USING btree (slug);

CREATE INDEX IF NOT EXISTS report_definitions_updated_at_idx ON report_definitions USING btree (updated_at);

CREATE INDEX IF NOT EXISTS report_runs_created_at_idx ON report_runs USING btree (created_at);

CREATE INDEX IF NOT EXISTS report_runs_report_idx ON report_runs USING btree (report_id);

CREATE INDEX IF NOT EXISTS report_runs_report_slug_idx ON report_runs USING btree (report_slug);

CREATE INDEX IF NOT EXISTS report_runs_updated_at_idx ON report_runs USING btree (updated_at);

CREATE INDEX IF NOT EXISTS report_runs_user_idx ON report_runs USING btree (user_id);

DO $$ BEGIN
  ALTER TABLE ONLY _report_definitions_v
      ADD CONSTRAINT _report_definitions_v_parent_id_report_definitions_id_fk FOREIGN KEY (parent_id) REFERENCES report_definitions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY _report_definitions_v_version_roles
      ADD CONSTRAINT _report_definitions_v_version_roles_parent_fk FOREIGN KEY (parent_id) REFERENCES _report_definitions_v(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY payload_locked_documents_rels
      ADD CONSTRAINT payload_locked_documents_rels_report_definitions_fk FOREIGN KEY (report_definitions_id) REFERENCES report_definitions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY payload_locked_documents_rels
      ADD CONSTRAINT payload_locked_documents_rels_report_runs_fk FOREIGN KEY (report_runs_id) REFERENCES report_runs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY report_definitions_roles
      ADD CONSTRAINT report_definitions_roles_parent_fk FOREIGN KEY (parent_id) REFERENCES report_definitions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY report_runs
      ADD CONSTRAINT report_runs_report_id_report_definitions_id_fk FOREIGN KEY (report_id) REFERENCES report_definitions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY report_runs
      ADD CONSTRAINT report_runs_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
`))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(`
ALTER TABLE payload_locked_documents_rels DROP COLUMN IF EXISTS report_runs_id;
ALTER TABLE payload_locked_documents_rels DROP COLUMN IF EXISTS report_definitions_id;
DROP TABLE IF EXISTS report_runs;
DROP TABLE IF EXISTS _report_definitions_v_version_roles;
DROP TABLE IF EXISTS _report_definitions_v;
DROP TABLE IF EXISTS report_definitions_roles;
DROP TABLE IF EXISTS report_definitions;
DROP TYPE IF EXISTS enum_report_runs_outcome;
DROP TYPE IF EXISTS enum__report_definitions_v_version_status;
DROP TYPE IF EXISTS enum__report_definitions_v_version_schedule;
DROP TYPE IF EXISTS enum__report_definitions_v_version_roles;
DROP TYPE IF EXISTS enum_report_definitions_status;
DROP TYPE IF EXISTS enum_report_definitions_schedule;
DROP TYPE IF EXISTS enum_report_definitions_roles;
`))
}
