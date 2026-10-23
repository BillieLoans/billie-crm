/**
 * Unit tests for GET /api/reports/:slug/definition: authors only, the
 * latest version for the editor and Ask Claude, and the published version
 * the editor compares with before publishing.
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
const requireAuth = vi.fn()
vi.mock('@/lib/auth', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }))
const findReport = vi.fn()
vi.mock('@/server/reporting/run-report', () => ({
  findReport: (...a: unknown[]) => findReport(...a),
  isReportAuthor: (user: { role?: string }) => ['admin', 'supervisor'].includes(user.role ?? ''),
}))
import { GET } from '@/app/api/reports/[slug]/definition/route'

type Res = { status: number; body: Record<string, unknown> }
const get = (query = '') =>
  ({ nextUrl: new URL(`http://x/api/reports/weekly/definition${query}`) }) as unknown as NextRequest
const params = { params: Promise.resolve({ slug: 'weekly' }) }

function signedIn(role: string) {
  requireAuth.mockResolvedValue({ user: { id: 'u', role }, payload: {} })
}

beforeEach(() => {
  signedIn('supervisor')
  findReport.mockReset().mockResolvedValue({ id: 7, slug: 'weekly', title: 'Weekly', sql: 'S' })
})

describe('GET /api/reports/:slug/definition', () => {
  test('the latest version by default, the published one on request', async () => {
    await GET(get(), params)
    expect(findReport).toHaveBeenLastCalledWith(expect.anything(), 'weekly', true)
    const res = (await GET(get('?version=published'), params)) as unknown as Res
    expect(findReport).toHaveBeenLastCalledWith(expect.anything(), 'weekly', false)
    expect(res.body).toMatchObject({ id: '7', slug: 'weekly', sql: 'S', chart: null })
  })

  test('404 when there is no such version, 403 for staff who are not authors', async () => {
    findReport.mockResolvedValueOnce(null)
    expect(((await GET(get('?version=published'), params)) as unknown as Res).status).toBe(404)
    signedIn('readonly')
    expect(((await GET(get(), params)) as unknown as Res).status).toBe(403)
  })
})
