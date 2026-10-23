/**
 * Unit tests for the subscription API routes and the deliveries job route:
 * authentication, request checks, error mapping, and the job's token,
 * Sydney hour gate and summary (outcomes only, never report data). The
 * logic is mocked here and covered in tests/int/report-subscriptions.int.spec.ts.
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
const requireAuth = vi.fn()
vi.mock('@/lib/auth', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }))
vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({})) }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/server/email/staff-email', () => ({ staffEmailConfigured: () => true }))

const createSubscription = vi.fn()
const listSubscriptions = vi.fn()
const setPaused = vi.fn()
const deleteSubscription = vi.fn()
vi.mock('@/server/reporting/subscriptions', async () => {
  const actual = await vi.importActual<typeof import('@/server/reporting/subscriptions')>(
    '@/server/reporting/subscriptions',
  )
  return {
    SubscriptionError: actual.SubscriptionError,
    createSubscription: (...a: unknown[]) => createSubscription(...a),
    listSubscriptions: (...a: unknown[]) => listSubscriptions(...a),
    setPaused: (...a: unknown[]) => setPaused(...a),
    deleteSubscription: (...a: unknown[]) => deleteSubscription(...a),
  }
})
const deliverSubscriptions = vi.fn()
vi.mock('@/server/reporting/deliveries', () => ({
  deliverSubscriptions: (...a: unknown[]) => deliverSubscriptions(...a),
}))
const sydneyClock = vi.fn()
vi.mock('@/server/reporting/scheduled', () => ({ sydneyClock: () => sydneyClock() }))

import { GET, POST } from '@/app/api/reports/subscriptions/route'
import { PATCH, DELETE } from '@/app/api/reports/subscriptions/[id]/route'
import { POST as JOB } from '@/app/api/reports/jobs/deliveries/route'
import { SubscriptionError } from '@/server/reporting/subscriptions'

type Res = { status: number; body: Record<string, unknown> }
const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
const params = { params: Promise.resolve({ id: 's1' }) }
function jobRequest(query = '', token = 'job-token') {
  return {
    headers: new Headers({ authorization: `Bearer ${token}` }),
    nextUrl: new URL(`http://x/api/reports/jobs/deliveries${query}`),
  } as unknown as NextRequest
}

beforeEach(() => {
  requireAuth.mockResolvedValue({ user: { id: 'u', role: 'operations' }, payload: {} })
  createSubscription.mockReset().mockResolvedValue({ id: 's1' })
  listSubscriptions.mockReset().mockResolvedValue([])
  setPaused.mockReset().mockResolvedValue(undefined)
  deleteSubscription.mockReset().mockResolvedValue(undefined)
  deliverSubscriptions.mockReset()
  sydneyClock.mockReset().mockReturnValue({ hour: 8, weekday: 1 })
  process.env.REPORTING_JOB_TOKEN = 'job-token'
  process.env.NEXT_PUBLIC_APP_URL = 'https://crm.example'
})

afterEach(() => {
  delete process.env.REPORTING_JOB_TOKEN
})

describe('/api/reports/subscriptions', () => {
  test('lists your own, and says whether Slack is open to you', async () => {
    const res = (await GET()) as unknown as Res
    expect(res.body).toEqual({ subscriptions: [], slack: false })
    requireAuth.mockResolvedValue({ error: { status: 401 } })
    expect(((await GET()) as unknown as Res).status).toBe(401)
  })

  test('creates from a valid request, and maps refusals', async () => {
    const digest = { kind: 'digest', slug: 'daily', frequency: 'weekly' }
    expect(((await POST(req(digest))) as unknown as Res).status).toBe(201)
    expect(createSubscription.mock.calls[0][2]).toMatchObject({ parameters: {}, channel: 'email' })
    expect(((await POST(req({ kind: 'digest', slug: 'daily' }))) as unknown as Res).status).toBe(
      400,
    )
    createSubscription.mockRejectedValueOnce(
      new SubscriptionError(400, 'INVALID_PARAMETERS', 'Fill it in', { source: 'Required' }),
    )
    const refused = (await POST(req(digest))) as unknown as Res
    expect(refused.status).toBe(400)
    expect(refused.body.error).toEqual({
      code: 'INVALID_PARAMETERS',
      message: 'Fill it in',
      fields: { source: 'Required' },
    })
  })

  test('pauses and removes by id, for the signed-in user only', async () => {
    expect(((await PATCH(req({ paused: 'yes' }), params)) as unknown as Res).status).toBe(400)
    await PATCH(req({ paused: true }), params)
    expect(setPaused).toHaveBeenCalledWith({}, { id: 'u', role: 'operations' }, 's1', true)
    deleteSubscription.mockRejectedValueOnce(new SubscriptionError(404, 'NOT_FOUND', 'No'))
    expect(((await DELETE(req(null), params)) as unknown as Res).status).toBe(404)
  })
})

describe('POST /api/reports/jobs/deliveries', () => {
  test('needs the job token', async () => {
    expect(((await JOB(jobRequest('', 'wrong'))) as unknown as Res).status).toBe(401)
    expect(deliverSubscriptions).not.toHaveBeenCalled()
  })

  test('does nothing before the hour in Sydney', async () => {
    sydneyClock.mockReturnValue({ hour: 6, weekday: 2 })
    const res = (await JOB(jobRequest('?notBeforeSydneyHour=7'))) as unknown as Res
    expect(res.body).toEqual({ skipped: 'Before the delivery hour in Sydney' })
    expect(((await JOB(jobRequest('?notBeforeSydneyHour=24'))) as unknown as Res).status).toBe(400)
  })

  test('answers with counts and failures only, red when one failed', async () => {
    deliverSubscriptions.mockResolvedValue({
      day: '2026-10-26',
      due: 3,
      results: [
        { id: 'a', status: 'sent' },
        { id: 'b', status: 'checked' },
        { id: 'c', status: 'failed', detail: 'EMAIL_FAILED' },
      ],
    })
    const res = (await JOB(jobRequest('?notBeforeSydneyHour=7'))) as unknown as Res
    expect(res.status).toBe(502)
    expect(res.body).toEqual({
      day: '2026-10-26',
      due: 3,
      counts: { sent: 1, checked: 1, failed: 1 },
      failed: [{ id: 'c', status: 'failed', detail: 'EMAIL_FAILED' }],
    })
    expect(deliverSubscriptions.mock.calls[0][1]).toEqual({ appUrl: 'https://crm.example' })
  })
})
