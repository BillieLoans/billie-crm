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
  chartSpecSchema,
  reportParametersSchema,
  type ChartSpec,
  type ReportColumn,
  type ReportParameter,
} from '@/lib/schemas/reports'
import { ReportRunError, runReportSql, type RunOptions } from './runner'

export interface ReportSummary {
  id: string
  slug: string
  title: string
  description: string | null
  parameters: ReportParameter[]
  chart: ChartSpec | null
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

interface ReportDoc {
  id: string
  slug: string
  title: string
  description?: string | null
  sql: string
  parameters?: unknown
  chart?: unknown
  roles?: string[] | null
  _status?: 'draft' | 'published' | null
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

function summarise(doc: ReportDoc): ReportSummary {
  const params = reportParametersSchema.safeParse(doc.parameters ?? [])
  const chart = chartSpecSchema.safeParse(doc.chart)
  return {
    id: String(doc.id),
    slug: doc.slug,
    title: doc.title,
    description: doc.description ?? null,
    parameters: params.success ? params.data : [],
    chart: chart.success ? chart.data : null,
  }
}

/** Published reports the user may run, by title. */
export async function listReports(payload: Payload, user: unknown): Promise<ReportSummary[]> {
  const found = await payload.find({
    collection: 'report-definitions',
    where: { _status: { equals: 'published' } },
    sort: 'title',
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })
  return (found.docs as unknown as ReportDoc[])
    .filter((doc) => canRunReport(user, doc.roles))
    .map(summarise)
}

async function findReport(
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
async function publishedVersionId(payload: Payload, reportId: string): Promise<string> {
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

interface RunLogEntry {
  reportSlug: string
  report?: string
  version?: string
  parameters?: unknown
  outcome: 'ok' | 'timeout' | 'refused' | 'error'
  errorCode?: string
  durationMs?: number
  rowCount?: number
  truncated?: boolean
}

async function logRun(payload: Payload, user: unknown, entry: RunLogEntry): Promise<void> {
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
  input: { parameters?: Record<string, unknown>; draft?: boolean },
  options: RunOptions = {},
): Promise<RunOutcome> {
  const author = isReportAuthor(user)
  const draft = input.draft === true
  if (draft && !author) {
    await logRun(payload, user, { reportSlug: slug, outcome: 'refused', errorCode: 'FORBIDDEN' })
    return forbidden()
  }

  const doc = await findReport(payload, slug, draft)
  if (!doc) {
    return {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'There is no published report at this link.' } },
    }
  }
  const base = { reportSlug: doc.slug, report: String(doc.id) }

  if (!canRunReport(user, doc.roles)) {
    await logRun(payload, user, { ...base, outcome: 'refused', errorCode: 'FORBIDDEN' })
    return forbidden()
  }

  const params = reportParametersSchema.safeParse(doc.parameters ?? [])
  if (!params.success) {
    await logRun(payload, user, { ...base, outcome: 'error', errorCode: 'BAD_DEFINITION' })
    return {
      status: 500,
      body: { error: { code: 'BAD_DEFINITION', message: 'This report is set up incorrectly.' } },
    }
  }
  const submitted = input.parameters ?? {}
  const bound = bindParameters(params.data, submitted)
  if (!bound.ok) {
    await logRun(payload, user, {
      ...base,
      parameters: submitted,
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
  const parameters = Object.fromEntries(params.data.map((p, i) => [p.name, bound.values[i]]))
  const version = draft ? 'draft' : await publishedVersionId(payload, String(doc.id))

  try {
    const result = await runReportSql(doc.sql, bound.values, options)
    await logRun(payload, user, {
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
    await logRun(payload, user, {
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
