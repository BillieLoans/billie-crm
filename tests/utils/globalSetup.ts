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

/**
 * Races `promise` against an explicit, ref'd `setTimeout` that rejects with
 * a clear error if it fires first. Deliberately never calls `.unref()` on
 * the timer.
 *
 * Why this exists: investigation of a ~40%-reproducible bug where
 * `pnpm test:int` silently exited 0 having run zero tests (see
 * `.superpowers/sdd/2026-07-31-aria-live-announcements/ci-harness-report.md`)
 * traced it to the dynamic `import()` calls below. Vite's SSR module runner
 * (which vitest uses to load this file's dynamic imports of first-party
 * source — unlike `payload`, `src/payload.config.ts`'s ~15 transitive
 * collection imports all go through Vite's transform pipeline rather than
 * being externalised) intermittently never settles the returned promise —
 * it neither resolves nor rejects, confirmed to still be pending after 500+
 * seconds of wall-clock time when kept alive artificially. Nothing in the
 * vitest/vite stack holds a ref'd timer during this window, so when it
 * happens, Node's ordinary "no more work scheduled" idle-exit detection
 * wins the race and the whole `vitest run` process exits cleanly with code
 * 0 before any test file ever loads or any error is printed.
 *
 * A plain ref'd `setTimeout` fixes the *silent* half of that failure mode
 * unconditionally: merely having it pending keeps the event loop from ever
 * looking idle during the vulnerable window, and if the import genuinely
 * never settles it throws a loud, attributable error comfortably inside
 * vitest's `hookTimeout` (120_000ms) — naming exactly which step stalled,
 * rather than surfacing as vitest's generic hook-timeout message.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `[globalSetup] ${label} did not settle within ${ms}ms. This matches a known ` +
            `intermittent Vite module-runner stall rather than a real code defect — see ` +
            `ci-harness-report.md. Rerunning the job usually clears it.`,
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
