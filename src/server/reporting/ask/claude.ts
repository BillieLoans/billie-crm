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
export const ASK_EFFORT = 'high' as const
export const ASK_PROMPT_VERSION = 'ask-v1'
export const ASK_TIMEOUT_MS = 85_000

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

const AskChartSchema = z
  .object({
    type: z.enum(['line', 'bar', 'area']),
    x: z.string().describe('Result column on the horizontal axis'),
    series: z
      .array(z.object({ column: z.string(), label: z.string() }))
      .describe('1 to 8 numeric result columns'),
    stacked: z.boolean(),
  })
  .nullable()

/** What Claude returns. */
export const AskOutputSchema = z.object({
  answerable: z.boolean().describe('false when the reporting schema cannot answer the question'),
  not_answerable_reason: z.string().nullable(),
  title: z.string(),
  description: z
    .string()
    .describe('What the report shows and its definitions, for the staff who read it'),
  sql: z.string().describe('One SELECT or WITH statement over the reporting schema'),
  parameters: z.array(AskParameterSchema),
  chart: AskChartSchema,
  assumptions: z
    .array(z.string())
    .describe('Each interpretation you chose where the question was ambiguous'),
})

export type AskOutput = z.infer<typeof AskOutputSchema>

/**
 * The system prompt around a schema text. Live requests use the annotated
 * description; the benchmark's H0 arm passes raw DDL instead.
 */
export function buildSystemPrompt(schemaText: string): string {
  return `You write report definitions for Billie, an Australian small-amount lender. A report is one PostgreSQL query over the reporting schema described below, plus the parameters staff fill in and an optional chart. Staff see the result as a table and chart; a supervisor reviews and publishes it.

Write a definition that answers the question exactly as asked, following the business rules in the schema description. Where the question is ambiguous, choose the interpretation a lending operations manager would expect and record the choice in assumptions. If the schema cannot answer the question, set answerable to false, say why, and leave sql as a short SELECT that returns no rows.

The query runs read-only with a 15 second timeout and a 50,000 row cap. It must be a single SELECT or WITH statement with no trailing semicolon. Read parameter 1 as $1, parameter 2 as $2, and so on, in list order, casting where needed ($1::date); every parameter must be used. Prefer giving every parameter a default so the report runs as soon as it opens. Name result columns in lower_snake_case; they are shown as headings.

Add a chart only when one helps: a line for a measure over days, a bar for a measure by category. Series must be numeric columns, on one axis, so do not chart counts and rates together.

${schemaText}`
}

const SYSTEM_PROMPT = buildSystemPrompt(renderSchemaDescription())

export interface AskUsage {
  model: string
  effort: typeof ASK_EFFORT
  promptVersion: string
  schemaVersion: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  latencyMs: number
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
  // The CRM sits behind Cloudflare, which gives up on the origin after 100
  // seconds; a draft that takes longer would be paid for and never seen.
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

/**
 * Ask Claude for a report definition.
 *
 * @param options overrides for the benchmark, which compares a prompt built
 *   on raw DDL (H0) with the annotated description (H1): `systemPrompt`
 *   replaces the prompt, and `promptVersion` / `schemaVersion` label the
 *   usage it records. Live requests leave them unset.
 * @throws AskUnavailableError when no API key is configured, and
 *   Anthropic.APIError for API failures (timeouts included).
 */
export async function askClaude(
  request: AskRequest,
  options: { systemPrompt?: string; promptVersion?: string; schemaVersion?: string } = {},
): Promise<AskResponse> {
  const anthropic = getClient()
  const started = performance.now()
  // `create`, not `parse`: `parse` throws on text that does not match the
  // schema (a refusal, a cut-off answer) before the stop reason or usage
  // can be read. The output is checked against the schema below instead.
  const response = await anthropic.beta.messages.create({
    model: ASK_MODEL,
    max_tokens: 16_000,
    // A classifier decline is re-run on Anthropic's recommended fallback
    // model inside the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: ASK_EFFORT, format: betaZodOutputFormat(AskOutputSchema) },
    system: [
      {
        type: 'text',
        text: options.systemPrompt ?? SYSTEM_PROMPT,
        // The prompt and schema description are identical across requests.
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage(request) }],
  })
  const usage: AskUsage = {
    model: response.model,
    effort: ASK_EFFORT,
    promptVersion: options.promptVersion ?? ASK_PROMPT_VERSION,
    schemaVersion: options.schemaVersion ?? SCHEMA_DESCRIPTION_VERSION,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    latencyMs: Math.round(performance.now() - started),
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
  const output = parseOutput(response.content)
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

/** A Claude answer as a definition the validator and runner understand. */
export function toDraftDefinition(output: AskOutput): DraftDefinition {
  return {
    title: output.title,
    description: output.description,
    sql: output.sql,
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
    chart: output.chart
      ? {
          type: output.chart.type,
          x: output.chart.x,
          series: output.chart.series.map((s) => ({ column: s.column, label: s.label })),
          ...(output.chart.stacked ? { stacked: true } : {}),
        }
      : null,
  }
}

export { SYSTEM_PROMPT as ASK_SYSTEM_PROMPT }
