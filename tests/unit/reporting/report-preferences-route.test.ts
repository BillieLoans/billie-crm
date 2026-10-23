/**
 * Unit tests for PUT /api/reports/preferences: only reports the person can
 * open are kept, and more than the limit is refused with a message.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const requireAuth = vi.fn()
const listReports = vi.fn()
const writePins = vi.fn()
vi.mock('@/lib/auth', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }))
vi.mock('@/server/reporting/run-report', () => ({
  listReports: (...a: unknown[]) => listReports(...a),
}))
vi.mock('@/server/reporting/preferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/reporting/preferences')>()),
  writePins: (...a: unknown[]) => writePins(...a),
}))

import { PUT } from '@/app/api/reports/preferences/route'

const put = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  requireAuth.mockResolvedValue({ user: { id: 'u1', role: 'operations' }, payload: {} })
  writePins.mockReset().mockResolvedValue(undefined)
  listReports.mockResolvedValue(
    Array.from({ length: 25 }, (_, i) => ({ slug: `r-${i}`, published: true })).concat([
      { slug: 'draft-only', published: false },
    ]),
  )
})

describe('PUT /api/reports/preferences', () => {
  it('drops pins to reports the person cannot open', async () => {
    const res = await PUT(put({ pinned: ['r-1', 'gone', 'draft-only', 'r-2'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pinned: ['r-1', 'r-2'] })
    expect(writePins).toHaveBeenCalledWith({}, 'u1', ['r-1', 'r-2'])
  })

  it('refuses more than twenty pins, saying why', async () => {
    const res = await PUT(put({ pinned: Array.from({ length: 21 }, (_, i) => `r-${i}`) }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toBe('You can pin up to 20 reports. Unpin one first.')
    expect(writePins).not.toHaveBeenCalled()
  })

  it('refuses a body that is not a list of report links', async () => {
    expect((await PUT(put({ pinned: 'r-1' }))).status).toBe(400)
  })
})
