/**
 * Unit tests for the scheduled-report job route (BTB-507): token, schedule
 * name, the Sydney-hour gate and configuration checks. Delivery itself is
 * covered against Postgres in tests/int/first-reports.int.spec.ts.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))
vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({})) }))
vi.mock('@payload-config', () => ({ default: {} }))

const deliver = vi.fn()
const emailConfigured = vi.fn(() => true)
vi.mock('@/server/email/staff-email', () => ({ staffEmailConfigured: () => emailConfigured() }))
vi.mock('@/server/reporting/scheduled', async () => {
  const actual = await vi.importActual<typeof import('@/server/reporting/scheduled')>(
    '@/server/reporting/scheduled',
  )
  return { ...actual, deliverScheduledReports: (...args: unknown[]) => deliver(...args) }
})

import { POST } from '@/app/api/reports/jobs/scheduled/route'
import { sydneyClock } from '@/server/reporting/scheduled'

const TOKEN = 'job-token-for-tests-0123456789'
type Res = { status: number; body: Record<string, unknown> }

function req(query: string, token: string | undefined = TOKEN): NextRequest {
  const url = `http://x/api/reports/jobs/scheduled${query}`
  const headers: Record<string, string> = {}
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  const request = new Request(url, { method: 'POST', headers }) as unknown as NextRequest
  ;(request as unknown as { nextUrl: URL }).nextUrl = new URL(url)
  return request
}

beforeEach(() => {
  process.env.REPORTING_JOB_TOKEN = TOKEN
  process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example.test'
  deliver.mockReset().mockResolvedValue({ scheduledFor: '2026-10-26', reports: [] })
  emailConfigured.mockReset().mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('sydneyClock', () => {
  test('follows Sydney daylight saving and weekdays', () => {
    expect(sydneyClock(new Date('2026-10-25T21:00:00Z'))).toEqual({ hour: 8, weekday: 1 }) // AEDT
    expect(sydneyClock(new Date('2026-06-21T22:00:00Z'))).toEqual({ hour: 8, weekday: 1 }) // AEST
    expect(sydneyClock(new Date('2026-06-21T21:00:00Z'))).toEqual({ hour: 7, weekday: 1 })
    expect(sydneyClock(new Date('2026-10-25T12:00:00Z'))).toEqual({ hour: 23, weekday: 7 })
  })
})

describe('POST /api/reports/jobs/scheduled', () => {
  test('401 without the job token', async () => {
    const res = (await POST(req('?schedule=weekly_monday', 'nope'))) as unknown as Res
    expect(res.status).toBe(401)
    expect(deliver).not.toHaveBeenCalled()
  })

  test('400 for an unknown schedule', async () => {
    const res = (await POST(req('?schedule=hourly'))) as unknown as Res
    expect(res.status).toBe(400)
  })

  test('sends only on Monday at or after the hour, so a late run still sends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const call = () =>
      POST(req('?schedule=weekly_monday&notBeforeSydneyHour=8')) as unknown as Promise<Res>

    vi.setSystemTime(new Date('2026-10-25T20:00:00Z')) // Monday 07:00 AEDT
    expect((await call()).body.skipped).toBeDefined()
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z')) // Sunday 21:00 AEDT
    expect((await call()).body.skipped).toBeDefined()
    expect(deliver).not.toHaveBeenCalled()

    vi.setSystemTime(new Date('2026-10-26T01:30:00Z')) // Monday 12:30 AEDT, a late run
    const res = await call()
    expect(res.status).toBe(200)
    expect(deliver).toHaveBeenCalledWith(expect.anything(), {
      schedule: 'weekly_monday',
      appUrl: 'https://crm.example.test',
    })
  })

  test('400 for a malformed hour', async () => {
    for (const bad of ['', 'abc', '24']) {
      const res = (await POST(
        req(`?schedule=weekly_monday&notBeforeSydneyHour=${bad}`),
      )) as unknown as Res
      expect(res.status).toBe(400)
    }
  })

  test('502 when a report failed or had nobody to send to, so the workflow run goes red', async () => {
    for (const status of ['failed', 'no_recipients']) {
      deliver.mockResolvedValue({
        scheduledFor: '2026-10-26',
        reports: [{ slug: 'decline-rate', status, recipients: 0 }],
      })
      const res = (await POST(req('?schedule=weekly_monday'))) as unknown as Res
      expect(res.status).toBe(502)
    }
  })

  test('503 when staff email is not configured', async () => {
    emailConfigured.mockReturnValue(false)
    const res = (await POST(req('?schedule=weekly_monday'))) as unknown as Res
    expect(res.status).toBe(503)
    expect(deliver).not.toHaveBeenCalled()
  })
})
