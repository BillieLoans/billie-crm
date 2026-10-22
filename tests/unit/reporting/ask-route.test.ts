/**
 * Unit tests for POST /api/reports/ask (BTB-508): authors only, the three
 * modes, input limits and error mapping. The flow itself is mocked here and
 * covered in tests/int/report-ask.int.spec.ts.
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
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
const auth = vi.fn()
vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({ auth })) }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class RateLimitError extends APIError {}
  return { default: { APIError, RateLimitError } }
})
const draftFromQuestion = vi.fn()
const checkEditedDefinition = vi.fn()
vi.mock('@/server/reporting/ask/draft', () => ({
  draftFromQuestion: (...a: unknown[]) => draftFromQuestion(...a),
  checkEditedDefinition: (...a: unknown[]) => checkEditedDefinition(...a),
}))

import Anthropic from '@anthropic-ai/sdk'
import { POST } from '@/app/api/reports/ask/route'
import { AskUnavailableError } from '@/server/reporting/ask/claude'

type Res = { status: number; body: Record<string, unknown> }
const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
const DEF = { title: 't', description: '', sql: 'SELECT 1', parameters: [], chart: null }

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ user: { id: 'u', role: 'supervisor' } })
  draftFromQuestion.mockReset().mockResolvedValue({ status: 'ok', issues: [], assumptions: [] })
  checkEditedDefinition.mockReset().mockResolvedValue({ status: 'ok', issues: [], assumptions: [] })
})

describe('POST /api/reports/ask', () => {
  test('401 signed out, 403 for anyone who is not a report author', async () => {
    auth.mockResolvedValue({ user: null })
    expect(((await POST(req({ mode: 'ask', question: 'q' }))) as unknown as Res).status).toBe(401)
    for (const role of ['operations', 'readonly', 'marketing', 'service']) {
      auth.mockResolvedValue({ user: { id: 'u', role } })
      expect(((await POST(req({ mode: 'ask', question: 'q' }))) as unknown as Res).status).toBe(403)
    }
    expect(draftFromQuestion).not.toHaveBeenCalled()
  })

  test('asks, refines and checks', async () => {
    await POST(req({ mode: 'ask', question: '  How many?  ' }))
    expect(draftFromQuestion.mock.calls[0][2]).toEqual({ question: 'How many?' })

    await POST(
      req({
        mode: 'refine',
        question: 'q',
        definition: DEF,
        refinement: 'weekly',
        issues: ['x', 3],
      }),
    )
    expect(draftFromQuestion.mock.calls[1][2]).toEqual({
      question: 'q',
      previous: { definition: DEF, refinement: 'weekly', issues: ['x'] },
    })

    await POST(req({ mode: 'check', question: 'q', definition: DEF }))
    expect(checkEditedDefinition).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'q',
      DEF,
    )
  })

  test('400 for a missing question, definition, refinement or mode, and caps long text', async () => {
    const statuses = await Promise.all(
      [
        { mode: 'ask', question: ' ' },
        { mode: 'check', question: 'q' },
        { mode: 'refine', question: 'q', definition: DEF, refinement: '' },
        { mode: 'other', question: 'q', definition: DEF },
      ].map(async (b) => ((await POST(req(b))) as unknown as Res).status),
    )
    expect(statuses).toEqual([400, 400, 400, 400])
    await POST(req({ mode: 'ask', question: 'x'.repeat(5000) }))
    expect((draftFromQuestion.mock.calls[0][2] as { question: string }).question).toHaveLength(2000)
  })

  test('maps an unconfigured key, rate limits and API failures', async () => {
    draftFromQuestion.mockRejectedValueOnce(new AskUnavailableError('not configured'))
    expect(((await POST(req({ mode: 'ask', question: 'q' }))) as unknown as Res).status).toBe(503)
    draftFromQuestion.mockRejectedValueOnce(
      new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers()),
    )
    expect(((await POST(req({ mode: 'ask', question: 'q' }))) as unknown as Res).status).toBe(429)
    draftFromQuestion.mockRejectedValueOnce(
      new Anthropic.APIError(500, undefined, 'boom', new Headers()),
    )
    expect(((await POST(req({ mode: 'ask', question: 'q' }))) as unknown as Res).status).toBe(502)
  })
})
