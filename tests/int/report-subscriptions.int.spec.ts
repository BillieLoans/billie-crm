/**
 * Integration coverage for report emails and alerts, against the real
 * Postgres with the runner logged in as `reporting_reader`: creating a
 * subscription checks access and settings; the daily job sends what is
 * due once (the claim holds on a repeat), runs as the subscriber, carries
 * the headline, chart and CSV, sends an alert only when it starts to hold,
 * posts authors' subscriptions to Slack, and retries a failed send.
 * Email and Slack are mocked.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from 'vitest'
import type { Pool } from 'pg'

const sendStaffEmail = vi.fn()
vi.mock('@/server/email/staff-email', async () => ({
  ...(await vi.importActual<typeof import('@/server/email/staff-email')>(
    '@/server/email/staff-email',
  )),
  sendStaffEmail: (...a: unknown[]) => sendStaffEmail(...a),
  staffEmailConfigured: () => true,
}))

import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { reportingReaderPool } from '../utils/reportingReader'
import { deliverSubscriptions } from '@/server/reporting/deliveries'
import {
  SubscriptionError,
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  setPaused,
} from '@/server/reporting/subscriptions'
import { MAX_SUBSCRIPTIONS_PER_USER } from '@/lib/reports/subscriptions'

let payload: Payload
let pool: Pool
let reader: Pool
const PREFIX = 'rptsub'
const users: Record<string, { id: string; role: string }> = {}
const APP = 'https://crm.example'
/** Monday 26 October 2026, 08:00 in Sydney. */
const MONDAY = new Date('2026-10-25T21:00:00Z')
const TUESDAY = new Date('2026-10-26T21:00:00Z')

async function makeUser(role: string) {
  const user = await payload.create({
    collection: 'users',
    data: {
      email: `${PREFIX}-${role}-${Date.now()}@billie.loans`,
      password: 'Test1234!',
      role: role as 'admin',
      firstName: 'Sub',
      lastName: role,
    },
  })
  return { id: String(user.id), role }
}

async function cleanup() {
  await pool.query(`DELETE FROM report_deliveries WHERE subscription_id IN
    (SELECT s.id FROM report_subscriptions s JOIN users u ON u.id = s.user_id WHERE u.email LIKE '${PREFIX}-%')`)
  await pool.query(`DELETE FROM report_subscriptions WHERE user_id IN
    (SELECT id FROM users WHERE email LIKE '${PREFIX}-%')`)
  await pool.query(`DELETE FROM report_runs WHERE report_slug LIKE '${PREFIX}%'`)
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

const deliver = (now: Date) =>
  deliverSubscriptions(payload, { now, appUrl: APP, runOptions: { pool: reader } })

/** Only this file's subscriptions' results (other tests' rows may share the table). */
async function ours(ids: string[], now: Date) {
  const summary = await deliver(now)
  return summary.results.filter((r) => ids.includes(r.id))
}

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as unknown as Pool
  reader = await reportingReaderPool(pool)
  await cleanup()
  for (const role of ['admin', 'operations', 'readonly']) users[role] = await makeUser(role)
  await payload.create({
    collection: 'report-definitions',
    data: {
      title: 'Daily applications',
      slug: `${PREFIX}-daily`,
      sql: `SELECT d::date AS day, extract(day FROM d)::int AS applications
            FROM generate_series($1::date, $2::date, interval '1 day') AS d ORDER BY 1`,
      parameters: [
        { name: 'from', label: 'From', type: 'date', required: true, default: 'today-7' },
        { name: 'to', label: 'To', type: 'date', required: true, default: 'today-1' },
      ],
      chart: { type: 'line', x: 'day', series: [{ column: 'applications' }] },
      headline: [{ column: 'applications', label: 'Applications', value: 'sum' }],
      roles: ['operations'],
      _status: 'published',
    } as never,
    overrideAccess: true,
  })
  await payload.create({
    collection: 'report-definitions',
    data: {
      title: 'Decline rate by source',
      slug: `${PREFIX}-declines`,
      sql: `SELECT segment, decline_rate FROM (VALUES ('Paid', 0.42::numeric, 1),
              ('Organic', 0.2::numeric, 2), ('All', 0.35::numeric, 3)) AS t(segment, decline_rate, o)
            ORDER BY o`,
      parameters: [],
      roles: ['operations'],
      _status: 'published',
    } as never,
    overrideAccess: true,
  })
}, 60_000)

afterAll(async () => {
  await cleanup()
  await reader?.end()
  vi.unstubAllGlobals()
  delete process.env.REPORTS_SLACK_WEBHOOK_URL
})

beforeEach(async () => {
  delete process.env.REPORTS_EMAIL_LABEL
  sendStaffEmail.mockReset().mockResolvedValue('email-id')
  await pool.query(`DELETE FROM report_deliveries WHERE subscription_id IN
    (SELECT s.id FROM report_subscriptions s JOIN users u ON u.id = s.user_id WHERE u.email LIKE '${PREFIX}-%')`)
  await pool.query(`DELETE FROM report_subscriptions WHERE user_id IN
    (SELECT id FROM users WHERE email LIKE '${PREFIX}-%')`)
})

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return (error as SubscriptionError).code
  }
  throw new Error('expected a refusal')
}

describe('subscribing', () => {
  it('checks the report, the settings, Slack and the limit', async () => {
    const ops = users.operations
    const digest = {
      kind: 'digest',
      frequency: 'weekly',
      parameters: {},
      channel: 'email',
    } as const
    // A report not shared with readonly is not found.
    expect(
      await errorCode(
        createSubscription(payload, users.readonly, { ...digest, slug: `${PREFIX}-daily` }),
      ),
    ).toBe('NOT_FOUND')
    // Slack is for authors.
    process.env.REPORTS_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x'
    expect(
      await errorCode(
        createSubscription(payload, ops, { ...digest, slug: `${PREFIX}-daily`, channel: 'slack' }),
      ),
    ).toBe('NO_SLACK')
    // A preset that does not exist.
    expect(
      await errorCode(
        createSubscription(payload, ops, { ...digest, slug: `${PREFIX}-daily`, range: 'forever' }),
      ),
    ).toBe('BAD_RANGE')
    // "This month" runs to today: barely begun when emails go at 7am.
    expect(
      await errorCode(
        createSubscription(payload, ops, {
          ...digest,
          slug: `${PREFIX}-daily`,
          range: 'this-month',
        }),
      ),
    ).toBe('BAD_RANGE')

    const view = await createSubscription(payload, ops, {
      ...digest,
      slug: `${PREFIX}-daily`,
      // Dates and undeclared keys are dropped: the preset sets the period.
      parameters: { from: '2020-01-01', junk: 'x' },
    })
    expect(view).toMatchObject({
      title: 'Daily applications',
      frequency: 'weekly',
      range: 'last-7',
      rangeLabel: 'Last 7 days',
      parameters: {},
    })
    expect(
      await errorCode(createSubscription(payload, ops, { ...digest, slug: `${PREFIX}-daily` })),
    ).toBe('ALREADY_SUBSCRIBED')
  })

  it(`allows ${MAX_SUBSCRIPTIONS_PER_USER} per person`, async () => {
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_USER; i++) {
      await payload.create({
        collection: 'report-subscriptions',
        data: {
          user: users.admin.id,
          kind: 'alert',
          channel: 'email',
          alert: { column: 'x', operator: 'above', threshold: i },
        } as never,
        overrideAccess: true,
      })
    }
    expect(
      await errorCode(
        createSubscription(payload, users.admin, {
          kind: 'alert',
          slug: `${PREFIX}-declines`,
          parameters: {},
          channel: 'email',
          alert: { column: 'decline_rate', operator: 'above', threshold: 0.4 },
        }),
      ),
    ).toBe('TOO_MANY')
  })

  it('lists, pauses and removes only your own', async () => {
    const mine = await createSubscription(payload, users.operations, {
      kind: 'alert',
      slug: `${PREFIX}-declines`,
      parameters: {},
      channel: 'email',
      alert: { column: 'decline_rate', row: 'Paid', operator: 'above', threshold: 0.4 },
    })
    expect(mine.alert).toBe('Decline rate (Paid) above 40%')
    expect((await listSubscriptions(payload, users.admin)).map((s) => s.id)).not.toContain(mine.id)
    expect(await errorCode(setPaused(payload, users.admin, mine.id, true))).toBe('NOT_FOUND')
    expect(await errorCode(deleteSubscription(payload, users.admin, mine.id))).toBe('NOT_FOUND')
    await setPaused(payload, users.operations, mine.id, true)
    expect((await listSubscriptions(payload, users.operations))[0].paused).toBe(true)
    await deleteSubscription(payload, users.operations, mine.id)
    expect(await listSubscriptions(payload, users.operations)).toEqual([])
  })
})

describe('the deliveries job', () => {
  it('sends a weekly digest on Monday, once, with the headline, chart and CSV', async () => {
    const sub = await createSubscription(payload, users.operations, {
      kind: 'digest',
      slug: `${PREFIX}-daily`,
      frequency: 'weekly',
      parameters: {},
      channel: 'email',
    })
    expect(await ours([sub.id], TUESDAY)).toEqual([])
    expect(await ours([sub.id], MONDAY)).toEqual([{ id: sub.id, status: 'sent' }])
    expect(sendStaffEmail).toHaveBeenCalledTimes(1)
    const [email, key] = sendStaffEmail.mock.calls[0]
    expect(email.to).toEqual([expect.stringMatching(/^rptsub-operations-/)])
    // 19 to 25 October: the days of the month add up to 154.
    expect(email.subject).toBe('Daily applications: Applications 154 (2026-10-26)')
    expect(email.html).toContain('Last 7 days: 19 Oct 2026 to 25 Oct 2026')
    expect(email.html).toContain('cid:report-chart')
    expect(email.html).toContain(
      `${APP}/admin/reports/${PREFIX}-daily?from=2026-10-19&amp;to=2026-10-25&amp;_compare=1`,
    )
    expect(email.html).toContain('You asked for this report on Monday mornings.')
    expect(email.html).toContain('Applications was 154, up 46.7% on the previous 7 days.')
    expect(email.html).toContain(`${APP}/admin/reports/subscriptions`)
    const [chart, csv] = email.attachments
    expect(chart).toMatchObject({ contentType: 'image/png', contentId: 'report-chart' })
    expect(Buffer.from(chart.contentBase64, 'base64').subarray(1, 4).toString()).toBe('PNG')
    expect(Buffer.from(csv.contentBase64, 'base64').toString()).toContain('2026-10-25,25')
    expect(key).toBe(`report-sub-${sub.id}-2026-10-26`)

    // Run as the subscriber, logged as a subscription run.
    const runs = await pool.query(
      `SELECT trigger, user_id FROM report_runs WHERE report_slug = $1 ORDER BY created_at DESC LIMIT 1`,
      [`${PREFIX}-daily`],
    )
    expect(runs.rows[0]).toEqual({ trigger: 'subscription', user_id: users.operations.id })

    // A repeat the same morning sends nothing.
    expect(await ours([sub.id], MONDAY)).toEqual([{ id: sub.id, status: 'already_done' }])
    expect(sendStaffEmail).toHaveBeenCalledTimes(1)
    expect((await listSubscriptions(payload, users.operations))[0].lastSentAt).toBe(
      MONDAY.toISOString(),
    )
  })

  it('retries a failed send on the next call', async () => {
    const sub = await createSubscription(payload, users.operations, {
      kind: 'digest',
      slug: `${PREFIX}-daily`,
      frequency: 'daily',
      parameters: {},
      channel: 'email',
    })
    sendStaffEmail.mockRejectedValueOnce(new Error('Resend down'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await ours([sub.id], TUESDAY)).toEqual([
      { id: sub.id, status: 'failed', detail: 'EMAIL_FAILED' },
    ])
    expect(await ours([sub.id], TUESDAY)).toEqual([{ id: sub.id, status: 'sent' }])
    vi.mocked(console.error).mockRestore()
  })

  it('stops sending when the subscriber can no longer run the report', async () => {
    const sub = await createSubscription(payload, users.operations, {
      kind: 'digest',
      slug: `${PREFIX}-daily`,
      frequency: 'daily',
      parameters: {},
      channel: 'email',
    })
    await pool.query(`UPDATE users SET role = 'readonly' WHERE id = $1`, [users.operations.id])
    try {
      expect(await ours([sub.id], TUESDAY)).toEqual([
        { id: sub.id, status: 'skipped', detail: 'NO_ACCESS' },
      ])
      expect(sendStaffEmail).not.toHaveBeenCalled()
      const [view] = await listSubscriptions(payload, users.operations)
      expect(view.lastError).toBe('You can no longer run this report.')
    } finally {
      await pool.query(`UPDATE users SET role = 'operations' WHERE id = $1`, [users.operations.id])
    }
  })

  it('sends an alert when it starts to hold, not every day it holds', async () => {
    const sub = await createSubscription(payload, users.operations, {
      kind: 'alert',
      slug: `${PREFIX}-declines`,
      parameters: {},
      channel: 'email',
      alert: { column: 'decline_rate', row: 'Paid', operator: 'above', threshold: 0.4 },
    })
    expect(await ours([sub.id], MONDAY)).toEqual([{ id: sub.id, status: 'sent' }])
    expect(sendStaffEmail.mock.calls[0][0].subject).toBe(
      'Alert: Decline rate (Paid) above 40% (Decline rate by source)',
    )
    expect(sendStaffEmail.mock.calls[0][0].html).toContain(
      'Decline rate (Paid) is 42%, above your threshold of 40%.',
    )
    // Still above the next day: checked, not sent.
    expect(await ours([sub.id], TUESDAY)).toEqual([{ id: sub.id, status: 'checked' }])
    expect(sendStaffEmail).toHaveBeenCalledTimes(1)
    const [view] = await listSubscriptions(payload, users.operations)
    expect(view).toMatchObject({ alertActive: true, lastValue: '42%' })
  })

  it('posts an author’s subscription to Slack', async () => {
    process.env.REPORTS_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x'
    const posts: Array<{ url: string; body: { text: string; blocks: unknown[] } }> = []
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url.startsWith('https://hooks.slack.test')) {
        posts.push({ url, body: JSON.parse(init.body as string) })
        return new Response('ok')
      }
      return realFetch(url, init)
    })
    try {
      const sub = await createSubscription(payload, users.admin, {
        kind: 'digest',
        slug: `${PREFIX}-daily`,
        frequency: 'daily',
        parameters: {},
        channel: 'slack',
      })
      expect(await ours([sub.id], TUESDAY)).toEqual([{ id: sub.id, status: 'sent' }])
      expect(sendStaffEmail).not.toHaveBeenCalled()
      expect(posts).toHaveLength(1)
      // 20 to 26 October.
      expect(JSON.stringify(posts[0].body.blocks)).toContain('*Applications:* 161')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('shares one run between subscribers to the same report and settings', async () => {
    const one = await createSubscription(payload, users.operations, {
      kind: 'digest',
      slug: `${PREFIX}-daily`,
      frequency: 'daily',
      parameters: {},
      channel: 'email',
    })
    const two = await createSubscription(payload, users.admin, {
      kind: 'digest',
      slug: `${PREFIX}-daily`,
      frequency: 'daily',
      parameters: {},
      channel: 'email',
    })
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM report_runs WHERE report_slug = $1`,
      [`${PREFIX}-daily`],
    )
    expect(await ours([one.id, two.id], TUESDAY)).toEqual(
      expect.arrayContaining([
        { id: one.id, status: 'sent' },
        { id: two.id, status: 'sent' },
      ]),
    )
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM report_runs WHERE report_slug = $1`,
      [`${PREFIX}-daily`],
    )
    // One run and its previous period, not two of each.
    expect(after.rows[0].n - before.rows[0].n).toBe(2)
    expect(sendStaffEmail).toHaveBeenCalledTimes(2)
  })

  it('takes over a claim a dead call left behind, and leaves a live one alone', async () => {
    const sub = await createSubscription(payload, users.operations, {
      kind: 'digest',
      slug: `${PREFIX}-daily`,
      frequency: 'weekly',
      parameters: {},
      channel: 'email',
    })
    const claimKey = `${sub.id}:2026-10-26`
    await payload.create({
      collection: 'report-deliveries',
      data: { subscription: sub.id, claimKey, status: 'sending' } as never,
      overrideAccess: true,
    })
    const claimedAgo = (minutes: number) =>
      pool.query(`UPDATE report_deliveries SET created_at = $1 WHERE claim_key = $2`, [
        new Date(MONDAY.getTime() - minutes * 60_000).toISOString(),
        claimKey,
      ])
    // Claimed five minutes ago: another call may be at work.
    await claimedAgo(5)
    expect(await ours([sub.id], MONDAY)).toEqual([{ id: sub.id, status: 'already_done' }])
    // An hour ago and still sending: that call died, so this one sends.
    await claimedAgo(60)
    expect(await ours([sub.id], MONDAY)).toEqual([{ id: sub.id, status: 'sent' }])
    expect(sendStaffEmail).toHaveBeenCalledTimes(1)
  })

  it('keeps an alert’s state through a period with no value', async () => {
    const sub = await createSubscription(payload, users.operations, {
      kind: 'alert',
      slug: `${PREFIX}-declines`,
      parameters: {},
      channel: 'email',
      alert: { column: 'decline_rate', row: 'Paid', operator: 'above', threshold: 0.4 },
    })
    expect(await ours([sub.id], MONDAY)).toEqual([{ id: sub.id, status: 'sent' }])
    // The row disappears for a day (no value), then comes back still above.
    await pool.query(`UPDATE report_subscriptions SET alert_row = 'Gone' WHERE id = $1`, [sub.id])
    expect(await ours([sub.id], TUESDAY)).toEqual([{ id: sub.id, status: 'checked' }])
    await pool.query(`UPDATE report_subscriptions SET alert_row = 'Paid' WHERE id = $1`, [sub.id])
    expect(await ours([sub.id], new Date('2026-10-27T21:00:00Z'))).toEqual([
      { id: sub.id, status: 'checked' },
    ])
    expect(sendStaffEmail).toHaveBeenCalledTimes(1)
  })

  it('counts a send Resend already took (409 on the key) as sent', async () => {
    const { StaffEmailError } = await vi.importActual<typeof import('@/server/email/staff-email')>(
      '@/server/email/staff-email',
    )
    const sub = await createSubscription(payload, users.operations, {
      kind: 'digest',
      slug: `${PREFIX}-daily`,
      frequency: 'daily',
      parameters: {},
      channel: 'email',
    })
    sendStaffEmail.mockRejectedValueOnce(new StaffEmailError('Resend refused: 409', 409))
    expect(await ours([sub.id], TUESDAY)).toEqual([{ id: sub.id, status: 'sent' }])
  })
})
