import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_release_gate_status_mode" ADD VALUE 'closed';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "release_gate_status" ALTER COLUMN "mode" SET DATA TYPE text;
  DROP TYPE "public"."enum_release_gate_status_mode";
  CREATE TYPE "public"."enum_release_gate_status_mode" AS ENUM('open', 'gated');
  ALTER TABLE "release_gate_status" ALTER COLUMN "mode" SET DATA TYPE "public"."enum_release_gate_status_mode" USING "mode"::"public"."enum_release_gate_status_mode";`)
}
