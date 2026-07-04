/**
 * Unit tests for B4: GET /api/marketing/dashboard-feed.
 *
 * Service-API-key auth (fail-closed) + raw-SQL aggregation over the `contacts`
 * projection. `payload`/pool are mocked; the three GROUP BY queries are stubbed
 * in order (stage, source, referral).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

const mockQuery = vi.hoisted(() => vi.fn())
vi.mock('payload', () => ({
  getPayload: vi.fn(async () => ({ db: { pool: { query: mockQuery } } })),
}))
vi.mock('@payload-config', () => ({ default: {} }))

import { GET } from '@/app/api/marketing/dashboard-feed/route'

const KEY = 'svc-dashboard-key'

function req(apiKey?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (apiKey !== undefined) headers['x-api-key'] = apiKey
  return new Request('http://x/api/marketing/dashboard-feed', { headers }) as unknown as NextRequest
}

beforeEach(() => {
  process.env.MARKETING_DASHBOARD_API_KEY = KEY
  mockQuery.mockReset()
})

describe('GET /api/marketing/dashboard-feed — auth', () => {
  test('401 when the x-api-key header is missing', async () => {
    const res = (await GET(req())) as { status: number }
    expect(res.status).toBe(401)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  test('401 when the x-api-key is wrong', async () => {
    const res = (await GET(req('nope'))) as { status: number }
    expect(res.status).toBe(401)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  test('fail-closed: 401 even with a header when the env key is unset', async () => {
    delete process.env.MARKETING_DASHBOARD_API_KEY
    const res = (await GET(req(KEY))) as { status: number }
    expect(res.status).toBe(401)
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

describe('GET /api/marketing/dashboard-feed — aggregation', () => {
  test('200 with stage/source/referral/funnel aggregates', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { k: 'waitlist', c: '10' },
          { k: 'customer', c: '3' },
          { k: null, c: '1' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { k: 'meta', c: '8' },
          { k: 'referral', c: '5' },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ k: '14', c: '5' }] })

    const res = (await GET(req(KEY))) as {
      body: {
        totalContacts: number
        byStage: Record<string, number>
        bySource: Record<string, number>
        referral: { total: number; referred: number; rate: number }
        funnel: Array<{ stage: string; count: number }>
      }
      status: number
    }

    expect(res.status).toBe(200)
    expect(res.body.totalContacts).toBe(14)
    expect(res.body.byStage).toEqual({ waitlist: 10, customer: 3, unknown: 1 })
    expect(res.body.bySource).toEqual({ meta: 8, referral: 5 })
    expect(res.body.referral).toEqual({ total: 14, referred: 5, rate: 5 / 14 })
    // funnel is in canonical order and fills zeros for absent stages
    expect(res.body.funnel).toEqual([
      { stage: 'lead', count: 0 },
      { stage: 'waitlist', count: 10 },
      { stage: 'invited', count: 0 },
      { stage: 'applicant', count: 0 },
      { stage: 'customer', count: 3 },
      { stage: 'former_customer', count: 0 },
    ])
  })

  test('rate is 0 when there are no contacts (no divide-by-zero)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ k: '0', c: '0' }] })

    const res = (await GET(req(KEY))) as {
      body: { referral: { rate: number } }
      status: number
    }
    expect(res.status).toBe(200)
    expect(res.body.referral.rate).toBe(0)
  })
})
