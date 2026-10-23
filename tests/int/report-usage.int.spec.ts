/**
 * Integration coverage for the Reports usage figures, from the run, event
 * and ask logs in the real Postgres. Rows are dated in 2030 and read with a
 * 2030 clock, so other tests' rows never fall in the window.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import type { Pool } from 'pg'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { reportUsage } from '@/server/reporting/usage'

let payload: Payload
let pool: Pool
const PREFIX = 'rptuse'
const NOW = new Date('2030-03-15T00:00:00Z')
const users: string[] = []
let author: { id: string; role: string }

async function cleanup() {
  await pool.query(`DELETE FROM report_runs WHERE report_slug LIKE '${PREFIX}%'`)
  await pool.query(`DELETE FROM report_subscriptions WHERE user_id IN
    (SELECT id FROM users WHERE email LIKE '${PREFIX}-%')`)
  await pool.query(`DELETE FROM report_events WHERE created_at >= '2030-01-01'`)
  await pool.query(`DELETE FROM report_asks WHERE created_at >= '2030-01-01'`)
  const defs = await payload.find({
    collection: 'report-definitions',
    where: { slug: { like: PREFIX } },
    limit: 100,
    overrideAccess: true,
  })
  for (const doc of defs.docs) {
    await payload.delete({ collection: 'report-definitions', id: doc.id, overrideAccess: true })
  }
  await pool.query(`DELETE FROM users WHERE email LIKE '${PREFIX}-%'`)
}

const run = (
  slug: string,
  user: string,
  at: string,
  trigger = 'view',
  outcome = 'ok',
  extra: { version?: string; comparison?: boolean } = {},
) =>
  pool.query(
    `INSERT INTO report_runs (report_slug, user_id, outcome, trigger, created_at, version, comparison)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [slug, user, outcome, trigger, at, extra.version ?? 'v1', extra.comparison ?? false],
  )
const event = (
  kind: string,
  user: string,
  at: string,
  extra: { slug?: string; query?: string } = {},
) =>
  pool.query(
    `INSERT INTO report_events (kind, user_id, report_slug, query, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [kind, user, extra.slug ?? null, extra.query ?? null, at],
  )
const ask = (kind: string, outcome: string, first: number | null, total: number | null) =>
  pool.query(
    `INSERT INTO report_asks (kind, outcome, first_output_ms, total_ms, created_at)
     VALUES ($1, $2, $3, $4, '2030-03-10T00:00:00Z')`,
    [kind, outcome, first, total],
  )

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as unknown as Pool
  await cleanup()
  for (const n of [1, 2]) {
    const user = await payload.create({
      collection: 'users',
      data: {
        email: `${PREFIX}-${n}-${Date.now()}@billie.loans`,
        password: 'Test1234!',
        role: 'operations',
        firstName: 'Use',
        lastName: String(n),
      },
    })
    users.push(String(user.id))
  }
  const sup = await payload.create({
    collection: 'users',
    data: {
      email: `${PREFIX}-author-${Date.now()}@billie.loans`,
      password: 'Test1234!',
      role: 'supervisor',
      firstName: 'Use',
      lastName: 'Author',
    },
  })
  author = { id: String(sup.id), role: 'supervisor' }
  const ids: Record<string, string> = {}
  for (const slug of [`${PREFIX}-read`, `${PREFIX}-ignored`]) {
    const doc = await payload.create({
      collection: 'report-definitions',
      data: {
        title: slug,
        slug,
        sql: 'SELECT 1 AS n',
        roles: ['operations'],
        _status: 'published',
      } as never,
      overrideAccess: true,
    })
    ids[slug] = String(doc.id)
  }
  const [a, b] = users
  // Week of 3 March: two people, three runs (one from a board).
  await run(`${PREFIX}-read`, a, '2030-03-04T01:00:00Z')
  await run(`${PREFIX}-read`, a, '2030-03-05T01:00:00Z', 'board')
  await run(`${PREFIX}-read`, b, '2030-03-06T01:00:00Z')
  // Not reads: a scheduled email, a failed run, an author's draft and the
  // previous-period run made for a comparison.
  await run(`${PREFIX}-ignored`, a, '2030-03-06T01:00:00Z', 'schedule')
  await run(`${PREFIX}-ignored`, a, '2030-03-06T02:00:00Z', 'view', 'error')
  await run(`${PREFIX}-ignored`, a, '2030-03-06T03:00:00Z', 'view', 'ok', { version: 'draft' })
  await run(`${PREFIX}-read`, a, '2030-03-06T01:00:00Z', 'view', 'ok', { comparison: true })
  // One person by email (a digest and an alert), and the Slack channel.
  for (const [kind, channel] of [
    ['digest', 'email'],
    ['alert', 'email'],
    ['digest', 'slack'],
  ]) {
    await pool.query(
      `INSERT INTO report_subscriptions (user_id, report_id, kind, channel) VALUES ($1, $2, $3, $4)`,
      [a, ids[`${PREFIX}-read`], kind, channel],
    )
  }
  await event('csv', a, '2030-03-04T01:05:00Z', { slug: `${PREFIX}-read` })
  // One search answered by an open, two not.
  await event('search', a, '2030-03-07T01:00:00Z', { query: 'Arrears' })
  await event('search_open', a, '2030-03-07T01:01:00Z', {
    query: 'arrears',
    slug: `${PREFIX}-read`,
  })
  // "chu" then "churn" a few seconds later is one search, for "churn".
  await event('search', b, '2030-03-07T01:59:50Z', { query: 'chu' })
  await event('search', b, '2030-03-07T02:00:00Z', { query: 'Churn ' })
  await event('search', a, '2030-03-08T02:00:00Z', { query: 'churn' })
  await ask('ask', 'ok', 1000, 20_000)
  await ask('ask', 'ok', 3000, 40_000)
  await ask('refine', 'cancelled', null, null)
  await ask('check', 'ok', null, 10)
  // Saved twice (a draft, then published): one report.
  await event('ask_save', a, '2030-03-10T01:00:00Z', { slug: `${PREFIX}-read` })
  await event('ask_save', a, '2030-03-10T01:05:00Z', { slug: `${PREFIX}-read` })
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('reportUsage', () => {
  it('counts people and reads in each of the last eight weeks, zeros included', async () => {
    const usage = await reportUsage(payload, author, NOW)
    expect(usage.weeks).toHaveLength(8)
    expect(usage.weeks[0].week).toBe('2030-01-21')
    expect(usage.weeks.at(-1)).toEqual({
      week: '2030-03-11',
      viewers: 0,
      runs: 0,
      runsPerViewer: null,
    })
    expect(usage.weeks.find((w) => w.week === '2030-03-04')).toEqual({
      week: '2030-03-04',
      viewers: 2,
      runs: 3,
      runsPerViewer: 1.5,
    })
  })

  it('reads each report’s runs, people, CSV and last open, and lists the unopened', async () => {
    const usage = await reportUsage(payload, author, NOW)
    const read = usage.reports.find((r) => r.slug === `${PREFIX}-read`)
    expect(read).toMatchObject({
      views: 3,
      viewers: 2,
      csv: 1,
      csvPerView: 1 / 3,
      subscribers: 1,
      lastViewed: '2030-03-06T01:00:00.000Z',
    })
    expect(usage.unopened.map((r) => r.slug)).toContain(`${PREFIX}-ignored`)
    expect(usage.unopened.map((r) => r.slug)).not.toContain(`${PREFIX}-read`)
  })

  it('times Ask Claude and counts saved drafts, leaving checks out', async () => {
    const { ask: a } = await reportUsage(payload, author, NOW)
    expect(a).toEqual({
      asks: 2,
      refines: 1,
      answered: 2,
      cancelled: 1,
      saves: 1,
      saveRate: 0.5,
      firstOutputP50: 2000,
      firstOutputP95: 2900,
      totalP50: 30_000,
      totalP95: 39_000,
    })
  })

  it('finds searches with no report opened soon after, grouped by what was typed', async () => {
    const { searches } = await reportUsage(payload, author, NOW)
    expect(searches).toEqual({ total: 3, unanswered: 2, top: [{ query: 'churn', searches: 2 }] })
  })
})
