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
import { askClaude, toDraftDefinition, type AskRequest, type AskUsage } from './claude'
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
    return {
      valid,
      issues: [...issues, ...validateResult(result.columns, result.rows)],
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
  const answer = await askClaude(request)
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
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'report'

/**
 * Save a checked definition as a draft report, authored by the user. Only
 * report authors can (collection access applies). A supervisor publishes it
 * from the admin.
 *
 * @returns the new draft's id and slug, or the issues that block saving.
 */
export async function saveDraft(
  payload: Payload,
  user: unknown,
  definition: DraftDefinition,
): Promise<{ ok: true; id: string; slug: string } | { ok: false; issues: ValidationIssue[] }> {
  const { valid, issues } = validateStatic(definition)
  if (!valid) return { ok: false, issues }
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
    const doc = await payload.create({
      collection: 'report-definitions',
      data: {
        ...valid,
        slug,
        roles: ['admin', 'supervisor'],
        schedule: 'none',
        origin: 'ask',
        _status: 'draft',
      } as never,
      draft: true,
      // Access applies: only report authors can create drafts.
      overrideAccess: false,
      user: user as never,
    })
    return { ok: true, id: String(doc.id), slug }
  }
  return {
    ok: false,
    issues: [
      { level: 'error', code: 'SLUG', message: 'Could not find a free link for this report' },
    ],
  }
}
