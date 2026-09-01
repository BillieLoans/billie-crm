/**
 * Unit tests for POST /api/commands/conversation-kill — the customer_request
 * block guard (spec: 2026-08-28 cancellation projection).
 *
 * A customer asking to cancel must never be blocked from re-applying. The
 * reapplicationBlock service raises a MANUAL_ADMIN block purely on the
 * block_requested boolean, so the route must reject the combination.
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

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    user: { id: 'sup-1', role: 'supervisor', email: 'sup@x' },
  }),
}))

vi.mock('@/server/chatledger-publisher', () => ({
  publishConversationKill: vi.fn().mockResolvedValue({ eventId: 'evt-kill-1' }),
}))

import { POST } from '@/app/api/commands/conversation-kill/route'
import { publishConversationKill } from '@/server/chatledger-publisher'

const request = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as Parameters<typeof POST>[0]

const BASE = {
  conversationId: 'conv-001',
  customerId: 'B81FC35E',
  applicationNumber: 'APP-001',
}

describe('POST /api/commands/conversation-kill customer_request guard', () => {
  beforeEach(() => {
    vi.mocked(publishConversationKill).mockClear()
  })

  it('rejects a customer_request kill that also asks for a block', async () => {
    const res = (await POST(
      request({ ...BASE, reasonCategory: 'customer_request', blockRequested: true }),
    )) as unknown as { status: number; body: { error?: { code: string } } }
    expect(res.status).toBe(400)
    expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    expect(publishConversationKill).not.toHaveBeenCalled()
  })

  it('accepts a customer_request kill without a block', async () => {
    const res = (await POST(
      request({ ...BASE, reasonCategory: 'customer_request' }),
    )) as unknown as { status: number }
    expect(res.status).toBe(202)
    expect(publishConversationKill).toHaveBeenCalledTimes(1)
    expect(vi.mocked(publishConversationKill).mock.calls[0][0]).toMatchObject({
      reason_category: 'customer_request',
      block_requested: false,
    })
  })

  it('still accepts a fraud_abuse kill with a block', async () => {
    const res = (await POST(
      request({ ...BASE, reasonCategory: 'fraud_abuse', blockRequested: true }),
    )) as unknown as { status: number }
    expect(res.status).toBe(202)
    expect(vi.mocked(publishConversationKill).mock.calls[0][0]).toMatchObject({
      reason_category: 'fraud_abuse',
      block_requested: true,
    })
  })
})
