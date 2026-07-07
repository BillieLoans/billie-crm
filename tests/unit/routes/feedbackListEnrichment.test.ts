/**
 * GET /api/marketing/feedback — contactName enrichment.
 *
 * The feedback projection stores only contactIdString; the route enriches each
 * page with the contact's firstName via ONE batched contacts lookup. These
 * tests pin the batching (single `in` query, deduped ids) and the null
 * fallback for unknown/nameless contacts.
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

const findMock = vi.hoisted(() => vi.fn())
const authHolder = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => authHolder.current),
}))

import { GET } from '@/app/api/marketing/feedback/route'

function req(qs = ''): NextRequest {
  return { nextUrl: new URL(`http://x/api/marketing/feedback${qs}`) } as unknown as NextRequest
}

const feedbackPage = (docs: unknown[]) => ({
  docs,
  totalDocs: docs.length,
  totalPages: 1,
  page: 1,
  hasNextPage: false,
  hasPrevPage: false,
  limit: 50,
})

beforeEach(() => {
  findMock.mockReset()
  authHolder.current = { payload: { find: findMock }, user: { id: 'staff-1' } }
})

describe('GET /api/marketing/feedback contactName enrichment', () => {
  test('attaches firstName per row via one batched contacts lookup (deduped ids)', async () => {
    findMock
      .mockResolvedValueOnce(
        feedbackPage([
          { feedbackId: 'f-1', contactIdString: 'c-1' },
          { feedbackId: 'f-2', contactIdString: 'c-2' },
          { feedbackId: 'f-3', contactIdString: 'c-1' }, // duplicate contact
        ]),
      )
      .mockResolvedValueOnce({
        docs: [
          { contactId: 'c-1', firstName: 'Rohan' },
          { contactId: 'c-2', firstName: null },
        ],
      })

    const res = (await GET(req())) as unknown as {
      body: { docs: Array<{ feedbackId: string; contactName: string | null }> }
    }

    expect(res.body.docs.map((d) => [d.feedbackId, d.contactName])).toEqual([
      ['f-1', 'Rohan'],
      ['f-2', null],
      ['f-3', 'Rohan'],
    ])

    // Exactly two finds: feedback page + ONE batched contacts query with deduped ids.
    expect(findMock).toHaveBeenCalledTimes(2)
    const contactsCall = findMock.mock.calls[1]![0]
    expect(contactsCall.collection).toBe('contacts')
    expect(contactsCall.where).toEqual({ contactId: { in: ['c-1', 'c-2'] } })
    expect(contactsCall.limit).toBe(2)
  })

  test('unknown contact id → contactName null; no contacts query when the page is empty', async () => {
    findMock.mockResolvedValueOnce(
      feedbackPage([{ feedbackId: 'f-1', contactIdString: 'c-ghost' }]),
    )
    findMock.mockResolvedValueOnce({ docs: [] })

    const res = (await GET(req())) as unknown as {
      body: { docs: Array<{ contactName: string | null }> }
    }
    expect(res.body.docs[0]!.contactName).toBeNull()

    findMock.mockReset()
    findMock.mockResolvedValueOnce(feedbackPage([]))
    await GET(req())
    expect(findMock).toHaveBeenCalledTimes(1) // no second (contacts) query
  })

  test('returns the auth error when requireAuth denies', async () => {
    authHolder.current = { error: { body: { error: 'nope' }, status: 401 } }
    const res = (await GET(req())) as unknown as { status: number }
    expect(res.status).toBe(401)
  })
})
