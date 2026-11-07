/**
 * BTB-546: the in-app hourly scheduler for Google Ads conversions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resetSchedulerForTests,
  runOnce,
  shouldSchedule,
  startGoogleAdsScheduler,
  type SchedulerDeps,
} from '@/server/google-ads/scheduler'

const PROD_ENV = {
  NODE_ENV: 'production',
  GOOGLE_ADS_CONVERSIONS_MODE: 'validate_only',
  REPORTING_JOB_TOKEN: 'job-token',
  CF_SECRET: 'cf-secret',
  PORT: '3000',
} as unknown as NodeJS.ProcessEnv

function deps(env: NodeJS.ProcessEnv, response = new Response('{"mode":"live"}')) {
  const timers: Array<{ fn: () => void; ms: number }> = []
  const log: string[] = []
  const d: SchedulerDeps = {
    env,
    fetch: vi.fn(async () => response) as unknown as typeof fetch,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms })
      return {}
    },
    random: () => 0,
    log: (m) => log.push(m),
  }
  return { d, timers, log }
}

afterEach(resetSchedulerForTests)

describe('shouldSchedule', () => {
  it('runs only in production with sending on', () => {
    expect(shouldSchedule(PROD_ENV)).toBe(true)
    expect(shouldSchedule({ ...PROD_ENV, GOOGLE_ADS_CONVERSIONS_MODE: 'live' })).toBe(true)
    expect(shouldSchedule({ ...PROD_ENV, GOOGLE_ADS_CONVERSIONS_MODE: 'off' })).toBe(false)
    expect(shouldSchedule({ ...PROD_ENV, GOOGLE_ADS_CONVERSIONS_MODE: undefined })).toBe(false)
    expect(shouldSchedule({ ...PROD_ENV, NODE_ENV: 'development' })).toBe(false)
  })
})

describe('startGoogleAdsScheduler', () => {
  it('starts once per process, first run five minutes after boot, then hourly', async () => {
    const { d, timers } = deps(PROD_ENV)
    expect(startGoogleAdsScheduler(d)).toBe(true)
    expect(startGoogleAdsScheduler(d)).toBe(false)
    expect(timers).toHaveLength(1)
    expect(timers[0].ms).toBe(5 * 60_000)

    timers[0].fn()
    await vi.waitFor(() => expect(timers).toHaveLength(2))
    expect(timers[1].ms).toBe(3_600_000)
    expect(d.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not start when sending is off or there is no job token', () => {
    expect(
      startGoogleAdsScheduler(deps({ ...PROD_ENV, GOOGLE_ADS_CONVERSIONS_MODE: 'off' }).d),
    ).toBe(false)
    const { d, log } = deps({ ...PROD_ENV, REPORTING_JOB_TOKEN: '' })
    expect(startGoogleAdsScheduler(d)).toBe(false)
    expect(log[0]).toMatch(/REPORTING_JOB_TOKEN/)
  })
})

describe('runOnce', () => {
  it('calls the job route on this machine with the job token and origin secret', async () => {
    const { d, log } = deps(PROD_ENV)
    await runOnce(d)
    const [url, init] = (d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(url).toBe('http://127.0.0.1:3000/api/reports/jobs/google-ads-conversions')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      authorization: 'Bearer job-token',
      'x-origin-secret': 'cf-secret',
    })
    expect(log[0]).toMatch(/HTTP 200/)
  })

  it('logs and carries on when the call fails', async () => {
    const { d, log } = deps(PROD_ENV)
    d.fetch = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    }) as unknown as typeof fetch
    await expect(runOnce(d)).resolves.toBeUndefined()
    expect(log[0]).toMatch(/did not complete: connect ECONNREFUSED/)
  })
})
