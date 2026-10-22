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
vi.mock('@/server/reporting/scheduled', async () => {
  const actual = await vi.importActual<typeof import('@/server/reporting/scheduled')>(
    '@/server/reporting/scheduled',
  )
  return { ...actual, deliverScheduledReports: (...args: unknown[]) => deliver(...args) }
})

import { POST } from '@/app/api/reports/jobs/scheduled/route'
import { sydneyHour } from '@/server/reporting/scheduled'

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
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('sydneyHour', () => {
  test('follows Sydney daylight saving', () => {
    expect(sydneyHour(new Date('2026-10-25T21:00:00Z'))).toBe(8) // AEDT, UTC+11
    expect(sydneyHour(new Date('2026-06-21T22:00:00Z'))).toBe(8) // AEST, UTC+10
    expect(sydneyHour(new Date('2026-06-21T21:00:00Z'))).toBe(7)
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

  test('skips outside the requested Sydney hour, and delivers inside it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-25T22:00:00Z')) // 09:00 AEDT
    let res = (await POST(req('?schedule=weekly_monday&sydneyHour=8'))) as unknown as Res
    expect(res.status).toBe(200)
    expect(res.body.skipped).toMatch(/9:00/)
    expect(deliver).not.toHaveBeenCalled()

    vi.setSystemTime(new Date('2026-10-25T21:00:00Z')) // 08:00 AEDT
    res = (await POST(req('?schedule=weekly_monday&sydneyHour=8'))) as unknown as Res
    expect(res.status).toBe(200)
    expect(deliver).toHaveBeenCalledWith(expect.anything(), {
      schedule: 'weekly_monday',
      appUrl: 'https://crm.example.test',
    })
  })

  test('502 when any report failed, so the workflow run goes red', async () => {
    deliver.mockResolvedValue({
      scheduledFor: '2026-10-26',
      reports: [{ slug: 'decline-rate', status: 'failed', recipients: 0 }],
    })
    const res = (await POST(req('?schedule=weekly_monday'))) as unknown as Res
    expect(res.status).toBe(502)
  })

  test('refuses in production without an email key', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RESEND_API_KEY', '')
    const res = (await POST(req('?schedule=weekly_monday'))) as unknown as Res
    expect(res.status).toBe(503)
    expect(deliver).not.toHaveBeenCalled()
  })
})
