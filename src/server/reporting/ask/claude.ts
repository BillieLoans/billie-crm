/**
 * Drafting a report definition with Claude (BTB-508).
 *
 * Sends the reporting schema description and the question, never result
 * rows. The response is a structured output whose schema is a report
 * definition, so it parses or fails; it is then checked by `validate.ts` and
 * run by the BTB-506 runner like any other report.
 *
 * Model and settings are recorded on every request (see `report-asks`), so
 * the R&D benchmark and live usage can be compared.
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { renderSchemaDescription, SCHEMA_DESCRIPTION_VERSION } from '../schema-description'
import type { DraftDefinition } from './validate'

export const ASK_MODEL = 'claude-opus-5-5'
/** First drafts think hardest. */
export const ASK_EFFORT = 'high' as const
/** A refinement starts from a working definition, so it needs less. */
export const ASK_REFINE_EFFORT = 'medium' as const
export type AskEffort = 'low' | 'medium' | 'high'
export const ASK_PROMPT_VERSION = 'ask-v2'
/**
 * The CRM sits behind Cloudflare, which gives up on a silent origin after
 * 100 seconds: a draft answered in one piece must finish inside that, or it
 * is paid for and never seen. A streamed draft keeps the connection busy
 * (with a heartbeat while Claude thinks), so it may take longer.
 */
export const ASK_TIMEOUT_MS = 85_000
export const ASK_STREAM_TIMEOUT_MS = 150_000

const AskParameterSchema = z.object({
  name: z.string().describe('lower_snake_case; the SQL reads parameter N as $N, in list order'),
  label: z.string().describe('Short label staff see on the form'),
  type: z.enum(['date', 'text', 'integer', 'number', 'select', 'boolean']),
  required: z.boolean(),
  default: z
    .string()
    .nullable()
    .describe('Dates: today, today-N or YYYY-MM-DD (Sydney). Others as text. null for none.'),
  options: z
    .array(z.object({ value: z.string(), label: z.string() }))
    .nullable()
    .describe('Required for select; null otherwise'),
  help: z.string().nullable(),
})

const AskChartSchema = z.object({
  type: z
    .enum(['line', 'bar', 'area', 'bar-horizontal', 'stacked-100'])
    .describe(
      'line or area for a measure over time; bar-horizontal to rank categories; bar for a few categories; stacked-100 for the mix within each category',
    ),
  x: z.string().describe('Result column on the category or time axis'),
  series: z
    .array(z.object({ column: z.string(), label: z.string() }))
    .describe('1 to 8 numeric result columns, all on one scale'),
  stacked: z.boolean(),
})

const AskHeadlineSchema = z.object({
  column: z.string().describe('A numeric result column'),
  label: z.string(),
  value: z
    .enum(['total', 'sum', 'last', 'first', 'average', 'max', 'min', 'ratio'])
    .describe(
      'total: the All row (or the sum of a count); ratio: sum(numerator) / sum(denominator), for a rate across rows',
    ),
  numerator: z.string().nullable().describe('ratio only: the count on top'),
  denominator: z.string().nullable().describe('ratio only: the count underneath'),
  better: z.enum(['higher', 'lower', 'neutral']),
})

const AskColumnSchema = z.object({
  name: z.string(),
  label: z.string().nullable(),
  description: z.string().nullable().describe('What the column means, in one sentence'),
  base: z.string().nullable().describe('For a rate: the count column it is a share of'),
  better: z.enum(['higher', 'lower', 'neutral']),
})

/**
 * What Claude returns. The fields come in this order as they stream, so
 * the title, plan and assumptions reach the person before the SQL.
 */
export const AskOutputSchema = z.object({
  answerable: z.boolean().describe('false when the reporting schema cannot answer the question'),
  not_answerable_reason: z.string().nullable(),
  title: z.string(),
  plan: z
    .array(z.string())
    .describe(
      '2 to 5 short steps in plain words: what is counted, over which rows, and how it is split',
    ),
  assumptions: z
    .array(z.string())
    .describe('Each interpretation you chose where the question was ambiguous'),
  description: z
    .string()
    .describe('What the report shows and its definitions, for the staff who read it'),
  category: z.enum([
    'acquisition',
    'credit',
    'loan_book',
    'arrears',
    'operations',
    'finance',
    'other',
  ]),
  parameters: z.array(AskParameterSchema),
  sql: z.string().describe('One SELECT or WITH statement over the reporting schema'),
  charts: z.array(AskChartSchema).describe('0 to 2 charts'),
  headline: z.array(AskHeadlineSchema).describe('1 to 3 numbers that answer the question'),
  columns: z.array(AskColumnSchema).describe('Settings for the columns that need them'),
})

export type AskOutput = z.infer<typeof AskOutputSchema>

/**
 * The system prompt around a schema text. Live requests use the annotated
 * description; the benchmark's H0 arm passes raw DDL instead.
 */
export function buildSystemPrompt(schemaText: string): string {
  return `You write report definitions for Billie, an Australian small-amount lender. A report is one PostgreSQL query over the reporting schema described below, plus the parameters staff fill in, how its results are presented, and a short plan. Staff see a headline, charts and a table; an author reviews and publishes it.

Write a definition that answers the question exactly as asked, following the business rules in the schema description. Where the question is ambiguous, choose the interpretation a lending operations manager would expect and record the choice in assumptions. If the schema cannot answer the question, set answerable to false, say why, and leave sql as a short SELECT that returns no rows.

Start with the title, then the plan: two to five short steps a manager can check, such as "Count decided applications per week (Monday to Sunday, Sydney time)".

The query runs read-only with a 15 second timeout and a 50,000 row cap. It must be a single SELECT or WITH statement with no trailing semicolon. Read parameter 1 as $1, parameter 2 as $2, and so on, in list order, casting where needed ($1::date); every parameter must be used. Give every parameter a default so the report runs as soon as it opens. For a period, name the date parameters from and to. Name result columns in lower_snake_case: a share from 0 to 1 ends in _rate, a percentage from 0 to 100 ends in _pct, and money columns name what they hold (amount, outstanding, fee). When a breakdown by category adds up, add an "All" total row with GROUPING SETS so the headline can read it.

Presentation: up to two charts (line or area over time, bar-horizontal to rank categories, stacked-100 for a mix), all series on one scale, so never counts and rates together. One to three headline numbers that answer the question, with whether higher is better; to total a rate across rows use value "ratio" with the numerator and denominator count columns. Column settings only where they help: a plain label, a one-sentence description, and for each rate the count column it is a share of (base).

${schemaText}`
}

const SYSTEM_PROMPT = buildSystemPrompt(renderSchemaDescription())

export interface AskUsage {
  model: string
  effort: AskEffort
  promptVersion: string
  schemaVersion: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  latencyMs: number
  /** Time to the first streamed text, when streamed. */
  firstOutputMs?: number
}

export type AskResponse =
  | { status: 'ok'; output: AskOutput; usage: AskUsage }
  | { status: 'refused' | 'invalid_output'; message: string; usage: AskUsage }

export interface AskRequest {
  question: string
  /** A previous draft to change, what to change, and what the checks found. */
  previous?: {
    definition: DraftDefinition
    refinement: string
    issues?: ReadonlyArray<{ code: string; message: string }>
  }
}

/**
 * Checks whose messages carry result values or database error text. Claude
 * gets a fixed description instead, so no result data reaches it.
 */
const RESULT_ISSUES: Record<string, string> = {
  RUN: 'The query failed when run on its defaults.',
  RATE_RANGE: 'A *_rate column fell outside 0–1 or a *_pct column outside 0–100.',
  TOTAL: 'The All/Total row does not equal the sum of the other rows.',
}

/** What Claude is told about the checks' findings: no values, bounded. */
export function issuesForClaude(
  issues: ReadonlyArray<{ code: string; message: string }>,
): string[] {
  return issues.slice(0, 20).map((i) => RESULT_ISSUES[i.code] ?? String(i.message).slice(0, 300))
}

export class AskUnavailableError extends Error {}

let client: Anthropic | undefined

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AskUnavailableError('Ask Claude is not configured (ANTHROPIC_API_KEY)')
  }
  // Per-request timeouts below: ASK_TIMEOUT_MS, or ASK_STREAM_TIMEOUT_MS
  // when streamed.
  client ??= new Anthropic({ timeout: ASK_TIMEOUT_MS, maxRetries: 0 })
  return client
}

function userMessage(request: AskRequest): string {
  if (!request.previous) return `Question: ${request.question}`
  const { definition, refinement, issues } = request.previous
  return [
    `Original question: ${request.question}`,
    '',
    'Current draft:',
    JSON.stringify(definition, null, 2),
    issues?.length
      ? `\nProblems found when checking it:\n${issuesForClaude(issues)
          .map((i) => `- ${i}`)
          .join('\n')}`
      : '',
    '',
    `Change requested: ${refinement}`,
    '',
    'Return the whole revised definition.',
  ].join('\n')
}

export interface AskOptions {
  /** The benchmark's raw-DDL arm replaces the prompt (H0). */
  systemPrompt?: string
  promptVersion?: string
  schemaVersion?: string
  /** Defaults: high for a question, medium for a refinement. */
  effort?: AskEffort
  model?: string
  /** Cancels the request (the person pressed Cancel or left). */
  signal?: AbortSignal
  /** Streams the answer: called with all the text so far as it arrives. */
  onText?: (snapshot: string) => void
}

/**
 * Ask Claude for a report definition, streamed when `onText` is given.
 *
 * @throws AskUnavailableError when no API key is configured, and
 *   Anthropic.APIError for API failures (timeouts and cancellation
 *   included).
 */
export async function askClaude(
  request: AskRequest,
  options: AskOptions = {},
): Promise<AskResponse> {
  const anthropic = getClient()
  const started = performance.now()
  const effort = options.effort ?? (request.previous ? ASK_REFINE_EFFORT : ASK_EFFORT)
  const params = {
    model: options.model ?? ASK_MODEL,
    max_tokens: 16_000,
    // A classifier decline is re-run on Anthropic's recommended fallback
    // model inside the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort, format: betaZodOutputFormat(AskOutputSchema) },
    system: [
      {
        type: 'text' as const,
        text: options.systemPrompt ?? SYSTEM_PROMPT,
        // The prompt and schema description are identical across requests,
        // and asks are minutes apart, so keep the cache for an hour.
        cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
      },
    ],
    messages: [{ role: 'user' as const, content: userMessage(request) }],
  }
  let firstOutputMs: number | undefined
  // `create`/`stream`, not `parse`: `parse` throws on text that does not
  // match the schema (a refusal, a cut-off answer) before the stop reason or
  // usage can be read. The output is checked against the schema below.
  let response
  if (options.onText) {
    const onText = options.onText
    const stream = anthropic.beta.messages.stream(params as never, {
      signal: options.signal,
      timeout: ASK_STREAM_TIMEOUT_MS,
    })
    stream.on('text', (_delta, snapshot) => {
      firstOutputMs ??= Math.round(performance.now() - started)
      onText(snapshot)
    })
    response = await stream.finalMessage()
  } else {
    response = await anthropic.beta.messages.create(params as never, {
      signal: options.signal,
      timeout: ASK_TIMEOUT_MS,
    })
  }
  const usage: AskUsage = {
    model: response.model,
    effort,
    promptVersion: options.promptVersion ?? ASK_PROMPT_VERSION,
    schemaVersion: options.schemaVersion ?? SCHEMA_DESCRIPTION_VERSION,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    latencyMs: Math.round(performance.now() - started),
    ...(firstOutputMs !== undefined ? { firstOutputMs } : {}),
  }
  if (response.stop_reason === 'refusal') {
    return {
      status: 'refused',
      message: 'Claude declined this request. Rephrase the question, or write the SQL yourself.',
      usage,
    }
  }
  if (response.stop_reason === 'max_tokens') {
    return {
      status: 'invalid_output',
      message: 'The draft was too long and was cut off. Ask a narrower question.',
      usage,
    }
  }
  const output = parseOutput(response.content as ReadonlyArray<{ type: string; text?: string }>)
  if (!output) {
    return {
      status: 'invalid_output',
      message: 'Claude did not return a usable definition. Try again.',
      usage,
    }
  }
  return { status: 'ok', output, usage }
}

/** The structured output, or null when the text is not a valid definition. */
export function parseOutput(
  content: ReadonlyArray<{ type: string; text?: string }>,
): AskOutput | null {
  const text = content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
  try {
    const parsed = AskOutputSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const definedBetter = (better: 'higher' | 'lower' | 'neutral') =>
  better === 'neutral' ? {} : { better }

/** A Claude answer as a definition the validator and runner understand. */
export function toDraftDefinition(output: AskOutput): DraftDefinition {
  return {
    title: output.title,
    description: output.description,
    sql: output.sql,
    category: output.category,
    parameters: output.parameters.map((p) => {
      const param: Record<string, unknown> = {
        name: p.name,
        label: p.label,
        type: p.type,
        required: p.required,
      }
      if (p.default !== null && p.default !== '') {
        param.default =
          p.type === 'integer' || p.type === 'number'
            ? Number(p.default)
            : p.type === 'boolean'
              ? p.default === 'true'
              : p.default
      }
      if (p.options?.length) param.options = p.options
      if (p.help) param.help = p.help
      return param
    }),
    chart: output.charts.length
      ? output.charts.slice(0, 2).map((c) => ({
          type: c.type,
          x: c.x,
          series: c.series.map((s) => ({ column: s.column, label: s.label })),
          ...(c.stacked ? { stacked: true } : {}),
        }))
      : null,
    // Presentation is cleaned rather than rejected: a ratio missing a side
    // falls back to the total, and long text is cut, so a presentation slip
    // never blocks a draft whose SQL is fine.
    headline: output.headline
      .filter((h) => h.column.trim() && h.label.trim())
      .slice(0, 4)
      .map((h) => {
        const ratio = h.value === 'ratio' && !!h.numerator && !!h.denominator
        return {
          column: h.column,
          label: h.label.trim().slice(0, 60),
          value: h.value === 'ratio' && !ratio ? 'total' : h.value,
          ...(ratio ? { numerator: h.numerator, denominator: h.denominator } : {}),
          ...definedBetter(h.better),
        }
      }),
    columnSettings: output.columns
      .filter((c) => c.name.trim())
      .slice(0, 50)
      .map((c) => ({
        name: c.name,
        ...(c.label?.trim() ? { label: c.label.trim().slice(0, 60) } : {}),
        ...(c.description?.trim() ? { description: c.description.trim().slice(0, 300) } : {}),
        ...(c.base ? { base: c.base } : {}),
        ...definedBetter(c.better),
      })),
  }
}

export { SYSTEM_PROMPT as ASK_SYSTEM_PROMPT }
