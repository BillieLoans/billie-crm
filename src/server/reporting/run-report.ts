/**
 * Listing and running published reports for a signed-in user (BTB-506).
 *
 * The routes under `src/app/api/reports/` are thin wrappers over this. The
 * SQL never leaves the server: viewers get a report's title, parameters and
 * chart, and only authors see database error detail.
 */
import type { Payload } from 'payload'
import type { ReportRun } from '@/payload-types'
import { getUserRole } from '@/lib/access'
import {
  REPORT_AUTHOR_ROLES,
  bindParameters,
  columnSpecsSchema,
  headlineSpecsSchema,
  normaliseCharts,
  reportParametersSchema,
  REPORT_CATEGORY_VALUES,
  type ChartSpec,
  type ColumnSpec,
  type HeadlineSpec,
  type ReportCategory,
  type ReportColumn,
  type ReportParameter,
} from '@/lib/schemas/reports'
import { ReportRunError, runReportSql, type RunOptions } from './runner'

/** What the form, charts and headline of one version of a report need. Never the SQL. */
export interface ReportSpec {
  title: string
  description: string | null
  category: ReportCategory
  parameters: ReportParameter[]
  /** Zero, one or two charts. */
  charts: ChartSpec[]
  columns: ColumnSpec[]
  headline: HeadlineSpec[]
  /** Its headline numbers show on the Reports home. */
  featured: boolean
  /** The SQL filters out mock applications (`mock_origin`). */
  excludesMock: boolean
}

export interface ReportSummary extends ReportSpec {
  id: string
  slug: string
  /** False for a report that has only ever been saved as a draft. */
  published: boolean
  /**
   * Authors only: the latest draft, when it is newer than the published
   * version. Its parameters can differ, so a draft run uses this form.
   */
  draft?: ReportSpec
}

export interface ReportRunResponse {
  report: { slug: string; title: string; version: string; draft: boolean }
  columns: ReportColumn[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  truncated: boolean
  durationMs: number
}

export type RunOutcome =
  | { status: 200; body: ReportRunResponse }
  | {
      status: 400 | 403 | 404 | 422 | 500 | 503 | 504
      body: {
        error: { code: string; message: string; detail?: string; fields?: Record<string, string> }
      }
    }

export interface ReportDoc {
  id: string
  slug: string
  title: string
  description?: string | null
  sql: string
  parameters?: unknown
  chart?: unknown
  columnSettings?: unknown
  headline?: unknown
  category?: string | null
  featured?: boolean | null
  roles?: string[] | null
  _status?: 'draft' | 'published' | null
  schedule?: string | null
}

export function isReportAuthor(user: unknown): boolean {
  const role = getUserRole(user)
  return role !== undefined && REPORT_AUTHOR_ROLES.includes(role)
}

/** Authors run any report; everyone else needs their role on the report. */
export function canRunReport(user: unknown, roles: readonly string[] | null | undefined): boolean {
  const role = getUserRole(user)
  if (role === undefined || role === 'service' || role === 'marketing') return false
  return isReportAuthor(user) || (roles ?? []).includes(role)
}

/** `NOT mock_origin`, `mock_origin = false` or `mock_origin IS NOT TRUE`, any alias. */
const EXCLUDES_MOCK =
  /\bnot\s+(?:\w+\.)?mock_origin\b|\bmock_origin\s*(?:=\s*false|is\s+(?:not\s+true|false))/i

export function specOf(doc: ReportDoc): ReportSpec {
  const params = reportParametersSchema.safeParse(doc.parameters ?? [])
  const columns = columnSpecsSchema.safeParse(doc.columnSettings ?? [])
  const headline = headlineSpecsSchema.safeParse(doc.headline ?? [])
  const category = (REPORT_CATEGORY_VALUES as readonly string[]).includes(doc.category ?? '')
    ? (doc.category as ReportCategory)
    : 'other'
  return {
    title: doc.title,
    description: doc.description ?? null,
    category,
    parameters: params.success ? params.data : [],
    charts: normaliseCharts(doc.chart),
    columns: columns.success ? columns.data : [],
    headline: headline.success ? headline.data : [],
    featured: doc.featured === true,
    excludesMock: EXCLUDES_MOCK.test(doc.sql ?? ''),
  }
}

/**
 * The reports the user may run, by title. Viewers see published reports.
 * Authors also see draft-only reports and, for published ones, the newer
 * draft's form, so they can try a change before publishing it.
 */
export async function listReports(payload: Payload, user: unknown): Promise<ReportSummary[]> {
  const published = await payload.find({
    collection: 'report-definitions',
    where: { _status: { equals: 'published' } },
    sort: 'title',
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })
  const reports: ReportSummary[] = (published.docs as unknown as ReportDoc[])
    .filter((doc) => canRunReport(user, doc.roles))
    .map((doc) => ({ id: String(doc.id), slug: doc.slug, published: true, ...specOf(doc) }))

  if (isReportAuthor(user)) {
    // With `draft: true`, each document comes back as its latest version.
    const latest = await payload.find({
      collection: 'report-definitions',
      draft: true,
      limit: 500,
      depth: 0,
      overrideAccess: true,
    })
    for (const doc of latest.docs as unknown as ReportDoc[]) {
      if (doc._status !== 'draft') continue
      const existing = reports.find((r) => r.id === String(doc.id))
      if (existing) existing.draft = specOf(doc)
      else
        reports.push({
          id: String(doc.id),
          slug: doc.slug,
          published: false,
          ...specOf(doc),
          draft: specOf(doc),
        })
    }
    reports.sort((a, b) => a.title.localeCompare(b.title, 'en-AU'))
  }
  return reports
}

export async function findReport(
  payload: Payload,
  slug: string,
  draft: boolean,
): Promise<ReportDoc | null> {
  const found = await payload.find({
    collection: 'report-definitions',
    where: draft
      ? { slug: { equals: slug } }
      : { and: [{ slug: { equals: slug } }, { _status: { equals: 'published' } }] },
    draft,
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return (found.docs[0] as unknown as ReportDoc | undefined) ?? null
}

/** The id of the report's latest published version, for the run log. */
export async function publishedVersionId(payload: Payload, reportId: string): Promise<string> {
  try {
    const versions = await payload.findVersions({
      collection: 'report-definitions',
      where: {
        and: [{ parent: { equals: reportId } }, { 'version._status': { equals: 'published' } }],
      },
      sort: '-updatedAt',
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    return versions.docs[0] ? String(versions.docs[0].id) : 'unknown'
  } catch {
    return 'unknown'
  }
}

export interface RunLogEntry {
  reportSlug: string
  report?: string
  version?: string
  parameters?: unknown
  outcome: 'ok' | 'timeout' | 'refused' | 'error'
  errorCode?: string
  durationMs?: number
  rowCount?: number
  truncated?: boolean
  trigger?: 'view' | 'schedule' | 'mcp'
  scheduledFor?: string
}

/** Logged values are short: dates, codes and numbers, never pasted text. */
const MAX_LOGGED_TEXT = 100

function loggable(value: unknown): unknown {
  if (typeof value === 'string') return value.slice(0, MAX_LOGGED_TEXT)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  return value === undefined ? null : '[not a value]'
}

/** The declared parameters only, in order, so the log never stores arbitrary client keys. */
export function loggedParameters(
  params: readonly ReportParameter[],
  values: Record<string, unknown> | readonly unknown[],
): Record<string, unknown> {
  return Object.fromEntries(
    params.map((p, i) => [
      p.name,
      loggable(
        Array.isArray(values)
          ? values[i]
          : Object.hasOwn(values, p.name)
            ? (values as Record<string, unknown>)[p.name]
            : undefined,
      ),
    ]),
  )
}

export async function logRun(payload: Payload, user: unknown, entry: RunLogEntry): Promise<void> {
  try {
    await payload.create({
      collection: 'report-runs',
      data: {
        ...entry,
        parameters: entry.parameters as ReportRun['parameters'],
        user: (user as { id?: string } | null)?.id ?? null,
      },
      overrideAccess: true,
    })
  } catch (error) {
    // The log must never cost the user their report.
    console.error('[reports] could not log a report run:', error)
  }
}

const STATUS_BY_CODE: Record<ReportRunError['code'], 422 | 500 | 503 | 504> = {
  INVALID_SQL: 422,
  PERMISSION: 422,
  TIMEOUT: 504,
  UNAVAILABLE: 503,
  QUERY_FAILED: 500,
}

/**
 * Run a report for a user.
 *
 * @param draft run the latest draft rather than the published version
 *   (authors only).
 */
export async function runReport(
  payload: Payload,
  user: unknown,
  slug: string,
  input: { parameters?: Record<string, unknown>; draft?: boolean; trigger?: 'view' | 'mcp' },
  options: RunOptions = {},
): Promise<RunOutcome> {
  const log = (entry: RunLogEntry) =>
    logRun(payload, user, { ...entry, trigger: input.trigger ?? 'view' })
  const author = isReportAuthor(user)
  const draft = input.draft === true
  if (draft && !author) {
    await log({ reportSlug: slug, outcome: 'refused', errorCode: 'FORBIDDEN' })
    return forbidden()
  }

  const doc = await findReport(payload, slug, draft)
  if (!doc) {
    await log({
      reportSlug: slug.slice(0, MAX_LOGGED_TEXT),
      outcome: 'refused',
      errorCode: 'NOT_FOUND',
    })
    return {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'There is no published report at this link.' } },
    }
  }
  const base = { reportSlug: doc.slug, report: String(doc.id) }

  if (!canRunReport(user, doc.roles)) {
    await log({ ...base, outcome: 'refused', errorCode: 'FORBIDDEN' })
    return forbidden()
  }

  const params = reportParametersSchema.safeParse(doc.parameters ?? [])
  if (!params.success) {
    await log({ ...base, outcome: 'error', errorCode: 'BAD_DEFINITION' })
    return {
      status: 500,
      body: { error: { code: 'BAD_DEFINITION', message: 'This report is set up incorrectly.' } },
    }
  }
  const submitted = input.parameters ?? {}
  const bound = bindParameters(params.data, submitted)
  if (!bound.ok) {
    await log({
      ...base,
      parameters: loggedParameters(params.data, submitted),
      outcome: 'refused',
      errorCode: 'INVALID_PARAMETERS',
    })
    return {
      status: 400,
      body: {
        error: {
          code: 'INVALID_PARAMETERS',
          message: 'Check the highlighted fields.',
          fields: bound.errors,
        },
      },
    }
  }
  // Log the values as bound, defaults included, keyed by name.
  const parameters = loggedParameters(params.data, bound.values)
  const version = draft ? 'draft' : await publishedVersionId(payload, String(doc.id))

  try {
    const result = await runReportSql(doc.sql, bound.values, options)
    await log({
      ...base,
      version,
      parameters,
      outcome: 'ok',
      durationMs: result.durationMs,
      rowCount: result.rowCount,
      truncated: result.truncated,
    })
    return {
      status: 200,
      body: {
        report: { slug: doc.slug, title: doc.title, version, draft },
        ...result,
      },
    }
  } catch (error) {
    const runError =
      error instanceof ReportRunError
        ? error
        : new ReportRunError('QUERY_FAILED', 'The report could not be run.')
    await log({
      ...base,
      version,
      parameters,
      outcome: runError.code === 'TIMEOUT' ? 'timeout' : 'error',
      errorCode: runError.code,
    })
    return {
      status: STATUS_BY_CODE[runError.code],
      body: {
        error: {
          code: runError.code,
          message: runError.message,
          ...(author && runError.detail ? { detail: runError.detail } : {}),
        },
      },
    }
  }
}

function forbidden(): RunOutcome {
  return {
    status: 403,
    body: { error: { code: 'FORBIDDEN', message: 'You do not have access to this report.' } },
  }
}
