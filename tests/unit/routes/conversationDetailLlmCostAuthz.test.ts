/**
 * Unit tests for GET /api/conversations/:conversationId — LLM cost roll-up authz.
 *
 * Regression guard (BTB-302): the roll-up fields summarise the `llm-costs`
 * collection, whose read rule is supervisor/admin. This route serves every
 * lending role, so the fields must be omitted for operations/readonly rather
 * than shipped in the JSON and merely hidden by the UI.
 *
 * Also pins the route's response contract: the exact top-level key sets served
 * to the base audience and to supervisors. The route reads via the Local API,
 * which bypasses collection access, so nothing else forces an author adding a
 * field to decide who may see it — this test does.
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

const CONVERSATION_DOC: Record<string, unknown> = {
  conversationId: 'conv-001',
  applicationNumber: 'APP-001',
  status: 'active',
  startedAt: '2026-08-27T10:00:00.000Z',
  updatedAt: '2026-08-27T10:30:00.000Z',
  llmCostTotalUsd: 0.0225,
  llmCallCount: 9,
  llmUnpricedCount: 1,
}

const mockUser = vi.hoisted(() => ({ current: { id: 'u-1', role: 'admin' } as { id: string; role: string } }))
const mockFind = vi.hoisted(() =>
  vi.fn().mockImplementation(async ({ collection }: { collection: string }) =>
    collection === 'conversations' ? { docs: [CONVERSATION_DOC] } : { docs: [] },
  ),
)

vi.mock('payload', () => ({
  getPayload: vi.fn().mockImplementation(async () => ({
    find: mockFind,
    auth: vi.fn().mockImplementation(async () => ({ user: mockUser.current })),
  })),
}))

vi.mock('@payload-config', () => ({ default: {} }))

import { GET } from '@/app/api/conversations/[conversationId]/route'
import type { NextRequest } from 'next/server'

const ROLLUP_FIELDS = ['llmCostTotalUsd', 'llmCallCount', 'llmUnpricedCount'] as const

const callRoute = async (role: string) => {
  mockUser.current = { id: 'u-1', role }
  const res = (await GET({} as unknown as NextRequest, {
    params: Promise.resolve({ conversationId: 'conv-001' }),
  })) as unknown as { status: number; body: { conversation?: Record<string, unknown> } }
  return res
}

describe('GET /api/conversations/:conversationId — LLM cost roll-up authz', () => {
  beforeEach(() => {
    mockFind.mockClear()
  })

  it.each(['admin', 'supervisor'])('includes the roll-up for %s', async (role) => {
    const res = await callRoute(role)
    expect(res.status).toBe(200)
    const conversation = res.body.conversation!
    expect(conversation.llmCostTotalUsd).toBe(0.0225)
    expect(conversation.llmCallCount).toBe(9)
    expect(conversation.llmUnpricedCount).toBe(1)
  })

  it.each(['operations', 'readonly'])(
    'omits the roll-up entirely for %s — not merely nulls it',
    async (role) => {
      const res = await callRoute(role)
      expect(res.status).toBe(200)
      const conversation = res.body.conversation!
      for (const field of ROLLUP_FIELDS) {
        expect(Object.prototype.hasOwnProperty.call(conversation, field)).toBe(false)
      }
    },
  )

  it('still serves the rest of the conversation to non-privileged roles', async () => {
    const res = await callRoute('operations')
    expect(res.status).toBe(200)
    expect(res.body.conversation!.conversationId).toBe('conv-001')
    expect(res.body.conversation!.applicationNumber).toBe('APP-001')
  })

  it('rejects a role with no lending access outright', async () => {
    const res = await callRoute('marketing')
    expect(res.status).toBe(403)
  })

  it('serves cancellationRecord to every lending role (spec: 2026-08-28 cancellation projection)', async () => {
    CONVERSATION_DOC.cancellationRecord = {
      reason: 'final_offer_declined',
      category: 'customer_declined',
      cancelled_at: '2026-08-28T01:37:30.993832+00:00',
      source_event: 'customer_cancelled',
      application_number: 'C6F7C8E6-77F',
    }
    try {
      const res = await callRoute('operations')
      expect(res.status).toBe(200)
      expect(res.body.conversation!.cancellationRecord).toMatchObject({
        reason: 'final_offer_declined',
        category: 'customer_declined',
      })
    } finally {
      delete CONVERSATION_DOC.cancellationRecord
    }
  })

  it('serves cancellationRecord as null when the conversation was never cancelled', async () => {
    const res = await callRoute('operations')
    expect(res.status).toBe(200)
    expect(res.body.conversation!.cancellationRecord).toBeNull()
  })
})

/**
 * The top-level keys every lending role receives. If adding a field made this
 * fail, decide its audience FIRST: a field readable by all lending roles goes
 * in the route's base object and gets added here; a field whose source is
 * supervisor/admin-classified goes in the route's `supervisorOnlyFields`
 * block and in SUPERVISOR_ONLY_KEYS below. Do not extend this list to make
 * the test pass without making that call.
 */
const BASE_KEYS = [
  'application',
  'applicationNumber',
  'assessments',
  'cancellationRecord',
  'conversationId',
  'customer',
  'decisionDetail',
  'decisionStatus',
  'finalDecision',
  'identityVerificationReport',
  'killRecord',
  'lastMessageAt',
  'messageCount',
  'noticeboard',
  'reapplicationBlock',
  'sourceConversationId',
  'startedAt',
  'statementCapture',
  'status',
  'summary',
  'updatedAt',
  'utterances',
].sort()

const SUPERVISOR_ONLY_KEYS = ['llmCallCount', 'llmCostTotalUsd', 'llmUnpricedCount'].sort()

describe('GET /api/conversations/:conversationId — response contract', () => {
  it.each(['operations', 'readonly'])('serves exactly the base key set to %s', async (role) => {
    const res = await callRoute(role)
    expect(res.status).toBe(200)
    expect(Object.keys(res.body.conversation!).sort()).toEqual(BASE_KEYS)
  })

  it.each(['admin', 'supervisor'])(
    'serves the base keys plus the supervisor-only keys to %s',
    async (role) => {
      const res = await callRoute(role)
      expect(res.status).toBe(200)
      expect(Object.keys(res.body.conversation!).sort()).toEqual(
        [...BASE_KEYS, ...SUPERVISOR_ONLY_KEYS].sort(),
      )
    },
  )
})
