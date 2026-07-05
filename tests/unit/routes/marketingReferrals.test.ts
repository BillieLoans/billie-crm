/**
 * Unit tests for B6 backend gap: GET /api/marketing/contacts/[contactId]/referrals.
 * requireAuth + payload.find mocked; asserts both directions of the referral graph.
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

const mockFind = vi.hoisted(() => vi.fn())
const authHolder = vi.hoisted(() => ({
  current: { user: { id: 'staff-1' }, payload: { find: undefined as unknown } } as Record<
    string,
    unknown
  >,
}))
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => authHolder.current),
}))

import { GET } from '@/app/api/marketing/contacts/[contactId]/referrals/route'

const p = (contactId: string) => ({ params: Promise.resolve({ contactId }) })
const req = () => new Request('http://x') as unknown as NextRequest

beforeEach(() => {
  mockFind.mockReset()
  authHolder.current = { user: { id: 'staff-1' }, payload: { find: mockFind } }
})

describe('GET /api/marketing/contacts/[contactId]/referrals', () => {
  test('resolves referrer + referred list + count', async () => {
    mockFind
      // self lookup — has a referrer
      .mockResolvedValueOnce({ docs: [{ contactId: 'c-1', referredByContactId: 'c-ref' }] })
      // referrer lookup
      .mockResolvedValueOnce({ docs: [{ contactId: 'c-ref', firstName: 'Sam' }] })
      // referred-by-me list
      .mockResolvedValueOnce({
        docs: [
          { contactId: 'c-2', firstName: 'Jo', derivedStage: 'waitlist' },
          { contactId: 'c-3', firstName: null, derivedStage: null },
        ],
        totalDocs: 2,
      })

    const res = (await GET(req(), p('c-1'))) as {
      body: {
        referrer: { contactId: string; firstName: string | null } | null
        referred: unknown[]
        referredCount: number
      }
      status: number
    }
    expect(res.status).toBe(200)
    expect(res.body.referrer).toEqual({ contactId: 'c-ref', firstName: 'Sam' })
    expect(res.body.referredCount).toBe(2)
    expect(res.body.referred).toEqual([
      { contactId: 'c-2', firstName: 'Jo', derivedStage: 'waitlist' },
      { contactId: 'c-3', firstName: null, derivedStage: null },
    ])
  })

  test('referrer is null when the contact has no referredByContactId', async () => {
    mockFind
      .mockResolvedValueOnce({ docs: [{ contactId: 'c-1' }] }) // self, no referrer
      .mockResolvedValueOnce({ docs: [], totalDocs: 0 }) // referred-by-me (empty)

    const res = (await GET(req(), p('c-1'))) as {
      body: { referrer: unknown; referredCount: number }
      status: number
    }
    expect(res.status).toBe(200)
    expect(res.body.referrer).toBeNull()
    expect(res.body.referredCount).toBe(0)
    // only two finds — the referrer lookup is skipped
    expect(mockFind).toHaveBeenCalledTimes(2)
  })

  test('passes the auth error through when requireAuth denies', async () => {
    authHolder.current = { error: { body: { error: { code: 'FORBIDDEN' } }, status: 403 } }
    const res = (await GET(req(), p('c-1'))) as { status: number }
    expect(res.status).toBe(403)
    expect(mockFind).not.toHaveBeenCalled()
  })
})
