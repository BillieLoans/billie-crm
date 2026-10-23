import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Report boards: `report-boards`, a page of report tiles on one shared
 * period at /admin/reports/boards/<slug>.
 *
 * Mirrors the DDL Payload's push generates for the collection config
 * (diffed from a pushed schema), made safe to re-run.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
CREATE TABLE IF NOT EXISTS report_boards (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  title character varying NOT NULL,
  slug character varying NOT NULL,
  description character varying,
  tiles jsonb DEFAULT '[]'::jsonb,
  author_id uuid,
  updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
  created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS report_boards_id uuid;

DO $$ BEGIN
  ALTER TABLE ONLY report_boards ADD CONSTRAINT report_boards_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS report_boards_slug_idx ON report_boards USING btree (slug);
CREATE INDEX IF NOT EXISTS report_boards_author_idx ON report_boards USING btree (author_id);
CREATE INDEX IF NOT EXISTS report_boards_created_at_idx ON report_boards USING btree (created_at);
CREATE INDEX IF NOT EXISTS report_boards_updated_at_idx ON report_boards USING btree (updated_at);
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_report_boards_id_idx
  ON payload_locked_documents_rels USING btree (report_boards_id);

DO $$ BEGIN
  ALTER TABLE ONLY report_boards ADD CONSTRAINT report_boards_author_id_users_id_fk
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_report_boards_fk
    FOREIGN KEY (report_boards_id) REFERENCES report_boards(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE payload_locked_documents_rels DROP COLUMN IF EXISTS report_boards_id;
DROP TABLE IF EXISTS report_boards;
`),
  )
}
