/**
 * How Reports is used, for report authors: who opens reports each week,
 * which reports are read and which are not, how often data leaves as CSV,
 * how Ask Claude performs (time to first output and to a finished draft,
 * and how many drafts are saved), and what people search for without
 * opening anything. Read from the run, event and ask logs; aggregates only.
 */
import type { Payload } from 'payload'
import { getDashboardPool, toNumber } from '@/lib/dashboard-aggregates'
import { listPublishedReports } from './run-report'

/** The window for everything but the weekly trend. */
export const USAGE_DAYS = 30
export const USAGE_WEEKS = 8
/** A search counts as answered if the person opened a result this soon after. */
const SEARCH_OPEN_WINDOW = '10 minutes'
const TOP_SEARCHES = 20

export interface UsageWeek {
  /** Monday, Sydney. */
  week: string
  viewers: number
  runs: number
  runsPerViewer: number | null
}

export interface UsageReport {
  slug: string
  title: string
  views: number
  viewers: number
  csv: number
  /** CSV downloads per view. */
  csvPerView: number | null
  subscribers: number
  lastViewed: string | null
}

export interface UsageAsk {
  asks: number
  refines: number
  answered: number
  cancelled: number
  saves: number
  /** Saved drafts per answered question. */
  saveRate: number | null
  firstOutputP50: number | null
  firstOutputP95: number | null
  totalP50: number | null
  totalP95: number | null
}

export interface UsageSearch {
  query: string
  searches: number
}

export interface UsageSummary {
  days: number
  weeks: UsageWeek[]
  reports: UsageReport[]
  /** Published reports nobody opened in the window, by title. */
  unopened: Array<{ slug: string; title: string }>
  ask: UsageAsk
  searches: { total: number; unanswered: number; top: UsageSearch[] }
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
const optional = (v: unknown) => (v === null || v === undefined ? null : toNumber(v))

/** Reads: report-page and board runs that ran, not drafts or comparison runs. */
const READS = `outcome = 'ok' AND trigger IN ('view', 'board')
  AND version IS DISTINCT FROM 'draft' AND comparison IS NOT TRUE`

export async function reportUsage(
  payload: Payload,
  user: unknown,
  now: Date = new Date(),
): Promise<UsageSummary> {
  const pool = getDashboardPool(payload)
  if (!pool) throw new Error('The database pool is not available')
  const since = new Date(now.getTime() - USAGE_DAYS * 86_400_000).toISOString()

  const [weeks, runs, csv, subscribers, ask, saves, searches, published] = await Promise.all([
    // The last eight whole Sydney weeks (this one so far included), zeros kept.
    pool.query(
      `WITH bounds AS (
         SELECT date_trunc('week', $1::timestamptz AT TIME ZONE 'Australia/Sydney') AS this_week
       ), weeks AS (
         SELECT generate_series(this_week - interval '${USAGE_WEEKS - 1} weeks', this_week,
                                interval '1 week') AS week
           FROM bounds
       ), reads AS (
         SELECT date_trunc('week', created_at AT TIME ZONE 'Australia/Sydney') AS week, user_id
           FROM report_runs
          WHERE ${READS}
            AND created_at >= ((SELECT this_week FROM bounds) - interval '${USAGE_WEEKS - 1} weeks')
                              AT TIME ZONE 'Australia/Sydney'
       )
       SELECT to_char(w.week, 'YYYY-MM-DD') AS week,
              count(DISTINCT r.user_id) AS viewers,
              count(r.week) AS runs
         FROM weeks w LEFT JOIN reads r ON r.week = w.week
        GROUP BY w.week ORDER BY w.week`,
      [now.toISOString()],
    ),
    pool.query(
      `SELECT report_slug AS slug, count(*) AS views, count(DISTINCT user_id) AS viewers,
              max(created_at) AS last_viewed
         FROM report_runs
        WHERE created_at >= $1 AND ${READS}
        GROUP BY 1`,
      [since],
    ),
    pool.query(
      `SELECT report_slug AS slug, count(*) AS n FROM report_events
        WHERE kind = 'csv' AND created_at >= $1 GROUP BY 1`,
      [since],
    ),
    // People who get the report by email (a digest or an alert); the Slack
    // channel is not a person.
    pool.query(
      `SELECT report_id AS id, count(DISTINCT user_id) AS n FROM report_subscriptions
        WHERE report_id IS NOT NULL AND paused IS NOT TRUE AND channel = 'email'
        GROUP BY 1`,
    ),
    // Times are for drafts that finished (passing the checks or not), not
    // for cancelled, refused or failed requests.
    pool.query(
      `SELECT count(*) FILTER (WHERE kind = 'ask') AS asks,
              count(*) FILTER (WHERE kind = 'refine') AS refines,
              count(*) FILTER (WHERE kind = 'ask' AND outcome = 'ok') AS answered,
              count(*) FILTER (WHERE outcome = 'cancelled') AS cancelled,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY first_output_ms)
                FILTER (WHERE outcome IN ('ok', 'invalid')) AS first_p50,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY first_output_ms)
                FILTER (WHERE outcome IN ('ok', 'invalid')) AS first_p95,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY coalesce(total_ms, latency_ms))
                FILTER (WHERE outcome IN ('ok', 'invalid')) AS total_p50,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY coalesce(total_ms, latency_ms))
                FILTER (WHERE outcome IN ('ok', 'invalid')) AS total_p95
         FROM report_asks
        WHERE created_at >= $1 AND kind IN ('ask', 'refine')`,
      [since],
    ),
    // Recorded by the save route; a draft saved again is one report.
    pool.query(
      `SELECT count(DISTINCT report_slug) AS n FROM report_events
        WHERE kind = 'ask_save' AND created_at >= $1`,
      [since],
    ),
    // A search is what the person settled on: the last query they typed
    // before a pause of two minutes, unanswered if they opened no report in
    // the ten minutes after it.
    pool.query(
      `WITH searches AS (
         SELECT s.user_id, s.created_at, lower(trim(s.query)) AS query,
                lead(s.created_at) OVER (PARTITION BY s.user_id ORDER BY s.created_at) AS next_at
           FROM report_events s
          WHERE s.kind = 'search' AND s.created_at >= $1 AND s.query IS NOT NULL
       ), settled AS (
         SELECT * FROM searches
          WHERE next_at IS NULL OR next_at > created_at + interval '2 minutes'
       )
       SELECT query,
              count(*) AS searches,
              count(*) FILTER (WHERE NOT EXISTS (
                SELECT 1 FROM report_events o
                 WHERE o.kind = 'search_open'
                   AND o.user_id IS NOT DISTINCT FROM settled.user_id
                   AND o.created_at >= settled.created_at
                   AND o.created_at <= settled.created_at + interval '${SEARCH_OPEN_WINDOW}'
              )) AS unanswered
         FROM settled
        GROUP BY 1`,
      [since],
    ),
    listPublishedReports(payload, user),
  ])

  const runsBySlug = new Map(runs.rows.map((r) => [String(r.slug), r]))
  const csvBySlug = new Map(csv.rows.map((r) => [String(r.slug), toNumber(r.n)]))
  const subsById = new Map(subscribers.rows.map((r) => [String(r.id), toNumber(r.n)]))

  const reports: UsageReport[] = published
    .map((doc) => {
      const r = runsBySlug.get(doc.slug)
      const views = toNumber(r?.views)
      const downloads = csvBySlug.get(doc.slug) ?? 0
      return {
        slug: doc.slug,
        title: doc.title,
        views,
        viewers: toNumber(r?.viewers),
        csv: downloads,
        csvPerView: ratio(downloads, views),
        subscribers: subsById.get(doc.id) ?? 0,
        lastViewed: r?.last_viewed ? new Date(r.last_viewed as string).toISOString() : null,
      }
    })
    .sort((a, b) => b.views - a.views || a.title.localeCompare(b.title, 'en-AU'))

  const a = ask.rows[0] ?? {}
  const answered = toNumber(a.answered)
  const saved = toNumber(saves.rows[0]?.n)
  const bySearch = searches.rows.map((r) => ({
    query: String(r.query),
    searches: toNumber(r.searches),
    unanswered: toNumber(r.unanswered),
  }))

  return {
    days: USAGE_DAYS,
    weeks: weeks.rows.map((w) => {
      const viewers = toNumber(w.viewers)
      const total = toNumber(w.runs)
      return { week: String(w.week), viewers, runs: total, runsPerViewer: ratio(total, viewers) }
    }),
    reports,
    unopened: reports.filter((r) => r.views === 0).map((r) => ({ slug: r.slug, title: r.title })),
    ask: {
      asks: toNumber(a.asks),
      refines: toNumber(a.refines),
      answered,
      cancelled: toNumber(a.cancelled),
      saves: saved,
      saveRate: ratio(saved, answered),
      firstOutputP50: optional(a.first_p50),
      firstOutputP95: optional(a.first_p95),
      totalP50: optional(a.total_p50),
      totalP95: optional(a.total_p95),
    },
    searches: {
      total: bySearch.reduce((sum, s) => sum + s.searches, 0),
      unanswered: bySearch.reduce((sum, s) => sum + s.unanswered, 0),
      top: bySearch
        .filter((s) => s.unanswered > 0)
        .sort((x, y) => y.unanswered - x.unanswered || x.query.localeCompare(y.query))
        .slice(0, TOP_SEARCHES)
        .map((s) => ({ query: s.query, searches: s.unanswered })),
    },
  }
}
