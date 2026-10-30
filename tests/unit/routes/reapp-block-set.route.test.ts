/**
 * POST /api/commands/reapp-block-set (BTB-517).
 *
 * A supervisor or admin asks billieChat's reapplicationBlock service to put a
 * MANUAL_ADMIN block on a canonical customer. The route publishes
 * reapplication_block.manual_set.v1 (the B2 payload) and answers 202; the
 * block's outcome comes back on the customer record, never in this response.
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

// requireAuth with the real predicate applied, so the role gate is exercised.
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async (check?: (u: unknown) => boolean) => {
    if (!currentUser) {
      return { error: { body: { error: { code: 'UNAUTHENTICATED' } }, status: 401 } }
    }
    if (check && !check(currentUser)) {
      return { error: { body: { error: { code: 'FORBIDDEN' } }, status: 403 } }
    }
    return { user: currentUser, payload: {} }
  }),
}))

vi.mock('@/server/chatledger-publisher', () => ({
  publishManualBlockSet: vi.fn().mockResolvedValue({ eventId: 'evt-1' }),
}))

vi.mock('@/server/event-publisher', () => ({
  EventPublishError: class EventPublishError extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'EventPublishError'
    }
  },
}))

import { POST } from '@/app/api/commands/reapp-block-set/route'
import { publishManualBlockSet } from '@/server/chatledger-publisher'
import { EventPublishError } from '@/server/event-publisher'

type Res = { body: Record<string, any>; status: number }
const call = async (body: unknown) =>
  (await POST({ json: async () => body } as any)) as unknown as Res

const valid = {
  canonicalCustomerId: 'CUS-1',
  reasonCode: 'cancelled_pre_disbursement',
  note: '  Loan cancelled before disbursement; hold re-applications.  ',
  blockUntil: null,
}

const published = () => vi.mocked(publishManualBlockSet).mock.calls[0][0]

beforeEach(() => {
  vi.mocked(publishManualBlockSet).mockReset()
  vi.mocked(publishManualBlockSet).mockResolvedValue({ eventId: 'evt-1' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  currentUser = {
    id: 7,
    role: 'supervisor',
    email: 'sam@billie.loans',
    firstName: 'Sam',
    lastName: 'Supervisor',
  }
})

describe('POST /api/commands/reapp-block-set', () => {
  it('reapp-block-set publishes manual_set.v1 with B2 payload', async () => {
    const res = await call(valid)

    expect(res.status).toBe(202)
    expect(publishManualBlockSet).toHaveBeenCalledTimes(1)
    const payload = published()
    expect(payload).toEqual({
      request_id: expect.any(String),
      canonical_customer_id: 'CUS-1',
      operator_id: '7',
      operator_name: 'Sam Supervisor',
      reason_code: 'cancelled_pre_disbursement',
      note: 'Loan cancelled before disbursement; hold re-applications.',
      expires_at: null,
    })
    expect(payload.request_id.length).toBeGreaterThan(8)
    expect(res.body).toEqual({
      requestId: payload.request_id,
      eventId: 'evt-1',
      status: 'accepted',
      message: 'Manual block requested',
    })
  })

  it('a new request id every time, so billieChat never takes a new set for a replay', async () => {
    await call(valid)
    await call(valid)
    const [a, b] = vi.mocked(publishManualBlockSet).mock.calls.map(([p]) => p.request_id)
    expect(a).not.toBe(b)
  })

  it('an end date runs the block to the end of that Sydney day', async () => {
    await call({ ...valid, blockUntil: '2099-03-31' })
    // 31 Mar 2099 is AEDT (UTC+11): 23:59:59.999 local = 12:59:59.999Z.
    expect(published().expires_at).toBe('2099-03-31T12:59:59.999Z')
  })

  it('admins may set a block too', async () => {
    currentUser = { id: 'a-1', role: 'admin', email: 'ada@billie.loans' }
    const res = await call(valid)
    expect(res.status).toBe(202)
    // No first name: the email stands in for the operator's name.
    expect(published().operator_name).toBe('ada@billie.loans')
  })

  it.each(['operations', 'readonly', 'marketing', 'service'])(
    '%s is refused (403)',
    async (role) => {
      currentUser = { id: 'x', role, email: 'x@billie.loans' }
      const res = await call(valid)
      expect(res.status).toBe(403)
      expect(publishManualBlockSet).not.toHaveBeenCalled()
    },
  )

  it('no session is 401', async () => {
    currentUser = null
    const res = await call(valid)
    expect(res.status).toBe(401)
    expect(publishManualBlockSet).not.toHaveBeenCalled()
  })

  it.each([
    ['an unknown reason code', { reasonCode: 'operational' }, 'reasonCode'],
    [
      'the reserved lender decline',
      { reasonCode: 'lender_declined_pre_disbursement' },
      'reasonCode',
    ],
    ['a blank note', { note: '   ' }, 'note'],
    ['a missing customer', { canonicalCustomerId: '' }, 'canonicalCustomerId'],
    ['a malformed date', { blockUntil: '31/03/2099' }, 'blockUntil'],
    ['a date already past', { blockUntil: '2020-01-01' }, 'blockUntil'],
  ])('rejects %s (400) and publishes nothing', async (_label, over, field) => {
    const res = await call({ ...valid, ...over })
    expect(res.status).toBe(400)
    expect(res.body.details).toHaveProperty(field)
    expect(publishManualBlockSet).not.toHaveBeenCalled()
  })

  it('a publish failure is 503 and says to try again', async () => {
    vi.mocked(publishManualBlockSet).mockRejectedValueOnce(new EventPublishError('down'))
    const res = await call(valid)
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('EVENT_PUBLISH_FAILED')
    expect(res.body.error.message).toBe('The block request was not sent. Try again.')
  })

  it('anything else is 500', async () => {
    vi.mocked(publishManualBlockSet).mockRejectedValueOnce(new Error('boom'))
    const res = await call(valid)
    expect(res.status).toBe(500)
  })
})
