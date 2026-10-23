/**
 * The Ask Claude flow (BTB-508): question → definition → checks → preview.
 *
 * Every request is logged to `report-asks` with its tokens, latency, model,
 * prompt and schema-description versions and the checks' outcome. Saving a
 * draft is separate (`saveDraft`), so nothing reaches the report list until
 * an author chooses to keep it.
 */
import type { Payload } from 'payload'
import { bindParameters, RESERVED_REPORT_SLUGS } from '@/lib/schemas/reports'
import type { ReportColumn } from '@/lib/schemas/reports'
import { ReportRunError, runReportSql, type RunOptions } from '../runner'
import {
  ASK_EFFORT,
  ASK_MODEL,
  AskUnavailableError,
  askClaude,
  toDraftDefinition,
  type AskRequest,
  type AskUsage,
} from './claude'
import {
  validateResult,
  validateStatic,
  type DraftDefinition,
  type ValidationIssue,
  type ValidDraft,
} from './validate'

export interface DraftPreview {
  columns: ReportColumn[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  truncated: boolean
  durationMs: number
}

export interface DraftOutcome {
  status: 'ok' | 'unanswerable' | 'refused' | 'invalid_output'
  definition?: DraftDefinition
  assumptions: string[]
  notAnswerableReason?: string
  message?: string
  issues: ValidationIssue[]
  preview?: DraftPreview
  usage?: AskUsage
}

/** Size limits on a definition sent by the browser: everything here can reach Claude. */
const LIMITS = { title: 200, description: 2000, sql: 20_000, parameters: 10_000, chart: 2000 }

/**
 * A definition from a request body, or null when it is missing or too
 * large. Sizes are bounded because a refinement sends it to Claude.
 */
export function parseDefinition(value: unknown): DraftDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.sql !== 'string' || typeof v.title !== 'string') return null
  const description = typeof v.description === 'string' ? v.description : ''
  const parameters = v.parameters ?? []
  const chart = v.chart ?? null
  if (
    v.title.length > LIMITS.title ||
    description.length > LIMITS.description ||
    v.sql.length > LIMITS.sql ||
    JSON.stringify(parameters).length > LIMITS.parameters ||
    JSON.stringify(chart).length > LIMITS.chart
  ) {
    return null
  }
  return { title: v.title, description, sql: v.sql, parameters, chart }
}

/** Issue codes and messages from a request body, bounded. */
export function parseIssues(value: unknown): Array<{ code: string; message: string }> {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (i): i is { code: string; message: string } =>
        !!i && typeof i.code === 'string' && typeof i.message === 'string',
    )
    .slice(0, 20)
    .map((i) => ({ code: i.code.slice(0, 40), message: i.message.slice(0, 300) }))
}

/** Static checks, then a run on the defaults through the runner, then result checks. */
export async function checkAndPreview(
  definition: DraftDefinition,
  runOptions: RunOptions = {},
): Promise<{ valid: ValidDraft | null; issues: ValidationIssue[]; preview?: DraftPreview }> {
  const { valid, issues } = validateStatic(definition)
  if (!valid) return { valid, issues }
  const bound = bindParameters(valid.parameters, {})
  if (!bound.ok) return { valid, issues } // NO_DEFAULT already warns
  try {
    const result = await runReportSql(valid.sql, bound.values, runOptions)
    const all = [...issues, ...validateResult(result.columns, result.rows)]
    return {
      valid: all.some((i) => i.level === 'error') ? null : valid,
      issues: all,
      preview: result,
    }
  } catch (error) {
    const message =
      error instanceof ReportRunError
        ? `${error.message}${error.detail ? ` (${error.detail})` : ''}`
        : 'The query could not be run.'
    return { valid: null, issues: [...issues, { level: 'error', code: 'RUN', message }] }
  }
}

async function logAsk(
  payload: Payload,
  user: unknown,
  entry: {
    kind: 'ask' | 'refine' | 'check'
    question: string
    refinement?: string
    outcome: string
    usage?: AskUsage
    issues: ValidationIssue[]
    definition?: DraftDefinition
  },
): Promise<void> {
  try {
    await payload.create({
      collection: 'report-asks',
      data: {
        user: (user as { id?: string } | null)?.id ?? null,
        kind: entry.kind,
        question: entry.question.slice(0, 2000),
        refinement: entry.refinement?.slice(0, 2000),
        outcome: entry.outcome as 'ok',
        model: entry.usage?.model,
        effort: entry.usage?.effort,
        promptVersion: entry.usage?.promptVersion,
        schemaVersion: entry.usage?.schemaVersion,
        inputTokens: entry.usage?.inputTokens,
        outputTokens: entry.usage?.outputTokens,
        cacheReadTokens: entry.usage?.cacheReadTokens,
        cacheWriteTokens: entry.usage?.cacheWriteTokens,
        latencyMs: entry.usage?.latencyMs,
        errorCount: entry.issues.filter((i) => i.level === 'error').length,
        warningCount: entry.issues.filter((i) => i.level === 'warning').length,
        definition: (entry.definition ?? null) as never,
      },
      overrideAccess: true,
    })
  } catch (error) {
    console.error('[reports] could not log an Ask request:', error)
  }
}

/**
 * Draft a report from a question, or revise a previous draft.
 *
 * @throws AskUnavailableError when Claude is not configured.
 */
export async function draftFromQuestion(
  payload: Payload,
  user: unknown,
  request: AskRequest,
  runOptions: RunOptions = {},
): Promise<DraftOutcome> {
  const kind = request.previous ? 'refine' : 'ask'
  let answer: Awaited<ReturnType<typeof askClaude>>
  try {
    answer = await askClaude(request)
  } catch (error) {
    // Nothing was sent without a key; anything else is a failed request.
    if (!(error instanceof AskUnavailableError)) {
      await logAsk(payload, user, {
        kind,
        question: request.question,
        refinement: request.previous?.refinement,
        outcome: 'error',
        usage: { model: ASK_MODEL, effort: ASK_EFFORT } as AskUsage,
        issues: [],
      })
    }
    throw error
  }
  if (answer.status !== 'ok') {
    await logAsk(payload, user, {
      kind,
      question: request.question,
      refinement: request.previous?.refinement,
      outcome: answer.status,
      usage: answer.usage,
      issues: [],
    })
    return {
      status: answer.status,
      message: answer.message,
      assumptions: [],
      issues: [],
      usage: answer.usage,
    }
  }
  const definition = toDraftDefinition(answer.output)
  if (!answer.output.answerable) {
    await logAsk(payload, user, {
      kind,
      question: request.question,
      refinement: request.previous?.refinement,
      outcome: 'unanswerable',
      usage: answer.usage,
      issues: [],
    })
    return {
      status: 'unanswerable',
      notAnswerableReason: answer.output.not_answerable_reason ?? undefined,
      assumptions: answer.output.assumptions,
      issues: [],
      usage: answer.usage,
    }
  }
  const checked = await checkAndPreview(definition, runOptions)
  await logAsk(payload, user, {
    kind,
    question: request.question,
    refinement: request.previous?.refinement,
    outcome: checked.valid ? 'ok' : 'invalid',
    usage: answer.usage,
    issues: checked.issues,
    definition,
  })
  return {
    status: 'ok',
    definition,
    assumptions: answer.output.assumptions,
    issues: checked.issues,
    preview: checked.preview,
    usage: answer.usage,
  }
}

/** Re-check a definition an author edited by hand. No Claude call. */
export async function checkEditedDefinition(
  payload: Payload,
  user: unknown,
  question: string,
  definition: DraftDefinition,
  runOptions: RunOptions = {},
): Promise<DraftOutcome> {
  const checked = await checkAndPreview(definition, runOptions)
  await logAsk(payload, user, {
    kind: 'check',
    question,
    outcome: checked.valid ? 'ok' : 'invalid',
    issues: checked.issues,
    definition,
  })
  return {
    status: 'ok',
    definition,
    assumptions: [],
    issues: checked.issues,
    preview: checked.preview,
  }
}

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 50)
    .replace(/^-+|-+$/g, '') || 'report'

const isUniqueViolation = (error: unknown): boolean =>
  /unique|duplicate/i.test(String((error as { message?: string })?.message ?? '')) ||
  (error as { cause?: { code?: string } })?.cause?.code === '23505'

/**
 * Save a checked definition as a draft report, authored by the user. Only
 * report authors can (collection access applies). The checks run again
 * here, including a run on the defaults, and any error blocks saving
 * whatever the browser sent. A supervisor publishes it from the admin.
 *
 * @returns the new draft's id and slug, or the issues that block saving.
 */
export async function saveDraft(
  payload: Payload,
  user: unknown,
  definition: DraftDefinition,
  runOptions: RunOptions = {},
): Promise<{ ok: true; id: string; slug: string } | { ok: false; issues: ValidationIssue[] }> {
  const { valid, issues } = await checkAndPreview(definition, runOptions)
  if (!valid) return { ok: false, issues: issues.filter((i) => i.level === 'error') }
  const base = slugify(valid.title)
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`
    if (RESERVED_REPORT_SLUGS.includes(slug)) continue
    const taken = await payload.find({
      collection: 'report-definitions',
      where: { slug: { equals: slug } },
      draft: true,
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (taken.docs.length) continue
    try {
      const doc = await payload.create({
        collection: 'report-definitions',
        data: {
          ...valid,
          slug,
          roles: ['admin', 'supervisor'],
          schedule: 'none',
          _status: 'draft',
        } as never,
        draft: true,
        context: { reportOrigin: 'ask' },
        // Access applies: only report authors can create drafts.
        overrideAccess: false,
        user: user as never,
      })
      return { ok: true, id: String(doc.id), slug }
    } catch (error) {
      // Someone took the slug between the check and the insert: try another.
      if (!isUniqueViolation(error)) throw error
    }
  }
  return {
    ok: false,
    issues: [
      { level: 'error', code: 'SLUG', message: 'Could not find a free link for this report' },
    ],
  }
}
