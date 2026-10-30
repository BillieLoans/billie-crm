/**
 * Unit tests for POST /api/ledger/cancel-account (BTB-517).
 *
 * A supervisor cancels a loan that has not been disbursed. The route:
 *   - is supervisor/admin only (`hasApprovalAuthority`),
 *   - validates the body (note >= 20 chars, evidence for a mutual cancellation,
 *     a block confirmation, a uuid idempotency key),
 *   - re-checks a claimed manual block against the customer record (AC16),
 *   - calls the ledger's CancelAccount RPC with the actor and the client's key,
 *   - maps the RPC's status codes, and
 *   - writes the pinned system contact note once the cancel has landed, without
 *     ever reporting a completed cancel as failed.
 *
 * `@/server/grpc-client` is mocked (its module body loads the proto at import
 * time); Payload is a hand-rolled stub keyed on collection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { textToTiptapDoc } from '@/lib/tiptap'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

const state = vi.hoisted(() => ({
  user: {
    id: 'user-1',
    email: 'sam@billie.loans',
    role: 'supervisor',
    firstName: 'Sam',
    lastName: 'Supervisor',
  } as {
    id: string
    email: string
    role: string
    firstName?: string
    lastName?: string
  },
}))

const mockPayload = vi.hoisted(() => ({
  find: vi.fn(),
  create: vi.fn(),
}))

// The mock honours the route's access check, so a wrong predicate fails a test.
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async (accessCheck?: (u: unknown) => boolean) => {
    if (accessCheck && !accessCheck(state.user)) {
      return {
        error: {
          body: { error: { code: 'FORBIDDEN' } },
          status: 403,
        },
      }
    }
    return { user: state.user, payload: mockPayload }
  }),
}))

const mockCancelAccount = vi.hoisted(() => vi.fn())
vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: () => ({ cancelAccount: mockCancelAccount }),
}))

import { POST } from '@/app/api/ledger/cancel-account/route'

const KEY = '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b'
const NOTE = 'Customer rang and asked us to stop before the money moved.'

const makeRequest = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

type Res = { body: Record<string, any>; status: number }

const call = async (body: unknown) => (await POST(makeRequest(body))) as unknown as Res

/** A valid request body; override per test. */
const validBody = (over: Record<string, unknown> = {}) => ({
  loanAccountId: 'LA-1',
  reason: 'customer_withdrew',
  note: NOTE,
  blockConfirmation: { kind: 'no_block_needed', reason: 'Customer is welcome back' },
  idempotencyKey: KEY,
  ...over,
})

const LOAN = { id: 'loan-doc-1', loanAccountId: 'LA-1', customerIdString: 'CUS-1' }
const CUSTOMER = { id: 'cus-doc-1', customerId: 'CUS-1', reapplicationBlock: null }

let loanDocs: unknown[]
let customerDocs: unknown[]
let noteDocs: unknown[]

const grpcOk = (over: Record<string, unknown> = {}) => ({
  success: true,
  message: 'Account cancelled',
  eventId: 'evt-1',
  cancelledAt: '2026-10-30T04:45:00+00:00',
  previousStatus: 'PENDING_DISBURSEMENT',
  idempotentReplay: false,
  ...over,
})

const grpcError = (code: number, details: string) =>
  Object.assign(new Error(`${code} ${details}`), { code, details })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  state.user = {
    id: 'user-1',
    email: 'sam@billie.loans',
    role: 'supervisor',
    firstName: 'Sam',
    lastName: 'Supervisor',
  }
  loanDocs = [LOAN]
  customerDocs = [CUSTOMER]
  noteDocs = []
  mockPayload.find.mockImplementation(async ({ collection }: { collection: string }) => {
    const docs =
      collection === 'loan-accounts'
        ? loanDocs
        : collection === 'customers'
          ? customerDocs
          : collection === 'contact-notes'
            ? noteDocs
            : []
    return { docs, totalDocs: docs.length }
  })
  mockPayload.create.mockResolvedValue({ id: 'note-1' })
  mockCancelAccount.mockResolvedValue(grpcOk())
})

describe('POST /api/ledger/cancel-account: authorisation', () => {
  it('rejects non-supervisor (403)', async () => {
    state.user = { ...state.user, role: 'operations' }

    const res = await call(validBody())

    expect(res.status).toBe(403)
    expect(mockCancelAccount).not.toHaveBeenCalled()
    expect(mockPayload.create).not.toHaveBeenCalled()
  })

  it('lets an admin through', async () => {
    state.user = { ...state.user, role: 'admin' }

    const res = await call(validBody())

    expect(res.status).toBe(200)
    expect(mockCancelAccount).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/ledger/cancel-account: validation', () => {
  it('rejects note of 19 chars (400, field note)', async () => {
    const res = await call(validBody({ note: 'x'.repeat(19) }))

    expect(res.status).toBe(400)
    expect(res.body.details.note).toBeDefined()
    expect(mockCancelAccount).not.toHaveBeenCalled()
  })

  it('counts the note after trimming', async () => {
    const res = await call(validBody({ note: `  ${'x'.repeat(19)}   ` }))

    expect(res.status).toBe(400)
    expect(res.body.details.note).toBeDefined()
  })

  it('accepts a note of exactly 20 chars', async () => {
    const res = await call(validBody({ note: 'x'.repeat(20) }))

    expect(res.status).toBe(200)
  })

  it('rejects mutual_cancellation without evidenceRef (400, field evidenceRef)', async () => {
    const res = await call(validBody({ reason: 'mutual_cancellation' }))

    expect(res.status).toBe(400)
    expect(res.body.details.evidenceRef).toBeDefined()
    expect(mockCancelAccount).not.toHaveBeenCalled()
  })

  it('treats a blank evidenceRef as missing for mutual_cancellation', async () => {
    const res = await call(validBody({ reason: 'mutual_cancellation', evidenceRef: '   ' }))

    expect(res.status).toBe(400)
    expect(res.body.details.evidenceRef).toBeDefined()
  })

  it('does not require evidenceRef for the other reasons', async () => {
    for (const reason of ['customer_withdrew', 'offer_lapsed', 'fraud_hold', 'duplicate']) {
      mockCancelAccount.mockClear()
      const res = await call(validBody({ reason }))
      expect(res.status, reason).toBe(200)
    }
  })

  it('rejects reserved reason (400, field reason)', async () => {
    const res = await call(validBody({ reason: 'lender_declined_pre_disbursement' }))

    expect(res.status).toBe(400)
    expect(res.body.details.reason).toBeDefined()
    expect(mockCancelAccount).not.toHaveBeenCalled()
  })

  it('rejects an unknown reason', async () => {
    const res = await call(validBody({ reason: 'changed_my_mind' }))

    expect(res.status).toBe(400)
    expect(res.body.details.reason).toBeDefined()
  })

  it('rejects a missing blockConfirmation', async () => {
    const res = await call(validBody({ blockConfirmation: undefined }))

    expect(res.status).toBe(400)
    expect(res.body.details.blockConfirmation).toBeDefined()
  })

  it('rejects no_block_needed with a reason under 10 chars', async () => {
    const res = await call(
      validBody({ blockConfirmation: { kind: 'no_block_needed', reason: 'too short' } }),
    )

    expect(res.status).toBe(400)
    expect(mockCancelAccount).not.toHaveBeenCalled()
  })

  it('rejects a missing idempotencyKey', async () => {
    const res = await call(validBody({ idempotencyKey: undefined }))

    expect(res.status).toBe(400)
    expect(res.body.details.idempotencyKey).toBeDefined()
  })

  it('rejects an idempotencyKey that is not a uuid', async () => {
    const res = await call(validBody({ idempotencyKey: 'not-a-uuid-at-all' }))

    expect(res.status).toBe(400)
    expect(res.body.details.idempotencyKey).toBeDefined()
  })
})

describe('POST /api/ledger/cancel-account: block confirmation (AC16)', () => {
  const manual = { kind: 'manual_block_active' }
  const future = '2999-01-01'

  it('rejects manual_block_active when customer has no active MANUAL_ADMIN block (422 BLOCK_REQUIRED)', async () => {
    customerDocs = [{ ...CUSTOMER, reapplicationBlock: null }]

    const res = await call(validBody({ blockConfirmation: manual }))

    expect(res.status).toBe(422)
    expect(res.body.error).toBe('BLOCK_REQUIRED')
    expect(mockCancelAccount).not.toHaveBeenCalled()
    expect(mockPayload.create).not.toHaveBeenCalled()
  })

  it('rejects an active block that is not MANUAL_ADMIN', async () => {
    customerDocs = [{ ...CUSTOMER, reapplicationBlock: { reason: 'PEP', blockedUntil: null } }]

    const res = await call(validBody({ blockConfirmation: manual }))

    expect(res.status).toBe(422)
    expect(res.body.error).toBe('BLOCK_REQUIRED')
    expect(mockCancelAccount).not.toHaveBeenCalled()
  })

  it('rejects a MANUAL_ADMIN block that has expired', async () => {
    customerDocs = [
      {
        ...CUSTOMER,
        reapplicationBlock: { reason: 'MANUAL_ADMIN', blockedUntil: '2020-01-01' },
      },
    ]

    const res = await call(validBody({ blockConfirmation: manual }))

    expect(res.status).toBe(422)
    expect(res.body.error).toBe('BLOCK_REQUIRED')
    expect(mockCancelAccount).not.toHaveBeenCalled()
  })

  it('rejects when the customer cannot be found', async () => {
    customerDocs = []

    const res = await call(validBody({ blockConfirmation: manual }))

    expect(res.status).toBe(422)
    expect(res.body.error).toBe('BLOCK_REQUIRED')
    expect(mockCancelAccount).not.toHaveBeenCalled()
  })

  it('accepts an active permanent MANUAL_ADMIN block', async () => {
    customerDocs = [
      { ...CUSTOMER, reapplicationBlock: { reason: 'MANUAL_ADMIN', blockedUntil: null } },
    ]

    const res = await call(validBody({ blockConfirmation: manual }))

    expect(res.status).toBe(200)
    expect(mockCancelAccount).toHaveBeenCalledTimes(1)
  })

  it('accepts a dated MANUAL_ADMIN block that is still running', async () => {
    customerDocs = [
      {
        ...CUSTOMER,
        reapplicationBlock: { reason: 'MANUAL_ADMIN', blockedUntil: future },
      },
    ]

    const res = await call(validBody({ blockConfirmation: manual }))

    expect(res.status).toBe(200)
  })

  it('follows a merged customer to the canonical record when reading the block', async () => {
    mockPayload.find.mockImplementation(
      async ({ collection, where }: { collection: string; where?: any }) => {
        if (collection === 'loan-accounts') return { docs: [LOAN] }
        if (collection === 'customers') {
          const wanted = where?.customerId?.equals
          if (wanted === 'CUS-1') {
            return {
              docs: [{ id: 'cus-alias', customerId: 'CUS-1', mergedInto: 'CUS-CANON' }],
            }
          }
          if (wanted === 'CUS-CANON') {
            return {
              docs: [
                {
                  id: 'cus-canon',
                  customerId: 'CUS-CANON',
                  reapplicationBlock: { reason: 'MANUAL_ADMIN', blockedUntil: null },
                },
              ],
            }
          }
        }
        return { docs: [] }
      },
    )

    const res = await call(validBody({ blockConfirmation: manual }))

    expect(res.status).toBe(200)
    // The note belongs to the canonical customer the supervisor is looking at.
    expect(mockPayload.create.mock.calls[0][0].data.customer).toBe('cus-canon')
  })

  it('does not read the customer for no_block_needed before the cancel', async () => {
    mockCancelAccount.mockRejectedValue(grpcError(9, 'account is not cancellable in status ACTIVE'))

    await call(validBody())

    expect(mockPayload.find).not.toHaveBeenCalled()
  })

  it('logs the block confirmation server-side, for both kinds', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    customerDocs = [
      { ...CUSTOMER, reapplicationBlock: { reason: 'MANUAL_ADMIN', blockedUntil: null } },
    ]

    await call(validBody({ blockConfirmation: manual }))
    await call(
      validBody({
        blockConfirmation: { kind: 'no_block_needed', reason: 'Customer is welcome back' },
        idempotencyKey: '9a8b7c6d-1111-4222-8333-444455556666',
      }),
    )

    const logged = info.mock.calls.map((c) => JSON.stringify(c))
    expect(logged.some((l) => l.includes('manual_block_active') && l.includes('LA-1'))).toBe(true)
    expect(
      logged.some((l) => l.includes('no_block_needed') && l.includes('Customer is welcome back')),
    ).toBe(true)
  })
})

describe('POST /api/ledger/cancel-account: the ledger call', () => {
  it('accepts no_block_needed with reason', async () => {
    const res = await call(validBody())

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('calls cancelAccount with actor and idempotencyKey', async () => {
    await call(
      validBody({
        reason: 'mutual_cancellation',
        evidenceRef: ' email-2026-10-29-agreement ',
        note: `  ${NOTE}  `,
      }),
    )

    expect(mockCancelAccount).toHaveBeenCalledTimes(1)
    expect(mockCancelAccount).toHaveBeenCalledWith({
      loanAccountId: 'LA-1',
      reasonCode: 'mutual_cancellation',
      note: NOTE,
      evidenceRef: 'email-2026-10-29-agreement',
      actorId: 'user-1',
      actorName: 'Sam Supervisor',
      idempotencyKey: KEY,
    })
  })

  it('omits evidenceRef when none was given', async () => {
    await call(validBody())

    expect(mockCancelAccount.mock.calls[0][0].evidenceRef).toBeUndefined()
  })

  it('falls back to the email when the user has no name', async () => {
    state.user = { id: 'user-2', email: 'pat@billie.loans', role: 'admin' }

    await call(validBody())

    expect(mockCancelAccount.mock.calls[0][0]).toMatchObject({
      actorId: 'user-2',
      actorName: 'pat@billie.loans',
    })
  })

  it('returns the ledger result', async () => {
    const res = await call(validBody())

    expect(res.body).toMatchObject({
      success: true,
      message: 'Account cancelled',
      eventId: 'evt-1',
      cancelledAt: '2026-10-30T04:45:00+00:00',
      previousStatus: 'PENDING_DISBURSEMENT',
      idempotentReplay: false,
      noteError: false,
    })
  })
})

describe('POST /api/ledger/cancel-account: the system contact note', () => {
  it('creates system contact note with exact text', async () => {
    await call(
      validBody({
        reason: 'mutual_cancellation',
        evidenceRef: 'email-2026-10-29-agreement',
      }),
    )

    expect(mockPayload.create).toHaveBeenCalledTimes(1)
    const arg = mockPayload.create.mock.calls[0][0]
    expect(arg.collection).toBe('contact-notes')
    expect(arg.user).toBe(state.user)
    expect(arg.data).toEqual({
      customer: 'cus-doc-1',
      loanAccount: 'loan-doc-1',
      channel: 'system',
      topic: 'account_update',
      subject: 'Loan cancelled before disbursement',
      createdBy: 'user-1',
      status: 'active',
      content: textToTiptapDoc(
        `Cancelled — Mutual cancellation — ${NOTE} — by Sam Supervisor at 30 Oct 2026, 3:45 pm — evidence: email-2026-10-29-agreement`,
      ),
    })
  })

  it('writes "evidence: none" when there is no evidence ref', async () => {
    await call(validBody())

    const text = mockPayload.create.mock.calls[0][0].data.content.content[0].content[0].text
    expect(text).toBe(
      `Cancelled — Customer withdrew — ${NOTE} — by Sam Supervisor at 30 Oct 2026, 3:45 pm — evidence: none`,
    )
  })

  it('formats the time from the ledger cancelledAt, in Sydney', async () => {
    // 22:30Z on 30 Oct is 9:30 am on 31 Oct in Sydney (AEDT, UTC+11).
    mockCancelAccount.mockResolvedValue(grpcOk({ cancelledAt: '2026-10-30T22:30:00Z' }))

    await call(validBody())

    const text = mockPayload.create.mock.calls[0][0].data.content.content[0].content[0].text
    expect(text).toContain(' at 31 Oct 2026, 9:30 am — ')
  })

  it('does not write the block confirmation into the note', async () => {
    await call(validBody())

    const text = mockPayload.create.mock.calls[0][0].data.content.content[0].content[0].text
    expect(text).not.toContain('welcome back')
  })

  it('still creates the note when the ledger replays an earlier cancel and no note exists', async () => {
    mockCancelAccount.mockResolvedValue(grpcOk({ idempotentReplay: true }))
    noteDocs = []

    const res = await call(validBody())

    expect(res.status).toBe(200)
    expect(res.body.idempotentReplay).toBe(true)
    expect(mockPayload.create).toHaveBeenCalledTimes(1)
  })

  it('does not write a second note when one already exists for this cancel', async () => {
    mockCancelAccount.mockResolvedValue(grpcOk({ idempotentReplay: true }))
    noteDocs = [{ id: 'note-existing' }]

    const res = await call(validBody())

    expect(res.status).toBe(200)
    expect(res.body.noteError).toBe(false)
    expect(mockPayload.create).not.toHaveBeenCalled()
    const lookup = mockPayload.find.mock.calls.find((c) => c[0].collection === 'contact-notes')![0]
    expect(JSON.stringify(lookup.where)).toContain('loan-doc-1')
    expect(JSON.stringify(lookup.where)).toContain('Loan cancelled before disbursement')
  })

  it('returns success with noteError when the note cannot be created', async () => {
    mockPayload.create.mockRejectedValue(new Error('db down'))

    const res = await call(validBody())

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.noteError).toBe(true)
    expect(console.error).toHaveBeenCalled()
  })

  it('returns success with noteError when the loan or customer is missing for the note', async () => {
    loanDocs = []

    const res = await call(validBody())

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.noteError).toBe(true)
    expect(mockPayload.create).not.toHaveBeenCalled()
  })

  it('returns success with noteError when the Payload lookup itself fails', async () => {
    mockPayload.find.mockRejectedValue(new Error('db down'))

    const res = await call(validBody())

    expect(res.status).toBe(200)
    expect(res.body.noteError).toBe(true)
  })

  it('does not write a note when the ledger reports no success', async () => {
    mockCancelAccount.mockResolvedValue(grpcOk({ success: false, message: 'declined' }))

    const res = await call(validBody())

    expect(res.body.success).toBe(false)
    expect(mockPayload.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/ledger/cancel-account: ledger errors', () => {
  it('maps FAILED_PRECONDITION to 422 NOT_CANCELLABLE', async () => {
    mockCancelAccount.mockRejectedValue(grpcError(9, 'account is not cancellable in status ACTIVE'))

    const res = await call(validBody())

    expect(res.status).toBe(422)
    expect(res.body).toEqual({
      error: 'NOT_CANCELLABLE',
      message: 'account is not cancellable in status ACTIVE',
    })
    expect(mockPayload.create).not.toHaveBeenCalled()
  })

  it('carries the "funds already disbursed" details through', async () => {
    mockCancelAccount.mockRejectedValue(grpcError(9, 'funds already disbursed'))

    const res = await call(validBody())

    expect(res.status).toBe(422)
    expect(res.body.message).toBe('funds already disbursed')
  })

  it('maps INVALID_ARGUMENT to 400 VALIDATION with the details', async () => {
    mockCancelAccount.mockRejectedValue(grpcError(3, 'note: must be at least 20 characters'))

    const res = await call(validBody())

    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: 'VALIDATION',
      message: 'note: must be at least 20 characters',
    })
  })

  it('maps ABORTED to 409 ACCOUNT_BUSY so the UI can say try again', async () => {
    mockCancelAccount.mockRejectedValue(grpcError(10, 'account is locked by another writer'))

    const res = await call(validBody())

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('ACCOUNT_BUSY')
    expect(typeof res.body.message).toBe('string')
    expect(res.body.message.length).toBeGreaterThan(0)
  })

  it('maps UNAVAILABLE to a retryable 503 and writes no note', async () => {
    mockCancelAccount.mockRejectedValue(grpcError(14, 'publish failed'))

    const res = await call(validBody())

    expect(res.status).toBe(503)
    expect(res.body.message).toMatch(/try again/i)
    expect(mockPayload.create).not.toHaveBeenCalled()
  })

  it('maps NOT_FOUND to 404 through handleApiError', async () => {
    mockCancelAccount.mockRejectedValue(grpcError(5, 'account LA-1 not found'))

    const res = await call(validBody())

    expect(res.status).toBe(404)
  })

  it('maps anything else to 500 through handleApiError', async () => {
    mockCancelAccount.mockRejectedValue(new Error('boom'))

    const res = await call(validBody())

    expect(res.status).toBe(500)
  })
})
