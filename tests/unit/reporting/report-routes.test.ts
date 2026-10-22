/**
 * Unit tests for the report API routes (BTB-506): authentication, the
 * lending-wall role gate and the wiring to the run logic, which is mocked
 * here and covered against Postgres in tests/int/report-runner.int.spec.ts.
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
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))

const auth = vi.fn()
vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({ auth })) }))
vi.mock('@payload-config', () => ({ default: {} }))

const listReports = vi.fn()
const runReport = vi.fn()
vi.mock('@/server/reporting/run-report', () => ({
  listReports: (...args: unknown[]) => listReports(...args),
  runReport: (...args: unknown[]) => runReport(...args),
  isReportAuthor: (user: { role?: string }) => ['admin', 'supervisor'].includes(user.role ?? ''),
}))

import { GET } from '@/app/api/reports/route'
import { POST } from '@/app/api/reports/[slug]/route'

type Res = { status: number; body: Record<string, unknown> }

function post(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}
const params = (slug: string) => ({ params: Promise.resolve({ slug }) })

beforeEach(() => {
  auth.mockReset()
  listReports.mockReset().mockResolvedValue([{ slug: 'weekly' }])
  runReport.mockReset().mockResolvedValue({ status: 200, body: { rows: [] } })
})

describe('GET /api/reports', () => {
  test('401 when not signed in', async () => {
    auth.mockResolvedValue({ user: null })
    expect(((await GET()) as unknown as Res).status).toBe(401)
  })

  test('403 for marketing and service accounts', async () => {
    for (const role of ['marketing', 'service']) {
      auth.mockResolvedValue({ user: { id: 'x', role } })
      expect(((await GET()) as unknown as Res).status).toBe(403)
    }
    expect(listReports).not.toHaveBeenCalled()
  })

  test('lists reports and says whether the user authors them', async () => {
    auth.mockResolvedValue({ user: { id: 'x', role: 'operations' } })
    const res = (await GET()) as unknown as Res
    expect(res).toEqual({ status: 200, body: { reports: [{ slug: 'weekly' }], canAuthor: false } })
  })
})

describe('POST /api/reports/:slug', () => {
  test('401 when not signed in', async () => {
    auth.mockResolvedValue({ user: null })
    const res = (await POST(post({}), params('weekly'))) as unknown as Res
    expect(res.status).toBe(401)
    expect(runReport).not.toHaveBeenCalled()
  })

  test('403 for marketing', async () => {
    auth.mockResolvedValue({ user: { id: 'x', role: 'marketing' } })
    const res = (await POST(post({}), params('weekly'))) as unknown as Res
    expect(res.status).toBe(403)
    expect(runReport).not.toHaveBeenCalled()
  })

  test('passes parameters and the draft flag through, and returns the outcome status', async () => {
    const user = { id: 'x', role: 'admin' }
    auth.mockResolvedValue({ user })
    runReport.mockResolvedValue({ status: 504, body: { error: { code: 'TIMEOUT' } } })
    const res = (await POST(
      post({ parameters: { from: '2026-10-01' }, draft: true }),
      params('weekly'),
    )) as unknown as Res
    expect(runReport).toHaveBeenCalledWith(expect.anything(), user, 'weekly', {
      parameters: { from: '2026-10-01' },
      draft: true,
    })
    expect(res.status).toBe(504)
  })

  test('ignores a malformed body rather than failing', async () => {
    auth.mockResolvedValue({ user: { id: 'x', role: 'operations' } })
    const bad = {
      json: async () => Promise.reject(new SyntaxError('bad')),
    } as unknown as NextRequest
    await POST(bad, params('weekly'))
    expect(runReport).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'weekly', {
      parameters: {},
      draft: false,
    })
    await POST(post({ parameters: ['not', 'an', 'object'], draft: 'yes' }), params('weekly'))
    expect(runReport).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'weekly', {
      parameters: {},
      draft: false,
    })
  })
})
