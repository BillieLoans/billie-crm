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
import { registerLexicalEsmConditions } from './registerLexicalEsmConditions'

let pg: StartedPostgreSqlContainer | undefined

/**
 * Races `promise` against an explicit, ref'd `setTimeout` that rejects with
 * a clear error if it fires first. Deliberately never calls `.unref()` on
 * the timer.
 *
 * Why this exists: `import('../../src/payload.config')` used to stall
 * ~25-40% of the time — the promise neither resolved nor rejected, and with
 * nothing else ref'd on the event loop the process could exit 0 having run
 * zero tests. ROOT CAUSE (found 2026-08-28, after earlier investigations
 * blamed Vite's module runner): the lexical packages' Node ESM entrypoints
 * (`*.node.mjs`) each top-level-await a dynamic import, and natively
 * evaluating payload.config's graph (via @payloadcms/richtext-lexical) runs
 * ~75 of those async modules whose dynamic imports re-enter the
 * still-evaluating graph — deadlocking Node's async module evaluation
 * (nodejs/node#55468 class; reproduced in pure Node 20.18.3 and 22.5.1 with a
 * bare import of @payloadcms/richtext-lexical, ~25-40% of runs; earlier
 * "first run after edits" and "clear node_modules/.vite" observations were
 * sampling noise). vitest/vite-node were bystanders.
 *
 * The fix is the resolution hook registered above (see
 * lexicalEsmConditionsHook.mjs): it resolves lexical packages straight to
 * their dev/prod builds, skipping the top-level-await shims. These
 * withTimeout guards remain as the fail-loud safety net: merely having a
 * ref'd timer pending prevents the silent exit-0 failure mode, and if any
 * import stalls again the error names the step instead of vitest's generic
 * hook-timeout message.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `[globalSetup] ${label} did not settle within ${ms}ms. This matches a known ` +
            `intermittent Vite module-runner stall rather than a real code defect — see the ` +
            `withTimeout doc comment in tests/utils/globalSetup.ts. Rerunning usually ` +
            `executes; the first run after source-file edits is the most likely to stall.`,
        ),
      )
    }, ms)
    // Deliberately NOT unref()'d — see function doc above.
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export async function setup({ provide }: GlobalSetupContext) {
  // Must precede the payload.config import below — see the hook file for the
  // root cause of the historical stall this prevents.
  registerLexicalEsmConditions()

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
  // Lazy import — must happen after DATABASE_URI is set. Each step is
  // wrapped in withTimeout() — see its doc comment for why.
  const { getPayload } = await withTimeout(import('payload'), 30_000, "import('payload')")
  const { default: config } = await withTimeout(
    import('../../src/payload.config'),
    45_000,
    "import('../../src/payload.config')",
  )
  const payload = await withTimeout(getPayload({ config }), 30_000, 'getPayload({ config })')
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
