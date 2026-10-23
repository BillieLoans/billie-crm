/**
 * Unit tests for the Claude request behind Ask Claude (BTB-508). The SDK is
 * mocked: these check what is sent, and how answers, refusals and unusable
 * output are handled. No network.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

const create = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class RateLimitError extends APIError {}
  class Anthropic {
    static APIError = APIError
    static RateLimitError = RateLimitError
    beta = { messages: { create } }
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
  description: 'Approved decisions per Sydney day.',
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
  chart: {
    type: 'bar',
    x: 'decided_on',
    series: [{ column: 'approved', label: 'Approved' }],
    stacked: false,
  },
  assumptions: ['Days are Sydney days'],
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
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(params.system[0].text).toContain(SCHEMA_DESCRIPTION_VERSION)
    expect(params.system[0].text).toContain('## decision (view)')
    expect(params.messages).toEqual([
      { role: 'user', content: 'Question: Approvals per day this month?' },
    ])
    expect(params).not.toHaveProperty('thinking')
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
      promptVersion: 'ask-v1',
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
      chart: { type: 'bar', x: 'decided_on', series: [{ column: 'approved', label: 'Approved' }] },
    })
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
      chart: null,
    })
    expect(def.parameters).toEqual([
      { name: 'n', label: 'N', type: 'integer', required: false, default: 10 },
      { name: 'b', label: 'B', type: 'boolean', required: false, default: true },
    ])
    expect(def.chart).toBeNull()
  })
})
