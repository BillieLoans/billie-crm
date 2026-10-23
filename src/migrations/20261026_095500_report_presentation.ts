import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Reports UX: how a report presents its results. Timestamped before
 * 20261026_100000_first_reports, which writes every column through the
 * Local API and so must run after it on a fresh database. A catalogue `category`,
 * `featured` (headline numbers on the Reports home), `headline` (the
 * numbers above the chart) and `column_settings` (labels, formats, rate
 * bases), on report definitions and their versions. The `chart` column
 * already holds JSON, so one chart or a list of two needs no change.
 *
 * Mirrors the DDL Payload's push generates for the collection config
 * (diffed from a pushed schema), made safe to re-run.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
DO $$ BEGIN
  CREATE TYPE enum_report_definitions_category AS ENUM
    ('acquisition', 'credit', 'loan_book', 'arrears', 'operations', 'finance', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE enum__report_definitions_v_version_category AS ENUM
    ('acquisition', 'credit', 'loan_book', 'arrears', 'operations', 'finance', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE report_definitions ADD COLUMN IF NOT EXISTS category enum_report_definitions_category
  DEFAULT 'other'::enum_report_definitions_category;
ALTER TABLE report_definitions ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;
ALTER TABLE report_definitions ADD COLUMN IF NOT EXISTS headline jsonb DEFAULT '[]'::jsonb;
ALTER TABLE report_definitions ADD COLUMN IF NOT EXISTS column_settings jsonb DEFAULT '[]'::jsonb;

ALTER TABLE _report_definitions_v ADD COLUMN IF NOT EXISTS version_category
  enum__report_definitions_v_version_category
  DEFAULT 'other'::enum__report_definitions_v_version_category;
ALTER TABLE _report_definitions_v ADD COLUMN IF NOT EXISTS version_featured boolean DEFAULT false;
ALTER TABLE _report_definitions_v ADD COLUMN IF NOT EXISTS version_headline jsonb
  DEFAULT '[]'::jsonb;
ALTER TABLE _report_definitions_v ADD COLUMN IF NOT EXISTS version_column_settings jsonb
  DEFAULT '[]'::jsonb;
`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE _report_definitions_v DROP COLUMN IF EXISTS version_column_settings;
ALTER TABLE _report_definitions_v DROP COLUMN IF EXISTS version_headline;
ALTER TABLE _report_definitions_v DROP COLUMN IF EXISTS version_featured;
ALTER TABLE _report_definitions_v DROP COLUMN IF EXISTS version_category;
ALTER TABLE report_definitions DROP COLUMN IF EXISTS column_settings;
ALTER TABLE report_definitions DROP COLUMN IF EXISTS headline;
ALTER TABLE report_definitions DROP COLUMN IF EXISTS featured;
ALTER TABLE report_definitions DROP COLUMN IF EXISTS category;
DROP TYPE IF EXISTS enum__report_definitions_v_version_category;
DROP TYPE IF EXISTS enum_report_definitions_category;
`),
  )
}
