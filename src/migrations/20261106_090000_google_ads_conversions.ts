import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * BTB-546: `google-ads-conversions`, the outbox for Google Ads offline click
 * conversions, unique on (application_number, conversion_name, action).
 *
 * Mirrors the DDL Payload's push generates for the collection config
 * (dumped from a pushed schema), made safe to re-run.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
DO $$ BEGIN
  CREATE TYPE enum_google_ads_conversions_conversion_name AS ENUM ('approved', 'funded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE enum_google_ads_conversions_action AS ENUM ('upload', 'retract');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE enum_google_ads_conversions_click_id_type AS ENUM ('gclid', 'gbraid', 'wbraid');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE enum_google_ads_conversions_status AS ENUM
    ('pending', 'sending', 'sent', 'failed', 'expired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS google_ads_conversions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  application_number character varying NOT NULL,
  conversation_id character varying,
  conversion_name enum_google_ads_conversions_conversion_name NOT NULL,
  action enum_google_ads_conversions_action DEFAULT 'upload'::enum_google_ads_conversions_action NOT NULL,
  click_id_type enum_google_ads_conversions_click_id_type NOT NULL,
  click_id character varying NOT NULL,
  click_at timestamp(3) with time zone,
  converted_at timestamp(3) with time zone NOT NULL,
  not_before timestamp(3) with time zone NOT NULL,
  expires_at timestamp(3) with time zone NOT NULL,
  mock_origin boolean DEFAULT false,
  status enum_google_ads_conversions_status DEFAULT 'pending'::enum_google_ads_conversions_status NOT NULL,
  status_reason character varying,
  attempts numeric DEFAULT 0,
  last_error_code character varying,
  last_attempt_at timestamp(3) with time zone,
  claimed_at timestamp(3) with time zone,
  sent_at timestamp(3) with time zone,
  validated_at timestamp(3) with time zone,
  updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
  created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS google_ads_conversions_id uuid;

DO $$ BEGIN
  ALTER TABLE ONLY google_ads_conversions ADD CONSTRAINT google_ads_conversions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS google_ads_conversions_key
  ON google_ads_conversions USING btree (application_number, conversion_name, action);
CREATE INDEX IF NOT EXISTS google_ads_conversions_due_idx
  ON google_ads_conversions USING btree (status, not_before);
CREATE INDEX IF NOT EXISTS google_ads_conversions_open_idx
  ON google_ads_conversions USING btree (status, expires_at);
CREATE INDEX IF NOT EXISTS google_ads_conversions_application_number_idx
  ON google_ads_conversions USING btree (application_number);
CREATE INDEX IF NOT EXISTS google_ads_conversions_conversation_id_idx
  ON google_ads_conversions USING btree (conversation_id);
CREATE INDEX IF NOT EXISTS google_ads_conversions_created_at_idx
  ON google_ads_conversions USING btree (created_at);
CREATE INDEX IF NOT EXISTS google_ads_conversions_updated_at_idx
  ON google_ads_conversions USING btree (updated_at);
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_google_ads_conversions_id_idx
  ON payload_locked_documents_rels USING btree (google_ads_conversions_id);

DO $$ BEGIN
  ALTER TABLE ONLY payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_google_ads_conversions_fk
    FOREIGN KEY (google_ads_conversions_id) REFERENCES google_ads_conversions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE payload_locked_documents_rels DROP COLUMN IF EXISTS google_ads_conversions_id;
DROP TABLE IF EXISTS google_ads_conversions;
DROP TYPE IF EXISTS enum_google_ads_conversions_status;
DROP TYPE IF EXISTS enum_google_ads_conversions_click_id_type;
DROP TYPE IF EXISTS enum_google_ads_conversions_action;
DROP TYPE IF EXISTS enum_google_ads_conversions_conversion_name;
`),
  )
}
