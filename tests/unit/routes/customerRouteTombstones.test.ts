/**
 * GET /api/customer/:customerId and /api/customer/search — identity tombstones
 * and contact provenance (BTB-392).
 *
 * A customer row an identity link folded into a canonical carries
 * `mergedInto`. The detail route answers with a redirect target instead of
 * serving the stale alias; the search route points alias hits at the
 * canonical and labels them; the detail route serves the platform's
 * provenance fields beside the flat email / mobile.
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

const mockFind = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({ payload: { find: mockFind } })),
}))
vi.mock('@/lib/access', () => ({ hasAnyRole: () => true }))
vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: () => ({ getBalance: vi.fn(async () => ({})) }),
  timestampToDate: () => new Date(0),
}))

import { GET as getCustomer } from '@/app/api/customer/[customerId]/route'
import { GET as searchCustomers } from '@/app/api/customer/search/route'
import type { NextRequest } from 'next/server'

const CANONICAL = {
  id: 'pl-canonical',
  customerId: '23D47AB2',
  fullName: 'Rohan Sharp',
  emailAddress: 'rohansharp+6@gmail.com',
  mobilePhoneNumber: '0412345678',
  identityVerified: true,
  loanAccounts: [{ id: 'la-1' }],
  mergedInto: null,
  canonicalId: '23D47AB2',
  customerIdStatus: 'ADMITTED',
  emailTier: 'BOUND',
  emailSource: 'ZITADEL_LOGIN',
  emailVerifiedAt: '2026-09-23T13:15:00.000Z',
  mobilePhoneTier: 'VERIFIED',
  mobilePhoneSource: 'OTP_SMS',
  mobilePhoneVerifiedAt: '2026-09-23T13:15:00.000Z',
  contacts: [
    { contact_type: 'EMAIL', value: 'rohansharp+6@gmail.com', tier: 'BOUND', is_primary: true },
    {
      contact_type: 'EMAIL',
      value: 'rohan.sharp@example.com',
      tier: 'ASSERTED',
      is_primary: false,
    },
  ],
  contactsChangedBy: 'reconciliation',
  contactsChangedAt: '2026-09-23T13:15:00.000Z',
}

const ALIAS = {
  id: 'pl-alias',
  customerId: '258DE915',
  fullName: 'Rohan Sharp',
  emailAddress: 'rohan.sharp@example.com',
  mobilePhoneNumber: null,
  identityVerified: false,
  loanAccounts: [],
  mergedInto: '23D47AB2',
  mergedReason: 'DOCUMENT_AGREE',
}

function detailRequest(customerId: string) {
  return getCustomer({} as NextRequest, {
    params: Promise.resolve({ customerId }),
  }) as unknown as Promise<{
    body: Record<string, unknown>
    status: number
  }>
}

function searchRequest(q: string) {
  const request = {
    nextUrl: new URL(`http://crm.test/api/customer/search?q=${encodeURIComponent(q)}`),
  }
  return searchCustomers(request as unknown as NextRequest) as unknown as Promise<{
    body: { results: Array<Record<string, unknown>>; total: number }
    status: number
  }>
}

beforeEach(() => {
  mockFind.mockReset()
})

describe('GET /api/customer/:customerId', () => {
  it('answers with the canonical id for a tombstoned alias instead of serving it', async () => {
    mockFind.mockImplementation(async ({ collection }: { collection: string }) =>
      collection === 'customers' ? { docs: [ALIAS] } : { docs: [] },
    )

    const res = await detailRequest('258DE915')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      redirectTo: '23D47AB2',
      viaAlias: '258DE915',
      mergedReason: 'DOCUMENT_AGREE',
    })
    // Nothing else was fetched for the stale row.
    expect(mockFind).toHaveBeenCalledTimes(1)
  })

  it('serves the provenance fields beside the flat contacts for a live customer', async () => {
    mockFind.mockImplementation(async ({ collection }: { collection: string }) =>
      collection === 'customers' ? { docs: [CANONICAL] } : { docs: [] },
    )

    const res = await detailRequest('23D47AB2')

    expect(res.status).toBe(200)
    const customer = res.body.customer as Record<string, unknown>
    expect(customer.emailAddress).toBe('rohansharp+6@gmail.com')
    expect(customer.emailTier).toBe('BOUND')
    expect(customer.emailSource).toBe('ZITADEL_LOGIN')
    expect(customer.mobilePhoneTier).toBe('VERIFIED')
    expect(customer.customerIdStatus).toBe('ADMITTED')
    expect(customer.canonicalId).toBe('23D47AB2')
    expect(customer.contactsChangedBy).toBe('reconciliation')
    expect(customer.contacts).toHaveLength(2)
    expect(customer.mergedReason).toBeNull()
  })

  it('serves nulls for a legacy row the platform has not written', async () => {
    const legacy = {
      ...CANONICAL,
      emailTier: undefined,
      contacts: undefined,
      customerIdStatus: undefined,
    }
    mockFind.mockImplementation(async ({ collection }: { collection: string }) =>
      collection === 'customers' ? { docs: [legacy] } : { docs: [] },
    )

    const res = await detailRequest('23D47AB2')

    const customer = res.body.customer as Record<string, unknown>
    expect(customer.emailTier).toBeNull()
    expect(customer.contacts).toBeNull()
    expect(customer.customerIdStatus).toBeNull()
  })
})

describe('GET /api/customer/search', () => {
  it('points an alias hit at the canonical and labels the former record', async () => {
    mockFind.mockResolvedValue({ docs: [ALIAS], totalDocs: 1 })

    const res = await searchRequest('rohan.sharp@example.com')

    expect(res.body.results).toEqual([
      expect.objectContaining({
        customerId: '23D47AB2',
        matchedFormerRecord: '258DE915',
        emailAddress: 'rohan.sharp@example.com',
      }),
    ])
  })

  it('collapses an alias hit and a canonical hit for the same customer into the canonical', async () => {
    mockFind.mockResolvedValue({ docs: [ALIAS, CANONICAL], totalDocs: 2 })

    const res = await searchRequest('rohan')

    expect(res.body.results).toHaveLength(1)
    expect(res.body.results[0]).toEqual(
      expect.objectContaining({
        customerId: '23D47AB2',
        matchedFormerRecord: null,
        emailAddress: 'rohansharp+6@gmail.com',
        accountCount: 1,
      }),
    )
  })

  it('leaves a live customer untouched', async () => {
    mockFind.mockResolvedValue({ docs: [CANONICAL], totalDocs: 1 })

    const res = await searchRequest('rohan')

    expect(res.body.results[0]).toEqual(
      expect.objectContaining({ customerId: '23D47AB2', matchedFormerRecord: null }),
    )
  })
})
