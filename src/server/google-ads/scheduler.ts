/**
 * In-app hourly scheduler for Google Ads offline conversions (BTB-546).
 *
 * Started once per server process from src/instrumentation.ts. Each tick
 * POSTs the job route on this same machine
 * (/api/reports/jobs/google-ads-conversions), which does the work with
 * Payload's database pool. Going through the route keeps Payload out of the
 * instrumentation bundle and gives manual runs and scheduled runs one path.
 *
 * Both prod machines run it. That is safe: the run claims rows with
 * FOR UPDATE SKIP LOCKED and fills the outbox with ON CONFLICT DO NOTHING, so
 * overlapping runs never send a conversion twice. Ticks are spread with
 * jitter so the machines rarely overlap at all.
 *
 * Production only. With GOOGLE_ADS_CONVERSIONS_MODE off the scheduler does
 * not start, so changing the mode (a Fly secret, which restarts the machines)
 * turns it on or off.
 */

const HOUR_MS = 3_600_000
/** The first run waits for the server to settle after boot. */
const FIRST_RUN_DELAY_MS = 5 * 60_000
const JITTER_MS = 5 * 60_000

export interface SchedulerDeps {
  env: NodeJS.ProcessEnv
  fetch: typeof fetch
  setTimeout: (fn: () => void, ms: number) => { unref?: () => void }
  random: () => number
  log: (message: string) => void
}

const defaultDeps = (): SchedulerDeps => ({
  env: process.env,
  fetch,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  random: Math.random,
  log: (message) => console.log(message),
})

/** Whether this process should run the scheduler. */
export function shouldSchedule(env: NodeJS.ProcessEnv): boolean {
  const mode = env.GOOGLE_ADS_CONVERSIONS_MODE?.trim().toLowerCase()
  return env.NODE_ENV === 'production' && (mode === 'validate_only' || mode === 'live')
}

/**
 * One run: call the job route locally. Logs the status and the summary's
 * counts and error codes (the route returns nothing else). Never throws.
 */
export async function runOnce(deps: SchedulerDeps): Promise<void> {
  const { env } = deps
  const port = env.PORT || '3000'
  const headers: Record<string, string> = {
    authorization: `Bearer ${env.REPORTING_JOB_TOKEN ?? ''}`,
  }
  // The proxy only lets requests through that carry Cloudflare's origin secret.
  if (env.CF_SECRET) headers['x-origin-secret'] = env.CF_SECRET
  try {
    const res = await deps.fetch(
      `http://127.0.0.1:${port}/api/reports/jobs/google-ads-conversions`,
      {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(15 * 60_000),
      },
    )
    const body = await res.text()
    deps.log(`[google-ads] scheduled run: HTTP ${res.status} ${body.slice(0, 1000)}`)
  } catch (error) {
    deps.log(`[google-ads] scheduled run did not complete: ${(error as Error).message}`)
  }
}

let started = false

/** Start the hourly loop, once per process. Returns whether it started. */
export function startGoogleAdsScheduler(deps: SchedulerDeps = defaultDeps()): boolean {
  if (started || !shouldSchedule(deps.env)) return false
  if (!deps.env.REPORTING_JOB_TOKEN) {
    deps.log('[google-ads] scheduler not started: REPORTING_JOB_TOKEN is not set')
    return false
  }
  started = true
  const jitter = () => Math.floor(deps.random() * JITTER_MS)
  const schedule = (ms: number) => {
    deps
      .setTimeout(() => {
        void runOnce(deps).finally(() => schedule(HOUR_MS + jitter()))
      }, ms)
      .unref?.()
  }
  schedule(FIRST_RUN_DELAY_MS + jitter())
  deps.log('[google-ads] scheduler started: hourly')
  return true
}

/** For tests. */
export function resetSchedulerForTests(): void {
  started = false
}
