/**
 * Unit tests for POST /api/reports/ask (BTB-508): who can ask, the daily
 * limit for staff who are not authors, the three modes, input limits,
 * error mapping and the streamed answer. The flow itself is mocked here and
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
const count = vi.fn()
const requireAuth = vi.fn()
const loadOwnAsk = vi.fn()
vi.mock('@/lib/auth', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }))
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class RateLimitError extends APIError {}
  class APIUserAbortError extends APIError {}
  return { default: { APIError, RateLimitError, APIUserAbortError } }
})
const draftFromQuestion = vi.fn()
const checkEditedDefinition = vi.fn()
vi.mock('@/server/reporting/ask/draft', async () => ({
  ...(await vi.importActual<typeof import('@/server/reporting/ask/draft')>(
    '@/server/reporting/ask/draft',
  )),
  draftFromQuestion: (...a: unknown[]) => draftFromQuestion(...a),
  checkEditedDefinition: (...a: unknown[]) => checkEditedDefinition(...a),
  loadOwnAsk: (...a: unknown[]) => loadOwnAsk(...a),
}))

import Anthropic from '@anthropic-ai/sdk'
import { ASK_DAILY_LIMIT, POST } from '@/app/api/reports/ask/route'
import { AskUnavailableError } from '@/server/reporting/ask/claude'

type Res = { status: number; body: Record<string, unknown> }
const req = (body: unknown) =>
  ({ json: async () => body, signal: new AbortController().signal }) as unknown as NextRequest
const DEF = { title: 't', description: '', sql: 'SELECT 1', parameters: [], chart: null }
const DEF_PARSED = { ...DEF, headline: [], columnSettings: [], category: 'other' }

function signedIn(role: string) {
  requireAuth.mockResolvedValue({ user: { id: 'u', role }, payload: { count } })
}

beforeEach(() => {
  signedIn('supervisor')
  count.mockReset().mockResolvedValue({ totalDocs: 0 })
  loadOwnAsk.mockReset().mockResolvedValue(null)
  draftFromQuestion
    .mockReset()
    .mockResolvedValue({ status: 'ok', issues: [], plan: [], assumptions: [] })
  checkEditedDefinition
    .mockReset()
    .mockResolvedValue({ status: 'ok', issues: [], plan: [], assumptions: [] })
})

describe('POST /api/reports/ask', () => {
  test('any staff role can ask; signed-out and non-staff are refused by requireAuth', async () => {
    requireAuth.mockResolvedValue({ error: { status: 401 } })
    expect(((await POST(req({ mode: 'ask', question: 'q' }))) as unknown as Res).status).toBe(401)
    signedIn('operations')
    expect(((await POST(req({ mode: 'ask', question: 'q' }))) as unknown as Res).status).toBe(200)
  })

  test(`limits staff who are not authors to ${ASK_DAILY_LIMIT} asks a day, and authors not at all`, async () => {
    count.mockResolvedValue({ totalDocs: ASK_DAILY_LIMIT })
    signedIn('readonly')
    const res = (await POST(req({ mode: 'ask', question: 'q' }))) as unknown as Res
    expect(res.status).toBe(429)
    expect((res.body.error as { code: string }).code).toBe('DAILY_LIMIT')
    // A check makes no Claude call, so it is never limited.
    loadOwnAsk.mockResolvedValue({ question: 'q', definition: DEF_PARSED })
    expect(
      ((await POST(req({ mode: 'check', question: 'q', askId: 'a1' }))) as unknown as Res).status,
    ).toBe(200)
    signedIn('supervisor')
    expect(((await POST(req({ mode: 'ask', question: 'q' }))) as unknown as Res).status).toBe(200)
  })

  test('staff who are not authors can only check or refine a definition Claude gave them', async () => {
    signedIn('operations')
    const own = { ...DEF_PARSED, sql: 'SELECT 2' }
    // Without an askId, their own SQL is refused.
    const res = (await POST(
      req({ mode: 'check', question: 'q', definition: { ...DEF, sql: 'SELECT * FROM customer' } }),
    )) as unknown as Res
    expect(res.status).toBe(400)
    expect(checkEditedDefinition).not.toHaveBeenCalled()
    // With one, the stored definition is used, whatever the body says.
    loadOwnAsk.mockResolvedValue({ question: 'q', definition: own })
    await POST(
      req({
        mode: 'refine',
        question: 'q',
        askId: 'a1',
        definition: { ...DEF, sql: 'SELECT * FROM customer' },
        refinement: 'weekly',
      }),
    )
    expect(loadOwnAsk).toHaveBeenCalledWith(expect.anything(), 'u', 'a1')
    expect(draftFromQuestion.mock.calls[0][2].previous.definition).toEqual(own)
  })

  test('lets a non-author have one draft in progress at a time', async () => {
    signedIn('readonly')
    let finish: (v: unknown) => void = () => undefined
    draftFromQuestion.mockReturnValueOnce(new Promise((r) => (finish = r)))
    const first = POST(req({ mode: 'ask', question: 'q' }))
    await new Promise((r) => setTimeout(r, 0))
    const second = (await POST(req({ mode: 'ask', question: 'q' }))) as unknown as Res
    expect(second.status).toBe(429)
    expect((second.body.error as { code: string }).code).toBe('IN_PROGRESS')
    finish({ status: 'ok', issues: [], plan: [], assumptions: [] })
    expect(((await first) as unknown as Res).status).toBe(200)
    // Released once it finished.
    expect(((await POST(req({ mode: 'ask', question: 'q' }))) as unknown as Res).status).toBe(200)
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
        issues: [{ code: 'MOCK', message: 'x' }, 'not an issue', { code: 3 }],
      }),
    )
    expect(draftFromQuestion.mock.calls[1][2]).toEqual({
      question: 'q',
      previous: {
        definition: DEF_PARSED,
        refinement: 'weekly',
        issues: [{ code: 'MOCK', message: 'x' }],
      },
    })

    await POST(req({ mode: 'check', question: 'q', definition: DEF }))
    expect(checkEditedDefinition).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'q',
      DEF_PARSED,
    )
  })

  test('400 for a missing question, definition, refinement or mode, and caps long text', async () => {
    const statuses = await Promise.all(
      [
        { mode: 'ask', question: ' ' },
        { mode: 'check', question: 'q' },
        { mode: 'refine', question: 'q', definition: DEF, refinement: '' },
        { mode: 'other', question: 'q', definition: DEF },
        // Everything in a definition can reach Claude, so it is size-bounded.
        { mode: 'check', question: 'q', definition: { ...DEF, sql: 'x'.repeat(20_001) } },
        { mode: 'check', question: 'q', definition: { ...DEF, parameters: ['x'.repeat(10_001)] } },
        { mode: 'check', question: 'q', definition: { ...DEF, headline: ['x'.repeat(2_001)] } },
      ].map(async (b) => ((await POST(req(b))) as unknown as Res).status),
    )
    expect(statuses).toEqual([400, 400, 400, 400, 400, 400, 400])
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

  test('streams the stages, the plan and the result as server-sent events', async () => {
    draftFromQuestion.mockImplementation(
      async (
        _p: unknown,
        _u: unknown,
        _r: unknown,
        _o: unknown,
        stream: { onProgress: (e: unknown) => void; signal: AbortSignal },
      ) => {
        expect(stream.signal).toBeInstanceOf(AbortSignal)
        stream.onProgress({ type: 'stage', stage: 'planning', atMs: 0 })
        stream.onProgress({
          type: 'partial',
          draft: { title: 'T', plan: ['a'], assumptions: [], writingSql: false },
        })
        return { status: 'ok', issues: [], plan: ['a'], assumptions: [] }
      },
    )
    const res = (await POST(req({ mode: 'ask', question: 'q', stream: true }))) as Response
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('event: stage\ndata: {"type":"stage","stage":"planning","atMs":0}')
    expect(text).toContain('event: partial')
    expect(text).toContain('event: result\ndata: {"status":"ok"')
  })

  test('a streamed failure ends with an error event', async () => {
    draftFromQuestion.mockRejectedValueOnce(new AskUnavailableError('not configured'))
    const res = (await POST(req({ mode: 'ask', question: 'q', stream: true }))) as Response
    expect(await res.text()).toContain(
      'event: error\ndata: {"error":{"code":"UNAVAILABLE","message":"not configured"}}',
    )
  })
})
