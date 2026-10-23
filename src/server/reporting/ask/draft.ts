/**
 * The Ask Claude flow (BTB-508): question → definition → checks → preview.
 *
 * Every request is logged to `report-asks` with its tokens, latency (to the
 * first streamed text and end to end), model, prompt and schema-description
 * versions and the checks' outcome. Saving is separate (`saveDraft`), so
 * nothing reaches the report list until an author chooses to keep it.
 */
import type { Payload } from 'payload'
import {
  RESERVED_REPORT_SLUGS,
  REPORT_CATEGORY_VALUES,
  REPORT_VIEWER_ROLES,
  type ReportCategory,
  type ReportViewerRole,
} from '@/lib/schemas/reports'
import type { RunOptions } from '../runner'
import {
  ASK_EFFORT,
  ASK_MODEL,
  ASK_REFINE_EFFORT,
  AskUnavailableError,
  askClaude,
  toDraftDefinition,
  type AskRequest,
  type AskUsage,
} from './claude'
import { readPartialDraft, type PartialDraft } from './partial'
import { checkAndPreview, type DraftPreview } from './preview'
import type { DraftDefinition, ValidationIssue } from './validate'

export interface DraftOutcome {
  status: 'ok' | 'unanswerable' | 'refused' | 'invalid_output'
  /** The logged request (report-asks), to reopen or refine this draft by reference. */
  askId?: string
  definition?: DraftDefinition
  plan: string[]
  assumptions: string[]
  notAnswerableReason?: string
  message?: string
  issues: ValidationIssue[]
  preview?: DraftPreview
  usage?: AskUsage
}

/** What the person sees while a draft is being written. */
export type DraftProgress =
  | { type: 'stage'; stage: 'planning' | 'writing_sql' | 'checking'; atMs: number }
  | { type: 'partial'; draft: PartialDraft }

export interface DraftStreamOptions {
  signal?: AbortSignal
  onProgress?: (event: DraftProgress) => void
}

/** Size limits on a definition sent by the browser: everything here can reach Claude. */
const LIMITS = {
  title: 200,
  description: 2000,
  sql: 20_000,
  parameters: 10_000,
  chart: 4000,
  headline: 2000,
  columnSettings: 10_000,
}

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
  const headline = v.headline ?? []
  const columnSettings = v.columnSettings ?? []
  const category = typeof v.category === 'string' ? v.category : 'other'
  if (
    v.title.length > LIMITS.title ||
    description.length > LIMITS.description ||
    v.sql.length > LIMITS.sql ||
    JSON.stringify(parameters).length > LIMITS.parameters ||
    JSON.stringify(chart).length > LIMITS.chart ||
    JSON.stringify(headline).length > LIMITS.headline ||
    JSON.stringify(columnSettings).length > LIMITS.columnSettings ||
    category.length > 40
  ) {
    return null
  }
  return {
    title: v.title,
    description,
    sql: v.sql,
    parameters,
    chart,
    headline,
    columnSettings,
    category,
  }
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
    totalMs?: number
  },
): Promise<string | undefined> {
  try {
    const doc = await payload.create({
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
        firstOutputMs: entry.usage?.firstOutputMs,
        totalMs: entry.totalMs,
        errorCount: entry.issues.filter((i) => i.level === 'error').length,
        warningCount: entry.issues.filter((i) => i.level === 'warning').length,
        definition: (entry.definition ?? null) as never,
      },
      overrideAccess: true,
    })
    return String(doc.id)
  } catch (error) {
    console.error('[reports] could not log an Ask request:', error)
    return undefined
  }
}

/**
 * A definition this user was given by Ask Claude (their own report-asks
 * row). Staff who are not report authors can only check or refine these,
 * never SQL of their own.
 */
/** Ids of logged requests are uuids; anything else names no request. */
export const ASK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function loadOwnAsk(
  payload: Payload,
  userId: string,
  askId: string,
): Promise<{ question: string; definition: DraftDefinition } | null> {
  if (!ASK_ID_RE.test(askId)) return null
  const found = await payload.find({
    collection: 'report-asks',
    where: { and: [{ user: { equals: userId } }, { id: { equals: askId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const doc = found.docs[0]
  const definition = parseDefinition(doc?.definition)
  return doc && definition ? { question: String(doc.question ?? ''), definition } : null
}

/**
 * Keep what a rewrite by Claude cannot express: a chart's drill-down, sort
 * and average (when the same chart, by type and axis, is still there) and a
 * column's format and small-sample threshold. Claude's output has no place
 * for them, so without this a change in words would drop them.
 */
export function carryOver(previous: DraftDefinition, next: DraftDefinition): DraftDefinition {
  const asList = (value: unknown) =>
    (value === null || value === undefined ? [] : [value].flat()) as Array<Record<string, unknown>>
  const oldCharts = asList(previous.chart)
  const charts = asList(next.chart).map((chart) => {
    const same = oldCharts.find((c) => c.type === chart.type && c.x === chart.x)
    if (!same) return chart
    const kept = Object.fromEntries(
      ['drill', 'sort', 'rollingAverage']
        .filter((k) => same[k] !== undefined && chart[k] === undefined)
        .map((k) => [k, same[k]]),
    )
    return { ...chart, ...kept }
  })
  const oldColumns = asList(previous.columnSettings)
  const columnSettings = asList(next.columnSettings).map((column) => {
    const same = oldColumns.find((c) => c.name === column.name)
    if (!same) return column
    const kept = Object.fromEntries(
      ['format', 'minBase', 'base', 'better', 'label', 'description']
        .filter((k) => same[k] !== undefined && column[k] === undefined)
        .map((k) => [k, same[k]]),
    )
    return { ...column, ...kept }
  })
  // Settings for columns Claude did not mention stay as they were.
  for (const column of oldColumns) {
    if (!columnSettings.some((c) => c.name === column.name)) columnSettings.push(column)
  }
  return {
    ...next,
    chart: next.chart === null ? null : charts,
    columnSettings,
  }
}

const isAbort = (error: unknown, signal?: AbortSignal) =>
  signal?.aborted === true ||
  (error instanceof Error && /abort/i.test(`${error.name} ${error.message}`))

/**
 * Draft a report from a question, or revise a previous draft. With
 * `onProgress`, Claude's answer streams and the stages and the plan are
 * reported as they happen.
 *
 * @throws AskUnavailableError when Claude is not configured.
 */
export async function draftFromQuestion(
  payload: Payload,
  user: unknown,
  request: AskRequest,
  runOptions: RunOptions = {},
  stream: DraftStreamOptions = {},
): Promise<DraftOutcome> {
  const kind = request.previous ? 'refine' : 'ask'
  const started = performance.now()
  const at = () => Math.round(performance.now() - started)
  const { onProgress, signal } = stream
  onProgress?.({ type: 'stage', stage: 'planning', atMs: 0 })
  let lastSent = ''
  let sqlAnnounced = false
  const onText = onProgress
    ? (snapshot: string) => {
        // The title, plan and assumptions come before the SQL; once it has
        // started there is nothing more to show until the end.
        if (sqlAnnounced) return
        const partial = readPartialDraft(snapshot)
        const key = JSON.stringify(partial)
        if (key !== lastSent) {
          lastSent = key
          onProgress({ type: 'partial', draft: partial })
        }
        if (partial.writingSql && !sqlAnnounced) {
          sqlAnnounced = true
          onProgress({ type: 'stage', stage: 'writing_sql', atMs: at() })
        }
      }
    : undefined

  let answer: Awaited<ReturnType<typeof askClaude>>
  try {
    answer = await askClaude(request, { signal, onText })
  } catch (error) {
    // Nothing was sent without a key; anything else is a failed request.
    if (!(error instanceof AskUnavailableError)) {
      await logAsk(payload, user, {
        kind,
        question: request.question,
        refinement: request.previous?.refinement,
        outcome: isAbort(error, signal) ? 'cancelled' : 'error',
        usage: {
          model: ASK_MODEL,
          effort: request.previous ? ASK_REFINE_EFFORT : ASK_EFFORT,
        } as AskUsage,
        issues: [],
        totalMs: at(),
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
      totalMs: at(),
    })
    return {
      status: answer.status,
      message: answer.message,
      plan: [],
      assumptions: [],
      issues: [],
      usage: answer.usage,
    }
  }
  const drafted = toDraftDefinition(answer.output)
  const definition = request.previous ? carryOver(request.previous.definition, drafted) : drafted
  if (!answer.output.answerable) {
    await logAsk(payload, user, {
      kind,
      question: request.question,
      refinement: request.previous?.refinement,
      outcome: 'unanswerable',
      usage: answer.usage,
      issues: [],
      totalMs: at(),
    })
    return {
      status: 'unanswerable',
      notAnswerableReason: answer.output.not_answerable_reason ?? undefined,
      plan: answer.output.plan,
      assumptions: answer.output.assumptions,
      issues: [],
      usage: answer.usage,
    }
  }
  onProgress?.({ type: 'stage', stage: 'checking', atMs: at() })
  const checked = await checkAndPreview(definition, runOptions)
  const askId = await logAsk(payload, user, {
    kind,
    question: request.question,
    refinement: request.previous?.refinement,
    outcome: checked.valid ? 'ok' : 'invalid',
    usage: answer.usage,
    issues: checked.issues,
    definition,
    totalMs: at(),
  })
  return {
    status: 'ok',
    askId,
    definition,
    plan: answer.output.plan,
    assumptions: answer.output.assumptions,
    issues: checked.issues,
    preview: checked.preview,
    usage: answer.usage,
  }
}

/** Re-check a definition an author edited by hand, or a past answer reopened. No Claude call. */
export async function checkEditedDefinition(
  payload: Payload,
  user: unknown,
  question: string,
  definition: DraftDefinition,
  runOptions: RunOptions = {},
): Promise<DraftOutcome> {
  const started = performance.now()
  const checked = await checkAndPreview(definition, runOptions)
  const askId = await logAsk(payload, user, {
    kind: 'check',
    question,
    outcome: checked.valid ? 'ok' : 'invalid',
    issues: checked.issues,
    definition,
    totalMs: Math.round(performance.now() - started),
  })
  return {
    status: 'ok',
    askId,
    definition,
    plan: [],
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

export interface SaveOptions {
  /** Publish straight away (authors), rather than saving a draft. */
  publish?: boolean
  /** Who can run it once published. Defaults to admins and supervisors. */
  roles?: ReportViewerRole[]
  /** Overrides the category Claude chose. */
  category?: ReportCategory
  /** Change this existing report instead of creating one. */
  reportId?: string
}

/** Roles from a request body: known viewer roles only, at least one. */
export function parseRoles(value: unknown): ReportViewerRole[] | null {
  if (value === undefined) return null
  if (!Array.isArray(value)) return null
  const roles = value.filter((r): r is ReportViewerRole =>
    (REPORT_VIEWER_ROLES as readonly unknown[]).includes(r),
  )
  return roles.length > 0 && roles.length === value.length ? [...new Set(roles)] : null
}

export function parseCategory(value: unknown): ReportCategory | null {
  return (REPORT_CATEGORY_VALUES as readonly unknown[]).includes(value)
    ? (value as ReportCategory)
    : null
}

/**
 * Save a checked definition as a report, authored by the user. Only report
 * authors can (collection access applies). The checks run again here,
 * including a run on the defaults, and any error blocks saving whatever the
 * browser sent. Saves a draft unless `publish`; changes `reportId` in place
 * when given (a new draft version, or published).
 *
 * @returns the report's id and slug, or the issues that block saving.
 */
export async function saveDraft(
  payload: Payload,
  user: unknown,
  definition: DraftDefinition,
  options: SaveOptions = {},
  runOptions: RunOptions = {},
): Promise<
  | { ok: true; id: string; slug: string; published: boolean }
  | { ok: false; issues: ValidationIssue[] }
> {
  const { valid, issues } = await checkAndPreview(definition, runOptions)
  if (!valid) return { ok: false, issues: issues.filter((i) => i.level === 'error') }
  const data = {
    title: valid.title,
    description: valid.description,
    sql: valid.sql,
    parameters: valid.parameters,
    chart: valid.chart,
    headline: valid.headline,
    columnSettings: valid.columnSettings,
    category: options.category ?? valid.category,
    ...(options.roles ? { roles: options.roles } : {}),
    _status: options.publish ? 'published' : 'draft',
  }

  if (options.reportId) {
    const doc = await payload.update({
      collection: 'report-definitions',
      id: options.reportId,
      data: data as never,
      draft: !options.publish,
      // Access applies: only report authors can change reports, and a
      // report someone has open in the admin is not written over.
      overrideAccess: false,
      overrideLock: false,
      user: user as never,
    })
    return { ok: true, id: String(doc.id), slug: String(doc.slug), published: !!options.publish }
  }

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
          ...data,
          slug,
          roles: options.roles ?? ['admin', 'supervisor'],
          schedule: 'none',
        } as never,
        draft: !options.publish,
        context: { reportOrigin: 'ask' },
        // Access applies: only report authors can create reports.
        overrideAccess: false,
        user: user as never,
      })
      return { ok: true, id: String(doc.id), slug, published: !!options.publish }
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

export { checkAndPreview, type DraftPreview }
