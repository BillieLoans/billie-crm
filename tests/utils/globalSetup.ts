/**
 * Vitest global setup — starts an in-memory MongoDB instance before all tests.
 *
 * This replaces the need for a running MongoDB service. Payload CMS and any
 * direct MongoClient usage will connect to this ephemeral instance via the
 * DATABASE_URI env var that is set before test workers fork.
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { GlobalSetupContext } from 'vitest/node'

let mongod: MongoMemoryServer | undefined

export async function setup({ provide }: GlobalSetupContext) {
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri()

  // Set DATABASE_URI so payload.config.ts picks up the in-memory instance.
  // This propagates to forked test processes since they inherit env.
  process.env.DATABASE_URI = uri

  // Payload secret is required — provide a test value
  if (!process.env.PAYLOAD_SECRET) {
    process.env.PAYLOAD_SECRET = 'test-secret-for-vitest-not-for-production'
  }

  // Also provide the URI to test files via vitest's inject() API
  provide('mongoUri', uri)

  console.log(`[globalSetup] MongoMemoryServer started at ${uri}`)
}

export async function teardown() {
  if (mongod) {
    await mongod.stop()
    console.log('[globalSetup] MongoMemoryServer stopped')
  }
}

// Type augmentation for vitest's inject() — allows tests to call inject('mongoUri')
declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string
  }
}
