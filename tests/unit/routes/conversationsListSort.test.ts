/**
 * Unit tests for GET /api/conversations — the `sort` query param.
 *
 * The Applications list view sorts server-side. The route must whitelist the
 * column, hand Payload an array sort with `id` as tiebreaker, and issue a
 * cursor carrying the sort column's value (not always updatedAt) so the next
 * page continues from the right place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}))

const DOCS = [
  {
    id: 'id-1',
    conversationId: 'conv-1',
    applicationNumber: 'APP-1',
    status: 'declined',
    decisionStatus: 'declined',
    startedAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
    utterances: [],
  },
  {
    id: 'id-2',
    conversationId: 'conv-2',
    applicationNumber: 'APP-2',
    status: 'hard_end',
    decisionStatus: null,
    startedAt: '2026-10-09T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    utterances: [],
  },
  {
    id: 'id-3',
    conversationId: 'conv-3',
    applicationNumber: 'APP-3',
    status: 'active',
    decisionStatus: null,
    startedAt: '2026-10-08T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
    utterances: [],
  },
]

const mockFind = vi.hoisted(() =>
  vi
    .fn()
    .mockImplementation(async ({ collection }: { collection: string }) =>
      collection === 'conversations' ? { docs: [], totalDocs: 0 } : { docs: [] },
    ),
)

vi.mock('payload', () => ({
  getPayload: vi.fn().mockImplementation(async () => ({
    find: mockFind,
    auth: vi.fn().mockImplementation(async () => ({ user: { id: 'u-1', role: 'admin' } })),
  })),
}))

vi.mock('@payload-config', () => ({ default: {} }))

import { GET } from '@/app/api/conversations/route'
import { decodeCursor } from '@/lib/conversation-sort'
import type { NextRequest } from 'next/server'

const call = async (query: string) => {
  const req = { nextUrl: new URL(`http://localhost/api/conversations?${query}`) }
  return (await GET(req as unknown as NextRequest)) as unknown as {
    status: number
    body: { cursor?: string | null; conversations?: unknown[]; error?: { code: string } }
  }
}

const conversationsFindArgs = () =>
  mockFind.mock.calls
    .map((c) => c[0] as { collection: string; sort?: unknown; where?: unknown })
    .find((a) => a.collection === 'conversations')

describe('GET /api/conversations — sort', () => {
  beforeEach(() => {
    mockFind.mockClear()
    mockFind.mockImplementation(async ({ collection }: { collection: string }) =>
      collection === 'conversations' ? { docs: [], totalDocs: 0 } : { docs: [] },
    )
  })

  it('rejects a sort outside the whitelist with 400', async () => {
    const res = await call('sort=loanAmount')
    expect(res.status).toBe(400)
    expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    expect(conversationsFindArgs()).toBeUndefined()
  })

  it('defaults to updatedAt desc with id tiebreaker, as an array', async () => {
    await call('')
    expect(conversationsFindArgs()?.sort).toEqual(['-updatedAt', '-id'])
  })

  it('passes a whitelisted sort through with id tiebreaker', async () => {
    await call('sort=startedAt')
    expect(conversationsFindArgs()?.sort).toEqual(['startedAt', 'id'])
  })

  it('issues a cursor carrying the sort column value of the last row served', async () => {
    mockFind.mockImplementation(async ({ collection }: { collection: string }) =>
      collection === 'conversations' ? { docs: DOCS, totalDocs: 3 } : { docs: [] },
    )
    const res = await call('sort=-startedAt&limit=2')
    expect(res.body.conversations).toHaveLength(2)
    expect(res.body.cursor).toBeTruthy()
    expect(decodeCursor(res.body.cursor as string)).toEqual({
      value: '2026-10-09T00:00:00.000Z',
      id: 'id-2',
    })
  })

  it('issues a null-valued cursor when the last row has no value in the sort column', async () => {
    mockFind.mockImplementation(async ({ collection }: { collection: string }) =>
      collection === 'conversations' ? { docs: DOCS, totalDocs: 3 } : { docs: [] },
    )
    const res = await call('sort=-decisionStatus&limit=2')
    expect(decodeCursor(res.body.cursor as string)).toEqual({ value: null, id: 'id-2' })
  })

  it('applies the cursor as a keyset clause on the sort column', async () => {
    const cursor = Buffer.from(JSON.stringify({ v: 'APP-2', id: 'id-2' })).toString('base64url')
    await call(`sort=applicationNumber&cursor=${cursor}`)
    const where = conversationsFindArgs()?.where as { and: unknown[] }
    expect(where.and).toContainEqual({
      or: [
        { applicationNumber: { greater_than: 'APP-2' } },
        { and: [{ applicationNumber: { equals: 'APP-2' } }, { id: { greater_than: 'id-2' } }] },
        { applicationNumber: { exists: false } },
      ],
    })
  })
})
