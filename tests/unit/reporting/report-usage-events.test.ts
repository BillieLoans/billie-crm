/**
 * Unit tests for where the usage page's events come from: the browser may
 * record searches, opens, downloads and copies, but not Ask Claude saves,
 * which the save route records itself once a save succeeds.
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
const create = vi.fn()
const requireAuth = vi.fn()
vi.mock('@/lib/auth', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }))
const saveDraft = vi.fn()
vi.mock('@/server/reporting/ask/draft', async () => ({
  ...(await vi.importActual<typeof import('@/server/reporting/ask/draft')>(
    '@/server/reporting/ask/draft',
  )),
  saveDraft: (...a: unknown[]) => saveDraft(...a),
}))

import { POST as EVENT } from '@/app/api/reports/events/route'
import { POST as SAVE } from '@/app/api/reports/ask/save/route'

type Res = { status: number; body: Record<string, unknown> }
const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
const DEF = { title: 't', description: '', sql: 'SELECT 1', parameters: [], chart: null }

beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: 'e1' })
  requireAuth.mockResolvedValue({ user: { id: 'u', role: 'supervisor' }, payload: { create } })
  saveDraft.mockReset()
})

describe('usage events', () => {
  test('the browser can record a download but not an Ask save', async () => {
    expect(
      ((await EVENT(req({ kind: 'csv', reportSlug: 'daily' }))) as unknown as Res).status,
    ).toBe(200)
    expect(create).toHaveBeenCalledTimes(1)
    expect(
      ((await EVENT(req({ kind: 'ask_save', reportSlug: 'daily' }))) as unknown as Res).status,
    ).toBe(400)
    expect(create).toHaveBeenCalledTimes(1)
  })

  test('a successful save records itself; a refused one does not', async () => {
    saveDraft.mockResolvedValueOnce({ ok: false, issues: [] })
    expect(((await SAVE(req({ definition: DEF }))) as unknown as Res).status).toBe(400)
    expect(create).not.toHaveBeenCalled()
    saveDraft.mockResolvedValueOnce({ ok: true, id: 'r1', slug: 'daily', published: false })
    expect(((await SAVE(req({ definition: DEF }))) as unknown as Res).status).toBe(200)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'report-events',
        data: { kind: 'ask_save', reportSlug: 'daily', user: 'u' },
      }),
    )
  })
})
