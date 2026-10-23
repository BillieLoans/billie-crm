/**
 * The Reports home's headline numbers: the first headline of each featured
 * report the user can run, on its default period, with its change on the
 * previous period and a sparkline when the report is a time series.
 *
 * Results are shared across users for a minute (they are aggregates, and
 * the same for everyone who can run the report), and requests that arrive
 * together share one run. Access is checked for each user before a cached
 * result is used.
 */
import type { Payload } from 'payload'
import { resolveColumns, splitRows, toNumber, type Change } from '@/lib/reports/columns'
import { computeHeadline } from '@/lib/reports/headline'
import { previousPeriodLabel } from '@/lib/reports/periods'
import type { ReportCategory } from '@/lib/schemas/reports'
import { listReports, runReport, type ReportRunResponse, type ReportSummary } from './run-report'
import type { RunOptions } from './runner'

export interface HomeTile {
  slug: string
  title: string
  category: ReportCategory
  label: string
  text: string
  change: Change | null
  /** "the previous 30 days", when there is a change. */
  previousLabel?: string
  /** The headline column over time, oldest first, when the report is a time series. */
  spark: number[] | null
}

const CACHE_MS = 60_000
/** Results by report and definition, shared by concurrent requests while they run. */
const cache = new Map<string, { at: number; body: Promise<ReportRunResponse | null> }>()

/** Tests only. */
export function resetHomeCache(): void {
  cache.clear()
}

/**
 * A cache key that changes when the report does: a republished headline,
 * column settings, chart or parameters never meets an old result.
 */
function cacheKey(report: ReportSummary): string {
  return JSON.stringify([
    report.slug,
    report.headline,
    report.columns,
    report.charts,
    report.parameters,
  ])
}

function runFeatured(
  payload: Payload,
  user: unknown,
  report: ReportSummary,
  options: RunOptions,
): Promise<ReportRunResponse | null> {
  const key = cacheKey(report)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body
  const body = runReport(
    payload,
    user,
    report.slug,
    { parameters: {}, compare: true, trigger: 'home' },
    options,
  ).then((outcome) => {
    // A failure is not kept: the next request tries again.
    if (outcome.status !== 200) cache.delete(key)
    return outcome.status === 200 ? outcome.body : null
  })
  body.catch(() => cache.delete(key))
  cache.set(key, { at: Date.now(), body })
  return body
}

/** A time-series sparkline: the column's values by the first chart's date axis. */
function sparkline(
  report: ReportSummary,
  body: ReportRunResponse,
  column: string,
): number[] | null {
  const chart = report.charts[0]
  const x = chart?.x
  if (!x || body.columns.find((c) => c.name === x)?.kind !== 'date') return null
  const { body: rows } = splitRows(body.columns, body.rows)
  const points = [...rows]
    .sort((a, b) => String(a[x]).localeCompare(String(b[x])))
    .map((row) => toNumber(row[column]))
    .filter((v): v is number => v !== null)
  return points.length >= 2 ? points : null
}

export async function homeTiles(
  payload: Payload,
  user: unknown,
  options: RunOptions = {},
): Promise<HomeTile[]> {
  const featured = (await listReports(payload, user)).filter(
    (r) => r.published && r.featured && r.headline.length > 0,
  )
  const results = await Promise.all(
    featured.map(async (report): Promise<HomeTile | null> => {
      try {
        const body = await runFeatured(payload, user, report, options)
        if (!body) return null
        const views = resolveColumns(body.columns, report.columns)
        const [tile] = computeHeadline(
          report.headline.slice(0, 1),
          views,
          body.columns,
          body.rows,
          body.previous?.rows ?? null,
        )
        if (!tile || tile.value === null) return null
        return {
          slug: report.slug,
          title: report.title,
          category: report.category,
          label: tile.label,
          text: tile.text,
          change: tile.change,
          previousLabel: body.previous
            ? previousPeriodLabel(body.previous.from, body.previous.to)
            : undefined,
          spark: sparkline(report, body, tile.column),
        }
      } catch (error) {
        console.error(`[reports] home tile for ${report.slug} failed:`, error)
        return null
      }
    }),
  )
  return results.filter((t): t is HomeTile => t !== null)
}
