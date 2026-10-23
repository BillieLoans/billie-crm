import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Report emails and alerts: `report-subscriptions` (what each person asked
 * for) and `report-deliveries` (one claim per delivery owed, so the daily
 * job sends each at most once).
 *
 * Mirrors the DDL Payload's push generates for the collection configs
 * (diffed from a pushed schema), made safe to re-run.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
DO $$ BEGIN
  CREATE TYPE enum_report_subscriptions_kind AS ENUM ('digest', 'alert');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE enum_report_subscriptions_frequency AS ENUM ('daily', 'weekly', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE enum_report_subscriptions_channel AS ENUM ('email', 'slack');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE enum_report_subscriptions_alert_operator AS ENUM ('above', 'below');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE enum_report_deliveries_status AS ENUM ('sending', 'sent', 'checked', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS report_subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  report_id uuid,
  kind enum_report_subscriptions_kind NOT NULL,
  frequency enum_report_subscriptions_frequency,
  range character varying,
  parameters jsonb DEFAULT '{}'::jsonb,
  channel enum_report_subscriptions_channel DEFAULT 'email'::enum_report_subscriptions_channel NOT NULL,
  alert_column character varying,
  alert_row character varying,
  alert_value character varying,
  alert_operator enum_report_subscriptions_alert_operator,
  alert_threshold numeric,
  alert_active boolean DEFAULT false,
  alert_last_value numeric,
  paused boolean DEFAULT false,
  last_checked_at timestamp(3) with time zone,
  last_sent_at timestamp(3) with time zone,
  last_error character varying,
  updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
  created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS report_deliveries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  subscription_id uuid,
  claim_key character varying NOT NULL,
  status enum_report_deliveries_status NOT NULL,
  detail character varying,
  updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
  created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS report_subscriptions_id uuid;
ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS report_deliveries_id uuid;

DO $$ BEGIN
  ALTER TABLE ONLY report_subscriptions ADD CONSTRAINT report_subscriptions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY report_deliveries ADD CONSTRAINT report_deliveries_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS report_subscriptions_user_idx
  ON report_subscriptions USING btree (user_id);
CREATE INDEX IF NOT EXISTS report_subscriptions_report_idx
  ON report_subscriptions USING btree (report_id);
CREATE INDEX IF NOT EXISTS report_subscriptions_created_at_idx
  ON report_subscriptions USING btree (created_at);
CREATE INDEX IF NOT EXISTS report_subscriptions_updated_at_idx
  ON report_subscriptions USING btree (updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS report_deliveries_claim_key_idx
  ON report_deliveries USING btree (claim_key);
CREATE INDEX IF NOT EXISTS report_deliveries_subscription_idx
  ON report_deliveries USING btree (subscription_id);
CREATE INDEX IF NOT EXISTS report_deliveries_created_at_idx
  ON report_deliveries USING btree (created_at);
CREATE INDEX IF NOT EXISTS report_deliveries_updated_at_idx
  ON report_deliveries USING btree (updated_at);
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_report_subscriptions_id_idx
  ON payload_locked_documents_rels USING btree (report_subscriptions_id);
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_report_deliveries_id_idx
  ON payload_locked_documents_rels USING btree (report_deliveries_id);

DO $$ BEGIN
  ALTER TABLE ONLY report_subscriptions ADD CONSTRAINT report_subscriptions_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY report_subscriptions
    ADD CONSTRAINT report_subscriptions_report_id_report_definitions_id_fk
    FOREIGN KEY (report_id) REFERENCES report_definitions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY report_deliveries
    ADD CONSTRAINT report_deliveries_subscription_id_report_subscriptions_id_fk
    FOREIGN KEY (subscription_id) REFERENCES report_subscriptions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_report_subscriptions_fk
    FOREIGN KEY (report_subscriptions_id) REFERENCES report_subscriptions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE ONLY payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_report_deliveries_fk
    FOREIGN KEY (report_deliveries_id) REFERENCES report_deliveries(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE payload_locked_documents_rels DROP COLUMN IF EXISTS report_deliveries_id;
ALTER TABLE payload_locked_documents_rels DROP COLUMN IF EXISTS report_subscriptions_id;
DROP TABLE IF EXISTS report_deliveries;
DROP TABLE IF EXISTS report_subscriptions;
DROP TYPE IF EXISTS enum_report_deliveries_status;
DROP TYPE IF EXISTS enum_report_subscriptions_alert_operator;
DROP TYPE IF EXISTS enum_report_subscriptions_channel;
DROP TYPE IF EXISTS enum_report_subscriptions_frequency;
DROP TYPE IF EXISTS enum_report_subscriptions_kind;
`),
  )
}
