/**
 * Unit tests for GET /api/conversations/:conversationId — LLM cost roll-up authz.
 *
 * Regression guard (BTB-302): the roll-up fields summarise the `llm-costs`
 * collection, whose read rule is supervisor/admin. This route serves every
 * lending role, so the fields must be omitted for operations/readonly rather
 * than shipped in the JSON and merely hidden by the UI.
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

const CONVERSATION_DOC = {
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
})
