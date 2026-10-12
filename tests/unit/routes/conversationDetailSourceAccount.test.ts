/**
 * Unit tests for GET /api/conversations/:conversationId — source account
 * number resolution on a re-application block.
 *
 * ACTIVE_LOAN blocks reference the open loan by its ledger account id (GUID).
 * The route resolves the human-readable `accountNumber` from `loan-accounts`
 * so the banner can show it, keeping the id on the record for the deep-link.
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

const SOURCE_ACCOUNT_ID = 'b69f392d-642a-4a41-a8d0-875ec908cb5f'

const conversationDoc = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))

const mockFind = vi.hoisted(() =>
  vi
    .fn()
    .mockImplementation(async ({ collection, where }: { collection: string; where: unknown }) => {
      if (collection === 'conversations') return { docs: [conversationDoc.current] }
      if (collection === 'loan-accounts') {
        const w = where as { loanAccountId?: { equals?: string } }
        return w.loanAccountId?.equals === 'b69f392d-642a-4a41-a8d0-875ec908cb5f'
          ? { docs: [{ accountNumber: 'GK4X5BZN5JTB' }] }
          : { docs: [] }
      }
      return { docs: [] }
    }),
)

vi.mock('payload', () => ({
  getPayload: vi.fn().mockImplementation(async () => ({
    find: mockFind,
    auth: vi.fn().mockImplementation(async () => ({ user: { id: 'u-1', role: 'admin' } })),
  })),
}))

vi.mock('@payload-config', () => ({ default: {} }))

import { GET } from '@/app/api/conversations/[conversationId]/route'
import type { NextRequest } from 'next/server'

const callRoute = async () =>
  (await GET({} as unknown as NextRequest, {
    params: Promise.resolve({ conversationId: 'conv-001' }),
  })) as unknown as { status: number; body: { conversation: Record<string, unknown> } }

const baseDoc = {
  conversationId: 'conv-001',
  applicationNumber: 'APP-001',
  status: 'active',
  startedAt: '2026-10-12T23:06:45.863Z',
  updatedAt: '2026-10-12T23:07:09.926Z',
}

describe('GET /api/conversations/:conversationId — source account number', () => {
  beforeEach(() => {
    mockFind.mockClear()
  })

  it('resolves the human-readable number for the block source account', async () => {
    conversationDoc.current = {
      ...baseDoc,
      reapplicationBlock: { reason: 'ACTIVE_LOAN', sourceAccountId: SOURCE_ACCOUNT_ID },
    }
    const res = await callRoute()
    expect(res.status).toBe(200)
    const block = res.body.conversation.reapplicationBlock as Record<string, unknown>
    expect(block.sourceAccountId).toBe(SOURCE_ACCOUNT_ID)
    expect(block.sourceAccountNumber).toBe('GK4X5BZN5JTB')
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'loan-accounts',
        where: { loanAccountId: { equals: SOURCE_ACCOUNT_ID } },
      }),
    )
  })

  it('returns null when the account is not projected in the CRM', async () => {
    conversationDoc.current = {
      ...baseDoc,
      reapplicationBlock: { reason: 'ACTIVE_LOAN', sourceAccountId: 'unknown-account' },
    }
    const res = await callRoute()
    const block = res.body.conversation.reapplicationBlock as Record<string, unknown>
    expect(block.sourceAccountNumber).toBeNull()
  })

  it('does not query loan-accounts when the block has no source account', async () => {
    conversationDoc.current = {
      ...baseDoc,
      reapplicationBlock: { reason: 'PEP', sourceAccountId: null },
    }
    const res = await callRoute()
    const block = res.body.conversation.reapplicationBlock as Record<string, unknown>
    expect(block.sourceAccountNumber).toBeNull()
    expect(mockFind.mock.calls.some(([arg]) => arg.collection === 'loan-accounts')).toBe(false)
  })

  it('leaves a null block alone', async () => {
    conversationDoc.current = { ...baseDoc, reapplicationBlock: null }
    const res = await callRoute()
    expect(res.body.conversation.reapplicationBlock).toBeNull()
  })
})
