import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Terminal statuses for applications the customer did not take up, plus the
 * audit record behind them.
 *
 * `ALTER TYPE ... ADD VALUE` inside the migration transaction is fine here
 * because this migration only DEFINES the values — Postgres forbids using a
 * new enum value in the same transaction that adds it, not adding it.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_conversations_status" ADD VALUE IF NOT EXISTS 'cancelled';
  ALTER TYPE "public"."enum_conversations_status" ADD VALUE IF NOT EXISTS 'expired';
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "cancellation_record" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Enum values are not dropped: any row still holding them would break the
  // type. Dropping the column is the reversible half.
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "cancellation_record";`)
}
