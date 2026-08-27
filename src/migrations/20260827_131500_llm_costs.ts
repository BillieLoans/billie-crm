import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TABLE IF NOT EXISTS "llm_costs" (
    "id" serial PRIMARY KEY NOT NULL,
    "stream_id" varchar NOT NULL,
    "conversation_id" varchar,
    "seq" numeric,
    "model" varchar,
    "agent_name" varchar,
    "service_tier" varchar,
    "prompt_tokens" numeric,
    "completion_tokens" numeric,
    "cached_tokens" numeric,
    "reasoning_tokens" numeric,
    "total_tokens" numeric,
    "response_time_ms" numeric,
    "logged_cost_usd" numeric,
    "computed_cost_usd" numeric,
    "rate_version" varchar,
    "priced" boolean,
    "called_at" timestamp(3) with time zone,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );`)
  await db.execute(sql`
  CREATE UNIQUE INDEX IF NOT EXISTS "llm_costs_stream_id_idx" ON "llm_costs" ("stream_id");`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "llm_costs_conversation_id_idx" ON "llm_costs" ("conversation_id");`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "llm_costs_model_idx" ON "llm_costs" ("model");`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "llm_costs_agent_name_idx" ON "llm_costs" ("agent_name");`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "llm_costs_called_at_idx" ON "llm_costs" ("called_at");`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "llm_costs_updated_at_idx" ON "llm_costs" ("updated_at");`)
  await db.execute(sql`
  CREATE INDEX IF NOT EXISTS "llm_costs_created_at_idx" ON "llm_costs" ("created_at");`)
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "llm_cost_total_usd" numeric;`)
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "llm_call_count" numeric;`)
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "llm_unpriced_count" numeric;`)
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "data_quality_alert" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP TABLE IF EXISTS "llm_costs";`)
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "llm_cost_total_usd";`)
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "llm_call_count";`)
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "llm_unpriced_count";`)
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "data_quality_alert";`)
}
