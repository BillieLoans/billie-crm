import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * `statement-file-deletions`: the append-only log of permanent bank-statement
 * file deletions from S3, one row per application per request. `warnings` is a
 * hasMany select, so Payload keeps it in a child table.
 *
 * Mirrors the DDL Payload's migrate:create generates for the collection config
 * (uuid ids throughout, including the payload_locked_documents_rels column),
 * made safe to re-run.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
DO $$ BEGIN
  CREATE TYPE enum_statement_file_deletions_warnings AS ENUM ('in_progress', 'funded_loan');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE enum_statement_file_deletions_scope AS ENUM ('application', 'customer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE enum_statement_file_deletions_status AS ENUM
    ('deleted', 'partial', 'failed', 'nothing_found');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS statement_file_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  conversation_id varchar NOT NULL,
  application_number varchar,
  customer_id_string varchar,
  scope enum_statement_file_deletions_scope NOT NULL,
  actor_id varchar NOT NULL,
  actor_email varchar,
  actor_name varchar,
  reason varchar NOT NULL,
  status enum_statement_file_deletions_status NOT NULL,
  files_found numeric NOT NULL,
  files_deleted numeric NOT NULL,
  error varchar,
  deleted_keys jsonb,
  failed_keys jsonb,
  occurred_at timestamp(3) with time zone NOT NULL,
  updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
  created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);

ALTER TABLE statement_file_deletions ADD COLUMN IF NOT EXISTS error varchar;

CREATE TABLE IF NOT EXISTS statement_file_deletions_warnings (
  "order" integer NOT NULL,
  parent_id uuid NOT NULL,
  value enum_statement_file_deletions_warnings,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE statement_file_deletions_warnings
    ADD CONSTRAINT statement_file_deletions_warnings_parent_fk
    FOREIGN KEY (parent_id) REFERENCES statement_file_deletions(id)
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS statement_file_deletions_warnings_order_idx
  ON statement_file_deletions_warnings USING btree ("order");
CREATE INDEX IF NOT EXISTS statement_file_deletions_warnings_parent_idx
  ON statement_file_deletions_warnings USING btree (parent_id);
CREATE INDEX IF NOT EXISTS statement_file_deletions_conversation_id_idx
  ON statement_file_deletions USING btree (conversation_id);
CREATE INDEX IF NOT EXISTS statement_file_deletions_application_number_idx
  ON statement_file_deletions USING btree (application_number);
CREATE INDEX IF NOT EXISTS statement_file_deletions_customer_id_string_idx
  ON statement_file_deletions USING btree (customer_id_string);
CREATE INDEX IF NOT EXISTS statement_file_deletions_occurred_at_idx
  ON statement_file_deletions USING btree (occurred_at);
CREATE INDEX IF NOT EXISTS statement_file_deletions_updated_at_idx
  ON statement_file_deletions USING btree (updated_at);
CREATE INDEX IF NOT EXISTS statement_file_deletions_created_at_idx
  ON statement_file_deletions USING btree (created_at);

ALTER TABLE payload_locked_documents_rels ADD COLUMN IF NOT EXISTS statement_file_deletions_id uuid;
CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_statement_file_deletions_i_idx
  ON payload_locked_documents_rels USING btree (statement_file_deletions_id);

DO $$ BEGIN
  ALTER TABLE payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_statement_file_deletions_fk
    FOREIGN KEY (statement_file_deletions_id) REFERENCES statement_file_deletions(id)
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
ALTER TABLE payload_locked_documents_rels DROP COLUMN IF EXISTS statement_file_deletions_id;
DROP TABLE IF EXISTS statement_file_deletions_warnings;
DROP TABLE IF EXISTS statement_file_deletions;
DROP TYPE IF EXISTS enum_statement_file_deletions_status;
DROP TYPE IF EXISTS enum_statement_file_deletions_scope;
DROP TYPE IF EXISTS enum_statement_file_deletions_warnings;
`),
  )
}
