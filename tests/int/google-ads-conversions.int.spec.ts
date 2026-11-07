/**
 * BTB-546: the Google Ads conversion outbox against a real Postgres, with a
 * fake Data Manager client.
 *
 * Done-when from the ticket: repeated runs and concurrent senders produce
 * exactly one upload per (application, conversion). The Data Manager API
 * cannot retract, so an approval is held for 48 hours and anything that
 * revises it in that time cancels it unsent.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { getDashboardPool, type QueryablePool } from '@/lib/dashboard-aggregates'
import {
  GoogleAdsRequestError,
  type ConversionEvent,
  type GoogleAdsConversionsClient,
  type IngestResult,
} from '@/server/google-ads/client'
import type { GoogleAdsConfig } from '@/server/google-ads/config'
import { claimDueRows, fillOutbox, runGoogleAdsConversions } from '@/server/google-ads/conversions'

const P = 'btb546'
const HOUR = 3_600_000

const CONFIG: GoogleAdsConfig = {
  mode: 'live',
  customerId: '9789998894',
  loginCustomerId: null,
  oauthClientId: 'x',
  oauthClientSecret: 'x',
  oauthRefreshToken: 'x',
  conversionActions: { approved: '111', funded: '222' },
}

class FakeGoogle implements GoogleAdsConversionsClient {
  sent: Array<ConversionEvent & { validateOnly: boolean }> = []
  calls = 0
  respond: (event: ConversionEvent) => IngestResult = () => ({ ok: true })
  failRequest: string | null = null

  async ingestConversion(event: ConversionEvent, { validateOnly = false } = {}) {
    this.calls += 1
    // Let a concurrent run reach its claim while this one is "on the wire".
    await new Promise((r) => setTimeout(r, 10))
    if (this.failRequest) throw new GoogleAdsRequestError(this.failRequest, 'fake')
    const result = this.respond(event)
    if (result.ok) this.sent.push({ ...event, validateOnly })
    return result
  }

  sentFor(app: string) {
    return this.sent.filter((u) => u.transactionId === app)
  }
}

let payload: Payload
let pool: QueryablePool
let google: FakeGoogle

const ago = (hours: number) => new Date(Date.now() - hours * HOUR)

async function application(
  n: string,
  opts: { attribution?: Record<string, string> | null } = {},
): Promise<{ conv: string; app: string }> {
  const conv = `${P}-conv-${n}`
  const app = `${P}-APP-${n}`
  const attribution =
    opts.attribution === undefined
      ? { gclid: `${P}-gclid-${n}`, received_at: ago(96).toISOString() }
      : opts.attribution
  await pool.query(
    `INSERT INTO conversations
       (conversation_id, application_number, status, started_at, updated_at, created_at, attribution)
     VALUES ($1, $2, 'approved', $3, now(), now(), $4::jsonb)`,
    [conv, app, ago(96), attribution ? JSON.stringify(attribution) : null],
  )
  return { conv, app }
}

async function decide(
  conv: string,
  app: string,
  decision: string,
  hoursAgo: number,
  mock = false,
): Promise<void> {
  await pool.query(
    `INSERT INTO reporting.decision_event
       (decision_key, conversation_id, application_number, decision, decided_at, mock_origin)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [`${conv}:${decision}:${hoursAgo}`, conv, app, decision, ago(hoursAgo), mock],
  )
}

async function fund(app: string, hoursAgo: number): Promise<void> {
  await pool.query(
    `INSERT INTO loan_accounts (loan_account_id, account_number, account_status,
                                application_number, loan_terms_disbursed_date)
     VALUES ($1, $2, 'active', $3, $4)`,
    [`${P}-loan-${app}`, `ACC-${app}`.slice(0, 30), app, ago(hoursAgo)],
  )
}

async function rowsFor(app: string) {
  const { rows } = await pool.query(
    `SELECT conversion_name, action, status, status_reason, attempts::int AS attempts,
            last_error_code, sent_at, validated_at, not_before
       FROM google_ads_conversions WHERE application_number = $1
      ORDER BY conversion_name, action`,
    [app],
  )
  return rows
}

/** Make every pending row for the application due now (as if time had passed). */
async function makeDue(app: string): Promise<void> {
  await pool.query(
    `UPDATE google_ads_conversions SET not_before = now() - interval '1 second'
      WHERE application_number = $1 AND status = 'pending'`,
    [app],
  )
}

const run = (cfg: GoogleAdsConfig = CONFIG) => runGoogleAdsConversions(pool, google, cfg)

async function cleanUp(): Promise<void> {
  await pool.query(`DELETE FROM google_ads_conversions WHERE application_number LIKE '${P}%'`)
  await pool.query(`DELETE FROM reporting.decision_event WHERE conversation_id LIKE '${P}%'`)
  await pool.query(`DELETE FROM loan_accounts WHERE loan_account_id LIKE '${P}%'`)
  await pool.query(`DELETE FROM conversations WHERE conversation_id LIKE '${P}%'`)
}

describe('Google Ads conversion outbox (real SQL)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config })
    pool = getDashboardPool(payload)!
    await cleanUp()
  })
  afterAll(cleanUp)
  beforeEach(() => {
    google = new FakeGoogle()
  })

  it('sends an approval that has stood for 48 hours once across repeated runs', async () => {
    const { conv, app } = await application('once')
    await decide(conv, app, 'APPROVED', 72)

    await run()
    await fillOutbox(pool)
    await run()
    await run()

    expect(google.sentFor(app)).toEqual([
      expect.objectContaining({
        clickIdType: 'gclid',
        clickId: `${P}-gclid-once`,
        conversionActionId: '111',
        transactionId: app,
        validateOnly: false,
      }),
    ])
    const [row] = await rowsFor(app)
    expect(row).toMatchObject({ conversion_name: 'approved', status: 'sent', attempts: 1 })
    expect(row.sent_at).toBeTruthy()
  })

  it('holds an approval for 48 hours, but sends a funded loan straight away', async () => {
    const { conv, app } = await application('hold')
    await decide(conv, app, 'APPROVED', 24)
    await fund(app, 20)

    await run()

    expect(google.sentFor(app).map((e) => e.conversionActionId)).toEqual(['222'])
    const rows = await rowsFor(app)
    expect(rows.map((r) => [r.conversion_name, r.status])).toEqual([
      ['approved', 'pending'],
      ['funded', 'sent'],
    ])
    const due = new Date(rows[0].not_before as string).getTime()
    expect(Math.abs(due - (Date.now() + 24 * HOUR))).toBeLessThan(60_000)
  })

  it('sends the first approval time, not a later re-approval', async () => {
    const { conv, app } = await application('first')
    await decide(conv, app, 'APPROVED', 80)
    await decide(conv, app, 'APPROVED', 60)
    await run()
    const [event] = google.sentFor(app)
    expect(Math.abs(event.eventTime.getTime() - ago(80).getTime())).toBeLessThan(60_000)
  })

  it('concurrent runs send exactly once', async () => {
    const { conv, app } = await application('race')
    await decide(conv, app, 'APPROVED', 72)

    await Promise.all([run(), run(), run()])

    expect(google.sentFor(app)).toHaveLength(1)
    expect((await rowsFor(app)).map((r) => r.status)).toEqual(['sent'])
  })

  it('queues nothing for an application without a click id', async () => {
    const { conv, app } = await application('organic', {
      attribution: { utm_source: 'google', utm_medium: 'organic' },
    })
    await decide(conv, app, 'APPROVED', 72)
    await run()
    expect(await rowsFor(app)).toEqual([])
  })

  it('waits until the click is old enough for Google', async () => {
    const { app } = await application('recent', {
      attribution: { gclid: `${P}-gclid-recent`, received_at: ago(1).toISOString() },
    })
    await fund(app, 0.5)
    await run()
    expect(google.sentFor(app)).toEqual([])
    expect((await rowsFor(app))[0]).toMatchObject({ status: 'pending' })
  })

  describe('an approval that stops standing during the hold is never sent', () => {
    it('revised to declined', async () => {
      const { conv, app } = await application('revised')
      await decide(conv, app, 'APPROVED', 30)
      await decide(conv, app, 'DECLINED', 10)
      await run()
      await makeDue(app)
      await run()
      expect(google.sentFor(app)).toEqual([])
      expect((await rowsFor(app))[0]).toMatchObject({
        status: 'cancelled',
        status_reason: 'DECISION_REVISED',
      })
    })

    it('stopped by an operator, but not by the customer cancelling', async () => {
      const killed = await application('killed')
      await decide(killed.conv, killed.app, 'APPROVED', 72)
      await pool.query(
        `UPDATE conversations SET kill_record = $2::jsonb WHERE conversation_id = $1`,
        [killed.conv, JSON.stringify({ reason_category: 'fraud' })],
      )
      const cancelled = await application('cust-cancel')
      await decide(cancelled.conv, cancelled.app, 'APPROVED', 72)
      await pool.query(
        `UPDATE conversations SET kill_record = $2::jsonb WHERE conversation_id = $1`,
        [cancelled.conv, JSON.stringify({ reason_category: 'customer_request' })],
      )

      await run()

      expect(google.sentFor(killed.app)).toEqual([])
      expect((await rowsFor(killed.app))[0]).toMatchObject({
        status: 'cancelled',
        status_reason: 'KILLED',
      })
      expect(google.sentFor(cancelled.app)).toHaveLength(1)
    })

    it('loan cancelled as a fraud hold', async () => {
      const { conv, app } = await application('fraud-hold')
      await decide(conv, app, 'APPROVED', 72)
      await pool.query(
        `INSERT INTO loan_accounts (loan_account_id, account_number, account_status,
                                    application_number, cancellation_reason)
         VALUES ($1, 'ACC-546-FH', 'cancelled', $2, 'fraud_hold')`,
        [`${P}-loan-fraud-hold`, app],
      )
      await run()
      expect(google.sentFor(app)).toEqual([])
      expect((await rowsFor(app))[0]).toMatchObject({
        status: 'cancelled',
        status_reason: 'FRAUD_HOLD',
      })
    })
  })

  it('restores an approval that was revised and then approved again', async () => {
    const { conv, app } = await application('restored')
    await decide(conv, app, 'APPROVED', 80)
    await decide(conv, app, 'DECLINED', 79)
    await run()
    expect((await rowsFor(app))[0]).toMatchObject({ status: 'cancelled' })

    await decide(conv, app, 'APPROVED', 2)
    await run()

    expect(google.sentFor(app)).toHaveLength(1)
    expect((await rowsFor(app))[0]).toMatchObject({ status: 'sent' })
  })

  it('never sends a mock approval live, but checks it in validate-only mode', async () => {
    const { conv, app } = await application('mock')
    await decide(conv, app, 'APPROVED', 72, true)

    await run({ ...CONFIG, mode: 'validate_only' })
    await run({ ...CONFIG, mode: 'validate_only' })
    expect(google.sentFor(app)).toEqual([
      expect.objectContaining({ transactionId: app, validateOnly: true }),
    ])
    const [checked] = await rowsFor(app)
    expect(checked).toMatchObject({ status: 'pending', attempts: 0, last_error_code: null })
    expect(checked.validated_at).toBeTruthy()

    await run()
    expect(google.sentFor(app)).toHaveLength(1)
    expect((await rowsFor(app))[0]).toMatchObject({
      status: 'cancelled',
      status_reason: 'MOCK_DECISION',
    })
  })

  it('never claims a mock row live, even one queued after reconcile', async () => {
    const { conv, app } = await application('mock-race')
    await decide(conv, app, 'APPROVED', 72, true)
    await fillOutbox(pool)
    const claimed = await claimDueRows(pool, 'live')
    expect(claimed.map((r) => r.applicationNumber)).not.toContain(app)
    expect((await rowsFor(app))[0]).toMatchObject({ status: 'pending' })
  })

  it('fails a row Google rejects for its own fields, and sends the others', async () => {
    const bad = await application('bad-click')
    await decide(bad.conv, bad.app, 'APPROVED', 72)
    const good = await application('good-click')
    await decide(good.conv, good.app, 'APPROVED', 72)
    google.respond = (e) =>
      e.transactionId === bad.app ? { ok: false, errorCode: 'INVALID_GCLID' } : { ok: true }

    await run()

    expect((await rowsFor(bad.app))[0]).toMatchObject({
      status: 'failed',
      last_error_code: 'INVALID_GCLID',
    })
    expect((await rowsFor(good.app))[0]).toMatchObject({ status: 'sent' })
  })

  it('puts the rest of the batch back and stops when Google refuses a request', async () => {
    const a = await application('request-error-a')
    await decide(a.conv, a.app, 'APPROVED', 72)
    const b = await application('request-error-b')
    await decide(b.conv, b.app, 'APPROVED', 72)
    google.failRequest = 'PERMISSION_DENIED'

    const summary = await run()

    expect(summary.result.requestErrors).toEqual(['PERMISSION_DENIED'])
    expect(google.calls).toBe(1)
    for (const app of [a.app, b.app]) {
      expect((await rowsFor(app))[0]).toMatchObject({
        status: 'pending',
        last_error_code: 'PERMISSION_DENIED',
      })
    }
  })

  it('never fails a row for a long Google outage, and sends once it clears', async () => {
    const { conv, app } = await application('outage')
    await decide(conv, app, 'APPROVED', 72)
    google.failRequest = 'OAUTH_INVALID_GRANT'
    for (let i = 0; i < 15; i++) {
      await run()
      await makeDue(app)
    }
    expect((await rowsFor(app))[0]).toMatchObject({
      status: 'pending',
      last_error_code: 'OAUTH_INVALID_GRANT',
    })

    google.failRequest = null
    await run()
    expect(google.sentFor(app)).toHaveLength(1)
    expect((await rowsFor(app))[0]).toMatchObject({ status: 'sent', last_error_code: null })
  })

  it('releases a claim left behind by a run that died mid-send', async () => {
    const { conv, app } = await application('stale-claim')
    await decide(conv, app, 'APPROVED', 72)
    await fillOutbox(pool)
    await pool.query(
      `UPDATE google_ads_conversions SET status = 'sending', claimed_at = now() - interval '1 hour'
        WHERE application_number = $1`,
      [app],
    )
    await run()
    expect(google.sentFor(app)).toHaveLength(1)
    expect((await rowsFor(app))[0]).toMatchObject({ status: 'sent' })
  })

  describe('bounded by the click window, whatever the size of the history', () => {
    it('ignores approvals and loans older than the window', async () => {
      const { conv, app } = await application('day-200', {
        attribution: { gclid: `${P}-gclid-200`, received_at: ago(24 * 201).toISOString() },
      })
      await decide(conv, app, 'APPROVED', 24 * 200)
      await fund(app, 24 * 199)
      await run()
      expect(await rowsFor(app)).toEqual([])
    })

    it('expires a pending row once the window closes', async () => {
      const { conv, app } = await application('closing')
      await decide(conv, app, 'APPROVED', 24)
      await fillOutbox(pool)
      await pool.query(
        `UPDATE google_ads_conversions SET expires_at = now() - interval '1 day'
          WHERE application_number = $1`,
        [app],
      )
      await run()
      expect(google.sentFor(app)).toEqual([])
      expect((await rowsFor(app))[0]).toMatchObject({
        status: 'expired',
        status_reason: 'CLICK_WINDOW',
      })
    })

    it('keeps a failed row failed, with Google’s code, after the window closes', async () => {
      const { conv, app } = await application('failed-then-closed')
      await decide(conv, app, 'APPROVED', 72)
      google.respond = (e) =>
        e.transactionId === app ? { ok: false, errorCode: 'INVALID_GCLID' } : { ok: true }
      await run()
      await pool.query(
        `UPDATE google_ads_conversions SET expires_at = now() - interval '1 day'
          WHERE application_number = $1`,
        [app],
      )
      await run()
      expect((await rowsFor(app))[0]).toMatchObject({
        status: 'failed',
        last_error_code: 'INVALID_GCLID',
      })
    })
  })
})
