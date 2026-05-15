/**
 * Vitest global setup — spins up a fresh Postgres container before all
 * tests, then triggers Payload's `push: true` schema sync against it so
 * every collection is materialised before any test runs.
 *
 * Replaces the previous MongoMemoryServer-based setup as part of the
 * Mongo → Postgres migration. Requires Docker to be running.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { GlobalSetupContext } from 'vitest/node'

let pg: StartedPostgreSqlContainer | undefined

export async function setup({ provide }: GlobalSetupContext) {
  console.log('[globalSetup] Starting Postgres container…')
  pg = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('billie_crm_test')
    .withUsername('billie_crm')
    .withPassword('test_password')
    .start()

  const uri = pg.getConnectionUri()

  // Set DATABASE_URI before any payload import so the pg adapter picks it up.
  process.env.DATABASE_URI = uri
  if (!process.env.PAYLOAD_SECRET) {
    process.env.PAYLOAD_SECRET = 'test-secret-for-vitest-not-for-production'
  }

  // Trigger Payload init so push:true materialises the schema before tests run.
  // Lazy import — must happen after DATABASE_URI is set.
  const { getPayload } = await import('payload')
  const { default: config } = await import('../../src/payload.config')
  const payload = await getPayload({ config })
  await payload.db.destroy?.()

  // Provide the URI to test files via vitest's inject() API.
  provide('pgUri', uri)
  // Redact credentials from the log line — these are ephemeral test creds,
  // but the pattern protects against the same log being copied into a
  // setup that uses a real DSN. Mirror the helper in event-processor/main.py.
  const redacted = uri.replace(/:\/\/[^@]*@/, '://***@')
  console.log(`[globalSetup] Postgres ready at ${redacted}`)
}

export async function teardown() {
  if (pg) {
    console.log('[globalSetup] Stopping Postgres container…')
    await pg.stop()
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    pgUri: string
  }
}
