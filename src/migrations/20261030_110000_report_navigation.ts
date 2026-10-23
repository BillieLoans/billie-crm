import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Reports UX navigation: `report-preferences` (each person's pinned
 * reports), `report-events` (searches, downloads and copies, for the usage
 * page), and the run triggers for the Reports home, subscriptions, alerts
 * and boards.
 *
 * Mirrors the DDL Payload's push generates for the collection configs
 * (diffed from a pushed schema), made safe to re-run.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TYPE enum_report_runs_trigger ADD VALUE IF NOT EXISTS 'home';
ALTER TYPE enum_report_runs_trigger ADD VALUE IF NOT EXISTS 'subscription';
ALTER TYPE enum_report_runs_trigger ADD VALUE IF NOT EXISTS 'alert';
ALTER TYPE enum_report_runs_trigger ADD VALUE IF NOT EXISTS 'board';

DO $$ BEGIN
  CREATE TYPE enum_report_events_kind AS ENUM
    ('search', 'search_open', 'csv', 'copy_link', 'copy_table', 'copy_chart', 'ask_save');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS report_preferences (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  pinned jsonb DEFAULT '[]'::jsonb,
  updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
  created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS report_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kind enum_report_events_kind NOT NULL,
  report_slug character varying,
  query character varying,
  user_id uuid,
  updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
  created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS report_preferences_id uuid;
ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS report_events_id uuid;

DO $$ BEGIN
  ALTER TABLE ONLY report_preferences ADD CONSTRAINT report_preferences_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY report_events ADD CONSTRAINT report_events_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS report_preferences_user_idx
  ON report_preferences USING btree (user_id);
CREATE INDEX IF NOT EXISTS report_preferences_created_at_idx
  ON report_preferences USING btree (created_at);
CREATE INDEX IF NOT EXISTS report_preferences_updated_at_idx
  ON report_preferences USING btree (updated_at);
CREATE INDEX IF NOT EXISTS report_events_created_at_idx ON report_events USING btree (created_at);
CREATE INDEX IF NOT EXISTS report_events_updated_at_idx ON report_events USING btree (updated_at);
CREATE INDEX IF NOT EXISTS report_events_kind_idx ON report_events USING btree (kind);
CREATE INDEX IF NOT EXISTS report_events_report_slug_idx ON report_events USING btree (report_slug);
CREATE INDEX IF NOT EXISTS report_events_user_idx ON report_events USING btree (user_id);
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_report_preferences_id_idx
  ON payload_locked_documents_rels USING btree (report_preferences_id);
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_report_events_id_idx
  ON payload_locked_documents_rels USING btree (report_events_id);

DO $$ BEGIN
  ALTER TABLE ONLY report_preferences ADD CONSTRAINT report_preferences_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY report_events ADD CONSTRAINT report_events_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_report_preferences_fk
    FOREIGN KEY (report_preferences_id) REFERENCES report_preferences(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_report_events_fk
    FOREIGN KEY (report_events_id) REFERENCES report_events(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`),
  )
}

/** Drops the new tables. Enum values cannot be removed from a Postgres type; they stay unused. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE payload_locked_documents_rels DROP COLUMN IF EXISTS report_events_id;
ALTER TABLE payload_locked_documents_rels DROP COLUMN IF EXISTS report_preferences_id;
DROP TABLE IF EXISTS report_events;
DROP TABLE IF EXISTS report_preferences;
DROP TYPE IF EXISTS enum_report_events_kind;
`),
  )
}
