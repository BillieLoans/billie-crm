/**
 * Statement deletion API routes: preview, delete and latest-deletion read.
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

type TestUser = {
  id: string | number
  role: string
  email: string
  firstName?: string
  lastName?: string
}
let currentUser: TestUser | null = null

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async (check?: (u: unknown) => boolean) => {
    if (!currentUser) {
      return { error: { body: { error: { code: 'UNAUTHENTICATED' } }, status: 401 } }
    }
    if (check && !check(currentUser)) {
      return { error: { body: { error: { code: 'FORBIDDEN' } }, status: 403 } }
    }
    return { user: currentUser, payload: { marker: 'payload' } }
  }),
}))

vi.mock('@/lib/utils/rateLimit', async (orig) => ({
  ...(await orig<typeof import('@/lib/utils/rateLimit')>()),
  rateLimit: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/server/statement-deletion', () => ({
  previewDeletion: vi.fn(),
  executeDeletion: vi.fn(),
  latestDeletion: vi.fn(),
}))

import { POST as previewPOST } from '@/app/api/statements/deletion/preview/route'
import { POST as deletePOST, GET } from '@/app/api/statements/deletion/route'
import { previewDeletion, executeDeletion, latestDeletion } from '@/server/statement-deletion'
import { rateLimit } from '@/lib/utils/rateLimit'

type Res = { body: Record<string, any>; status: number }
const post = async (fn: typeof deletePOST, body: unknown) =>
  (await fn({ json: async () => body } as any)) as unknown as Res
const get = async (qs: string) =>
  (await GET({
    nextUrl: new URL(`http://x/api/statements/deletion${qs}`),
  } as any)) as unknown as Res

const appScope = { scope: 'application', conversationId: 'conv-1' }
const result = { conversationId: 'conv-1', applicationNumber: 'APP-1', fileCount: 2 }

beforeEach(() => {
  vi.mocked(previewDeletion)
    .mockReset()
    .mockResolvedValue([result] as any)
  vi.mocked(executeDeletion)
    .mockReset()
    .mockResolvedValue([result] as any)
  vi.mocked(latestDeletion).mockReset().mockResolvedValue(null)
  vi.mocked(rateLimit).mockReset().mockResolvedValue(true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  currentUser = {
    id: 7,
    role: 'supervisor',
    email: 'sam@billie.loans',
    firstName: 'Sam',
    lastName: 'Lee',
  }
})

describe.each([
  ['preview', previewPOST, () => previewDeletion, {}],
  ['delete', deletePOST, () => executeDeletion, { reason: 'Customer request' }],
])('POST %s access', (_n, fn, svc, extra) => {
  it.each(['operations', 'readonly'])('%s gets 403 and the service is not called', async (role) => {
    currentUser = { ...currentUser!, role }
    const res = await post(fn, { ...appScope, ...extra })
    expect(res.status).toBe(403)
    expect(svc()).not.toHaveBeenCalled()
  })

  it('401 when not signed in', async () => {
    currentUser = null
    expect((await post(fn, { ...appScope, ...extra })).status).toBe(401)
  })

  it('supervisor gets 200', async () => {
    expect((await post(fn, { ...appScope, ...extra })).status).toBe(200)
  })

  it('429 when rate limited, keyed by user', async () => {
    vi.mocked(rateLimit).mockResolvedValue(false)
    const res = await post(fn, { ...appScope, ...extra })
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('RATE_LIMITED')
    expect(vi.mocked(rateLimit).mock.calls[0][0]).toBe('statement-deletion:7')
    expect(svc()).not.toHaveBeenCalled()
  })

  it('404 when the scope matches no conversation', async () => {
    vi.mocked(svc()).mockResolvedValue([])
    const res = await post(fn, { ...appScope, ...extra })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('500 INTERNAL_ERROR when the service throws', async () => {
    vi.mocked(svc()).mockRejectedValue(new Error('boom'))
    const res = await post(fn, { ...appScope, ...extra })
    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('INTERNAL_ERROR')
    expect(console.error).toHaveBeenCalled()
  })
})

describe('POST preview', () => {
  it('returns applications and passes the parsed scope', async () => {
    const res = await post(previewPOST, { scope: 'customer', customerIdString: ' CUS-1 ' })
    expect(res.body).toEqual({ applications: [result] })
    expect(vi.mocked(previewDeletion).mock.calls[0][1]).toEqual({
      scope: 'customer',
      customerIdString: 'CUS-1',
    })
  })

  it('400 for an unknown scope', async () => {
    const res = await post(previewPOST, { scope: 'everything' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('POST delete validation', () => {
  it.each([
    ['missing reason', { ...appScope }],
    ['whitespace reason', { ...appScope, reason: '   ' }],
    ['501-char reason', { ...appScope, reason: 'x'.repeat(501) }],
    ['unknown scope', { scope: 'all', reason: 'r' }],
    ['empty conversationId', { scope: 'application', conversationId: '', reason: 'r' }],
    ['non-object body', null],
  ])('400 for %s', async (_n, body) => {
    const res = await post(deletePOST, body)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(executeDeletion).not.toHaveBeenCalled()
  })

  it('passes scope, trimmed reason and actor, ignoring keys', async () => {
    const res = await post(deletePOST, {
      ...appScope,
      reason: '  Customer request  ',
      keys: ['customer/APP-1/statements/a.pdf'],
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ results: [result] })
    const [payload, scope, reason, actor] = vi.mocked(executeDeletion).mock.calls[0]
    expect(payload).toEqual({ marker: 'payload' })
    expect(scope).toEqual(appScope)
    expect(reason).toBe('Customer request')
    expect(actor).toEqual({ id: '7', email: 'sam@billie.loans', name: 'Sam Lee' })
  })

  it('actor name is undefined when the user has no names', async () => {
    currentUser = { id: 7, role: 'admin', email: 'a@b.c' }
    await post(deletePOST, { ...appScope, reason: 'r' })
    expect(vi.mocked(executeDeletion).mock.calls[0][3].name).toBeUndefined()
  })
})

describe('GET latest deletion', () => {
  it('readonly gets 200 with null', async () => {
    currentUser = { ...currentUser!, role: 'readonly' }
    const res = await get('?conversationId=conv-1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ deletion: null })
    expect(vi.mocked(latestDeletion).mock.calls[0][1]).toBe('conv-1')
  })

  it('400 without conversationId', async () => {
    const res = await get('')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('500 when the read throws', async () => {
    vi.mocked(latestDeletion).mockRejectedValue(new Error('db'))
    expect((await get('?conversationId=conv-1')).status).toBe(500)
  })
})
