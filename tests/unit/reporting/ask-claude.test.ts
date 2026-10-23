/**
 * Unit tests for the Claude request behind Ask Claude (BTB-508). The SDK is
 * mocked: these check what is sent, and how answers, refusals and unusable
 * output are handled. No network.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

const create = vi.fn()
const stream = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class RateLimitError extends APIError {}
  class Anthropic {
    static APIError = APIError
    static RateLimitError = RateLimitError
    beta = { messages: { create, stream } }
  }
  return { default: Anthropic }
})

import {
  ASK_MODEL,
  AskUnavailableError,
  askClaude,
  toDraftDefinition,
  type AskOutput,
} from '@/server/reporting/ask/claude'
import { SCHEMA_DESCRIPTION_VERSION } from '@/server/reporting/schema-description'

const OUTPUT: AskOutput = {
  answerable: true,
  not_answerable_reason: null,
  title: 'Approvals by day',
  plan: ['Count approved decisions per Sydney day', 'Leave out mock decisions'],
  assumptions: ['Days are Sydney days'],
  description: 'Approved decisions per Sydney day.',
  category: 'credit',
  sql: 'SELECT decided_on, count(*) AS approved FROM decision WHERE decided_on >= $1::date AND decision = $2 AND NOT mock_origin GROUP BY 1',
  parameters: [
    {
      name: 'from',
      label: 'From',
      type: 'date',
      required: true,
      default: 'today-30',
      options: null,
      help: null,
    },
    {
      name: 'outcome',
      label: 'Outcome',
      type: 'select',
      required: true,
      default: 'APPROVED',
      options: [{ value: 'APPROVED', label: 'Approved' }],
      help: 'Which decisions',
    },
  ],
  charts: [
    {
      type: 'bar',
      x: 'decided_on',
      series: [{ column: 'approved', label: 'Approved' }],
      stacked: false,
    },
  ],
  headline: [
    {
      column: 'approved',
      label: 'Approved',
      value: 'sum',
      numerator: null,
      denominator: null,
      better: 'higher',
    },
  ],
  columns: [
    {
      name: 'approved',
      label: null,
      description: 'Approved decisions',
      base: null,
      better: 'neutral',
    },
  ],
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    model: ASK_MODEL,
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 4000,
      output_tokens: 800,
      cache_read_input_tokens: 3500,
      cache_creation_input_tokens: 0,
    },
    content: [{ type: 'text', text: JSON.stringify(OUTPUT) }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  create.mockReset().mockResolvedValue(response())
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('askClaude', () => {
  test('sends the schema description and the question, with fallbacks and structured output', async () => {
    const result = await askClaude({ question: 'Approvals per day this month?' })
    expect(result.status).toBe('ok')
    const [params] = create.mock.calls[0]
    expect(params.model).toBe('claude-opus-5-5')
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01'])
    expect(params.fallbacks).toBe('default')
    expect(params.output_config.effort).toBe('high')
    expect(params.output_config.format.type).toBe('json_schema')
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect(params.system[0].text).toContain(SCHEMA_DESCRIPTION_VERSION)
    expect(params.system[0].text).toContain('## decision (view)')
    expect(params.messages).toEqual([
      { role: 'user', content: 'Question: Approvals per day this month?' },
    ])
    expect(params).not.toHaveProperty('thinking')
    // Answered in one piece, it must finish inside Cloudflare's 100 seconds.
    expect(create.mock.calls[0][1]).toEqual({ signal: undefined, timeout: 85_000 })
  })

  test('a refinement sends the previous draft and the problems, never result rows', async () => {
    await askClaude({
      question: 'Approvals per day',
      previous: {
        definition: toDraftDefinition(OUTPUT),
        refinement: 'Only weekdays',
        issues: [
          { code: 'MOCK', message: 'Mock decisions are not excluded' },
          { code: 'RATE_RANGE', message: 'decline_rate must be between 0 and 1; got 45.2' },
          { code: 'RUN', message: 'The query failed (column "x" does not exist)' },
        ],
      },
    })
    const content = create.mock.calls[0][0].messages[0].content as string
    expect(content).toContain('Change requested: Only weekdays')
    expect(content).toContain('Mock decisions are not excluded')
    expect(content).toContain('"title": "Approvals by day"')
    // Result values and database error text stay out.
    expect(content).toContain('fell outside 0–1')
    expect(content).not.toContain('45.2')
    expect(content).not.toContain('does not exist')
  })

  test('records tokens, cache use, latency and versions', async () => {
    const result = await askClaude({ question: 'q' })
    expect(result.usage).toMatchObject({
      model: 'claude-opus-5-5',
      effort: 'high',
      promptVersion: 'ask-v2',
      schemaVersion: SCHEMA_DESCRIPTION_VERSION,
      inputTokens: 4000,
      outputTokens: 800,
      cacheReadTokens: 3500,
      cacheWriteTokens: 0,
    })
    expect(result.usage.latencyMs).toBeGreaterThanOrEqual(0)
  })

  test('a refusal, a cut-off answer and unusable text are reported with usage, not thrown', async () => {
    create.mockResolvedValueOnce(
      response({ stop_reason: 'refusal', content: [{ type: 'text', text: 'I can' }] }),
    )
    expect((await askClaude({ question: 'q' })).status).toBe('refused')
    create.mockResolvedValueOnce(
      response({
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '{"answerable": tr' }],
      }),
    )
    const cut = await askClaude({ question: 'q' })
    expect(cut).toMatchObject({
      status: 'invalid_output',
      message: expect.stringMatching(/cut off/),
      usage: { outputTokens: 800 },
    })
    create.mockResolvedValueOnce(
      response({ content: [{ type: 'text', text: JSON.stringify({ answerable: true }) }] }),
    )
    expect((await askClaude({ question: 'q' })).status).toBe('invalid_output')
  })

  test('a refinement thinks less hard than a first draft', async () => {
    await askClaude({
      question: 'q',
      previous: { definition: toDraftDefinition(OUTPUT), refinement: 'Monthly' },
    })
    expect(create.mock.calls[0][0].output_config.effort).toBe('medium')
    create.mockClear()
    await askClaude({ question: 'q' }, { effort: 'low', model: 'claude-sonnet-5-5' })
    expect(create.mock.calls[0][0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      output_config: { effort: 'low' },
    })
  })

  test('streams: passes each text snapshot on, and records the time to the first', async () => {
    const handlers: Record<string, (delta: string, snapshot: string) => void> = {}
    const signal = new AbortController().signal
    stream.mockReturnValue({
      on: (event: string, handler: (delta: string, snapshot: string) => void) => {
        handlers[event] = handler
      },
      finalMessage: async () => {
        handlers.text?.('{"answ', '{"answ')
        handlers.text?.('erable', '{"answerable')
        return response()
      },
    })
    const snapshots: string[] = []
    const result = await askClaude({ question: 'q' }, { onText: (t) => snapshots.push(t), signal })
    expect(result.status).toBe('ok')
    expect(snapshots).toEqual(['{"answ', '{"answerable'])
    expect(result.usage.firstOutputMs).toBeGreaterThanOrEqual(0)
    expect(stream.mock.calls[0][1]).toEqual({ signal, timeout: 150_000 })
    expect(create).not.toHaveBeenCalled()
  })

  test('without an API key it says Ask Claude is not configured', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    await expect(askClaude({ question: 'q' })).rejects.toBeInstanceOf(AskUnavailableError)
    expect(create).not.toHaveBeenCalled()
  })
})

describe('toDraftDefinition', () => {
  test('converts Claude’s answer to a report definition', () => {
    expect(toDraftDefinition(OUTPUT)).toEqual({
      title: 'Approvals by day',
      description: 'Approved decisions per Sydney day.',
      sql: OUTPUT.sql,
      parameters: [
        { name: 'from', label: 'From', type: 'date', required: true, default: 'today-30' },
        {
          name: 'outcome',
          label: 'Outcome',
          type: 'select',
          required: true,
          default: 'APPROVED',
          options: [{ value: 'APPROVED', label: 'Approved' }],
          help: 'Which decisions',
        },
      ],
      category: 'credit',
      chart: [
        { type: 'bar', x: 'decided_on', series: [{ column: 'approved', label: 'Approved' }] },
      ],
      headline: [{ column: 'approved', label: 'Approved', value: 'sum', better: 'higher' }],
      columnSettings: [{ name: 'approved', description: 'Approved decisions' }],
    })
  })

  test('cleans presentation rather than rejecting the draft', () => {
    const def = toDraftDefinition({
      ...OUTPUT,
      headline: [
        {
          column: 'a',
          label: 'Rate',
          value: 'ratio',
          numerator: null,
          denominator: 'n',
          better: 'higher',
        },
        {
          column: 'b',
          label: '  ',
          value: 'sum',
          numerator: null,
          denominator: null,
          better: 'neutral',
        },
      ],
      columns: [
        {
          name: 'a',
          label: 'x'.repeat(80),
          description: 'y'.repeat(400),
          base: null,
          better: 'neutral',
        },
      ],
    })
    expect(def.headline).toEqual([{ column: 'a', label: 'Rate', value: 'total', better: 'higher' }])
    const [col] = def.columnSettings as Array<{ label: string; description: string }>
    expect(col.label).toHaveLength(60)
    expect(col.description).toHaveLength(300)
  })

  test('a ratio headline keeps its numerator and denominator', () => {
    const def = toDraftDefinition({
      ...OUTPUT,
      headline: [
        {
          column: 'approval_rate',
          label: 'Approval rate',
          value: 'ratio',
          numerator: 'approved',
          denominator: 'decided',
          better: 'higher',
        },
      ],
    })
    expect(def.headline).toEqual([
      {
        column: 'approval_rate',
        label: 'Approval rate',
        value: 'ratio',
        numerator: 'approved',
        denominator: 'decided',
        better: 'higher',
      },
    ])
  })

  test('numbers and booleans become typed defaults', () => {
    const def = toDraftDefinition({
      ...OUTPUT,
      parameters: [
        {
          name: 'n',
          label: 'N',
          type: 'integer',
          required: false,
          default: '10',
          options: null,
          help: null,
        },
        {
          name: 'b',
          label: 'B',
          type: 'boolean',
          required: false,
          default: 'true',
          options: null,
          help: null,
        },
      ],
      charts: [],
    })
    expect(def.parameters).toEqual([
      { name: 'n', label: 'N', type: 'integer', required: false, default: 10 },
      { name: 'b', label: 'B', type: 'boolean', required: false, default: true },
    ])
    expect(def.chart).toBeNull()
  })
})
