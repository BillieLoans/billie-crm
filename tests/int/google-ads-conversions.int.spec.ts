/**
 * BTB-546: the Google Ads conversion outbox against a real Postgres, with a
 * fake Google client.
 *
 * Done-when from the ticket: repeated runs and two concurrent senders produce
 * exactly one upload per (application, conversion), and a decision revised
 * after the upload produces exactly one retraction.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { getDashboardPool, type QueryablePool } from '@/lib/dashboard-aggregates'
import {
  GoogleAdsRequestError,
  type ClickConversionInput,
  type GoogleAdsConversionsClient,
  type RetractionInput,
  type RowResult,
} from '@/server/google-ads/client'
import type { GoogleAdsConfig } from '@/server/google-ads/config'
import { claimDueRows, fillOutbox, runGoogleAdsConversions } from '@/server/google-ads/conversions'

const P = 'btb546'
const HOUR = 3_600_000

const CONFIG: GoogleAdsConfig = {
  mode: 'live',
  apiVersion: 'v22',
  developerToken: 'x',
  customerId: '1',
  loginCustomerId: null,
  oauthClientId: 'x',
  oauthClientSecret: 'x',
  oauthRefreshToken: 'x',
  conversionActions: {
    approved: 'customers/1/conversionActions/111',
    funded: 'customers/1/conversionActions/222',
  },
}

class FakeGoogle implements GoogleAdsConversionsClient {
  uploads: Array<ClickConversionInput & { validateOnly: boolean }> = []
  retractions: Array<RetractionInput & { validateOnly: boolean }> = []
  respond: (orderId: string) => RowResult = () => ({ ok: true })
  respondRetraction: (orderId: string) => RowResult = () => ({ ok: true })
  failRequest: string | null = null

  async uploadClickConversions(rows: ClickConversionInput[], { validateOnly = false } = {}) {
    // Let a concurrent run reach its claim while this one is "on the wire".
    await new Promise((r) => setTimeout(r, 20))
    if (this.failRequest) throw new GoogleAdsRequestError(this.failRequest, 'fake')
    this.uploads.push(...rows.map((r) => ({ ...r, validateOnly })))
    return rows.map((r) => this.respond(r.orderId))
  }

  async uploadRetractions(rows: RetractionInput[], { validateOnly = false } = {}) {
    await new Promise((r) => setTimeout(r, 20))
    if (this.failRequest) throw new GoogleAdsRequestError(this.failRequest, 'fake')
    this.retractions.push(...rows.map((r) => ({ ...r, validateOnly })))
    return rows.map((r) => this.respondRetraction(r.orderId))
  }

  uploadsFor(app: string) {
    return this.uploads.filter((u) => u.orderId === app)
  }
  retractionsFor(app: string) {
    return this.retractions.filter((u) => u.orderId === app)
  }
}

let payload: Payload
let pool: QueryablePool
let google: FakeGoogle

const ago = (hours: number) => new Date(Date.now() - hours * HOUR)

async function application(
  n: string,
  opts: {
    attribution?: Record<string, string> | null
    killReason?: string
  } = {},
): Promise<{ conv: string; app: string }> {
  const conv = `${P}-conv-${n}`
  const app = `${P}-APP-${n}`
  const attribution =
    opts.attribution === undefined
      ? { gclid: `${P}-gclid-${n}`, received_at: ago(48).toISOString() }
      : opts.attribution
  await pool.query(
    `INSERT INTO conversations
       (conversation_id, application_number, status, started_at, updated_at, created_at,
        attribution, kill_record)
     VALUES ($1, $2, 'approved', $3, now(), now(), $4::jsonb, $5::jsonb)`,
    [
      conv,
      app,
      ago(48),
      attribution ? JSON.stringify(attribution) : null,
      opts.killReason ? JSON.stringify({ reason_category: opts.killReason }) : null,
    ],
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

const run = (cfg: GoogleAdsConfig = CONFIG) => runGoogleAdsConversions(pool, google, cfg)

/** Make every open row for the application due now (as if time had passed). */
async function makeDue(app: string): Promise<void> {
  await pool.query(
    `UPDATE google_ads_conversions SET not_before = now() - interval '1 second'
      WHERE application_number = $1 AND status = 'pending'`,
    [app],
  )
}

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

  it('uploads an approved ad-click application once across repeated runs', async () => {
    const { conv, app } = await application('once')
    await decide(conv, app, 'APPROVED', 24)

    await run()
    await fillOutbox(pool)
    await run()
    await run()

    expect(google.uploadsFor(app)).toEqual([
      expect.objectContaining({
        clickIdType: 'gclid',
        clickId: `${P}-gclid-once`,
        conversionAction: CONFIG.conversionActions.approved,
        orderId: app,
        validateOnly: false,
      }),
    ])
    const [row] = await rowsFor(app)
    expect(row).toMatchObject({ conversion_name: 'approved', status: 'sent', attempts: 1 })
    expect(row.sent_at).toBeTruthy()
  })

  it('sends the first approval time, not a later re-approval', async () => {
    const { conv, app } = await application('first')
    await decide(conv, app, 'APPROVED', 30)
    await decide(conv, app, 'APPROVED', 10)
    await run()
    const [upload] = google.uploadsFor(app)
    expect(Math.abs(upload.conversionDateTime.getTime() - ago(30).getTime())).toBeLessThan(60_000)
  })

  it('two concurrent runs upload exactly once', async () => {
    const { conv, app } = await application('race')
    await decide(conv, app, 'APPROVED', 24)

    await Promise.all([run(), run(), run()])

    expect(google.uploadsFor(app)).toHaveLength(1)
    expect((await rowsFor(app)).map((r) => r.status)).toEqual(['sent'])
  })

  it('uploads a funded loan as its own conversion', async () => {
    const { conv, app } = await application('funded')
    await decide(conv, app, 'APPROVED', 30)
    await pool.query(
      `INSERT INTO loan_accounts (loan_account_id, account_number, account_status,
                                  application_number, loan_terms_disbursed_date)
       VALUES ($1, 'ACC-546', 'active', $2, $3)`,
      [`${P}-loan-funded`, app, ago(20)],
    )

    await run()
    await run()

    expect(
      google
        .uploadsFor(app)
        .map((u) => u.conversionAction)
        .sort(),
    ).toEqual([CONFIG.conversionActions.approved, CONFIG.conversionActions.funded])
    expect((await rowsFor(app)).map((r) => [r.conversion_name, r.status])).toEqual([
      ['approved', 'sent'],
      ['funded', 'sent'],
    ])
  })

  it('queues nothing for an application without a click id', async () => {
    const { conv, app } = await application('organic', {
      attribution: { utm_source: 'google', utm_medium: 'organic' },
    })
    await decide(conv, app, 'APPROVED', 24)
    await run()
    expect(await rowsFor(app)).toEqual([])
    expect(google.uploadsFor(app)).toEqual([])
  })

  it('waits until the click is old enough for Google', async () => {
    const { conv, app } = await application('recent', {
      attribution: { gclid: `${P}-gclid-recent`, received_at: ago(1).toISOString() },
    })
    await decide(conv, app, 'APPROVED', 0.5)
    await run()
    expect(google.uploadsFor(app)).toEqual([])
    expect((await rowsFor(app))[0]).toMatchObject({ status: 'pending' })
  })

  it('never sends an approval revised before it went out', async () => {
    const { conv, app } = await application('revised-early')
    await decide(conv, app, 'APPROVED', 24)
    await decide(conv, app, 'DECLINED', 23)

    await run()

    expect(google.uploadsFor(app)).toEqual([])
    expect(await rowsFor(app)).toEqual([
      expect.objectContaining({ status: 'cancelled', status_reason: 'DECISION_REVISED' }),
    ])
  })

  it('retracts a sent approval exactly once when the decision is revised', async () => {
    const { conv, app } = await application('revised-late')
    await decide(conv, app, 'APPROVED', 24)
    await run()
    expect(google.uploadsFor(app)).toHaveLength(1)

    await decide(conv, app, 'DECLINED', 1)
    await run()
    await run()

    expect(google.retractionsFor(app)).toEqual([
      expect.objectContaining({ conversionAction: CONFIG.conversionActions.approved }),
    ])
    expect((await rowsFor(app)).map((r) => [r.action, r.status, r.status_reason])).toEqual([
      ['upload', 'sent', null],
      ['retract', 'sent', 'DECISION_REVISED'],
    ])
  })

  it('retracts an approval when an operator stops the application, not when the customer cancels', async () => {
    const killed = await application('killed')
    await decide(killed.conv, killed.app, 'APPROVED', 24)
    const cancelled = await application('cust-cancel')
    await decide(cancelled.conv, cancelled.app, 'APPROVED', 24)
    await run()

    await pool.query(
      `UPDATE conversations SET kill_record = $2::jsonb WHERE conversation_id = $1`,
      [killed.conv, JSON.stringify({ reason_category: 'fraud' })],
    )
    await pool.query(
      `UPDATE conversations SET kill_record = $2::jsonb WHERE conversation_id = $1`,
      [cancelled.conv, JSON.stringify({ reason_category: 'customer_request' })],
    )
    await run()

    expect(google.retractionsFor(killed.app)).toHaveLength(1)
    expect((await rowsFor(killed.app))[1]).toMatchObject({
      action: 'retract',
      status_reason: 'KILLED',
    })
    expect(google.retractionsFor(cancelled.app)).toEqual([])
  })

  it('restores an approval that was revised and then approved again', async () => {
    const { conv, app } = await application('restored')
    await decide(conv, app, 'APPROVED', 30)
    await decide(conv, app, 'DECLINED', 29)
    await run()
    expect((await rowsFor(app))[0]).toMatchObject({ status: 'cancelled' })

    await decide(conv, app, 'APPROVED', 2)
    await run()

    expect(google.uploadsFor(app)).toHaveLength(1)
    expect((await rowsFor(app))[0]).toMatchObject({ status: 'sent' })
  })

  it('never sends a mock approval live, but checks it in validate-only mode', async () => {
    const { conv, app } = await application('mock')
    await decide(conv, app, 'APPROVED', 24, true)

    await run({ ...CONFIG, mode: 'validate_only' })
    await run({ ...CONFIG, mode: 'validate_only' })
    expect(google.uploadsFor(app)).toEqual([
      expect.objectContaining({ orderId: app, validateOnly: true }),
    ])
    const [checked] = await rowsFor(app)
    expect(checked).toMatchObject({ status: 'pending', attempts: 0, last_error_code: null })
    expect(checked.validated_at).toBeTruthy()

    await run()
    expect(google.uploadsFor(app)).toHaveLength(1)
    expect((await rowsFor(app))[0]).toMatchObject({
      status: 'cancelled',
      status_reason: 'MOCK_DECISION',
    })
  })

  it('records a per-row error and retries what Google has not processed yet', async () => {
    const tooRecent = await application('too-recent')
    await decide(tooRecent.conv, tooRecent.app, 'APPROVED', 24)
    const bad = await application('bad-click')
    await decide(bad.conv, bad.app, 'APPROVED', 24)
    google.respond = (orderId) =>
      orderId === tooRecent.app
        ? { ok: false, errorCode: 'TOO_RECENT_GCLID' }
        : orderId === bad.app
          ? { ok: false, errorCode: 'GCLID_NOT_FOUND' }
          : { ok: true }

    await run()

    const [retry] = await rowsFor(tooRecent.app)
    expect(retry).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_error_code: 'TOO_RECENT_GCLID',
    })
    expect(new Date(retry.not_before as string).getTime()).toBeGreaterThan(Date.now() + 5 * HOUR)
    expect((await rowsFor(bad.app))[0]).toMatchObject({
      status: 'failed',
      last_error_code: 'GCLID_NOT_FOUND',
    })
  })

  it('puts the batch back when Google refuses the whole request', async () => {
    const { conv, app } = await application('request-error')
    await decide(conv, app, 'APPROVED', 24)
    google.failRequest = 'QUOTA_EXCEEDED'

    const summary = await run()

    expect(summary.result.requestErrors).toEqual(['QUOTA_EXCEEDED'])
    expect((await rowsFor(app))[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_error_code: 'QUOTA_EXCEEDED',
    })
  })

  it('releases a claim left behind by a run that died mid-send', async () => {
    const { conv, app } = await application('stale-claim')
    await decide(conv, app, 'APPROVED', 24)
    await fillOutbox(pool)
    await pool.query(
      `UPDATE google_ads_conversions SET status = 'sending', claimed_at = now() - interval '1 hour'
        WHERE application_number = $1`,
      [app],
    )
    await run()
    expect(google.uploadsFor(app)).toHaveLength(1)
    expect((await rowsFor(app))[0]).toMatchObject({ status: 'sent' })
  })

  describe('bounded by the click window, whatever the size of the history', () => {
    it('ignores approvals and loans older than the window', async () => {
      const { conv, app } = await application('day-200', {
        attribution: { gclid: `${P}-gclid-200`, received_at: ago(24 * 201).toISOString() },
      })
      await decide(conv, app, 'APPROVED', 24 * 200)
      await pool.query(
        `INSERT INTO loan_accounts (loan_account_id, account_number, account_status,
                                    application_number, loan_terms_disbursed_date)
         VALUES ($1, 'ACC-546-200', 'active', $2, $3)`,
        [`${P}-loan-200`, app, ago(24 * 199)],
      )
      await run()
      expect(await rowsFor(app)).toEqual([])
      expect(google.uploadsFor(app)).toEqual([])
    })

    it('stops watching a sent approval once its click window closes', async () => {
      const { conv, app } = await application('closed-window')
      await decide(conv, app, 'APPROVED', 24)
      await run()
      // 91 days later: the window has closed, then the decision is revised.
      await pool.query(
        `UPDATE google_ads_conversions SET expires_at = now() - interval '1 day'
          WHERE application_number = $1`,
        [app],
      )
      await decide(conv, app, 'DECLINED', 1)
      await run()
      expect(google.retractionsFor(app)).toEqual([])
      expect((await rowsFor(app)).map((r) => [r.action, r.status])).toEqual([['upload', 'sent']])
    })

    it('expires a retraction that could not go out before the window closed', async () => {
      const { conv, app } = await application('late-retraction')
      await decide(conv, app, 'APPROVED', 24)
      await run()
      await decide(conv, app, 'DECLINED', 1)
      google.failRequest = 'QUOTA_EXCEEDED'
      await run()
      expect((await rowsFor(app))[1]).toMatchObject({ action: 'retract', status: 'pending' })

      await pool.query(
        `UPDATE google_ads_conversions SET expires_at = now() - interval '1 day'
          WHERE application_number = $1`,
        [app],
      )
      google.failRequest = null
      await run()
      expect(google.retractionsFor(app)).toEqual([])
      expect((await rowsFor(app))[1]).toMatchObject({
        action: 'retract',
        status: 'expired',
        status_reason: 'CLICK_WINDOW',
      })
    })
  })

  describe('review fixes', () => {
    it('never fails a row for a long Google outage, and sends once it clears', async () => {
      const { conv, app } = await application('outage')
      await decide(conv, app, 'APPROVED', 24)
      google.failRequest = 'OAUTH_400'
      for (let i = 0; i < 15; i++) {
        await run()
        await makeDue(app)
      }
      expect((await rowsFor(app))[0]).toMatchObject({
        status: 'pending',
        last_error_code: 'OAUTH_400',
      })

      google.failRequest = null
      await run()
      expect(google.uploadsFor(app)).toHaveLength(1)
      expect((await rowsFor(app))[0]).toMatchObject({ status: 'sent', last_error_code: null })
    })

    it('retries an unknown error code and flags the run', async () => {
      const { conv, app } = await application('unknown-code')
      await decide(conv, app, 'APPROVED', 24)
      google.respond = (orderId) =>
        orderId === app ? { ok: false, errorCode: 'INVALID_CONVERSION_ACTION' } : { ok: true }

      const summary = await run()

      expect(summary.result.unrecognised).toContain('INVALID_CONVERSION_ACTION')
      expect((await rowsFor(app))[0]).toMatchObject({
        status: 'pending',
        last_error_code: 'INVALID_CONVERSION_ACTION',
      })
    })

    it('re-arms a retraction called off by a re-approval when the approval goes again', async () => {
      const { conv, app } = await application('rearm')
      await decide(conv, app, 'APPROVED', 24)
      await run()

      // Declined: the retraction is queued but Google has not processed the upload yet.
      await decide(conv, app, 'DECLINED', 3)
      google.respondRetraction = () => ({ ok: false, errorCode: 'TOO_RECENT_CONVERSION' })
      await run()
      expect((await rowsFor(app))[1]).toMatchObject({ action: 'retract', status: 'pending' })

      // Approved again: called off.
      await decide(conv, app, 'APPROVED', 2)
      await run()
      expect((await rowsFor(app))[1]).toMatchObject({
        status: 'cancelled',
        status_reason: 'DECISION_RESTORED',
      })

      // Declined again: re-armed and sent.
      await decide(conv, app, 'DECLINED', 1)
      google.respondRetraction = () => ({ ok: true })
      await run()
      expect((await rowsFor(app))[1]).toMatchObject({
        action: 'retract',
        status: 'sent',
        status_reason: 'DECISION_REVISED',
      })
    })

    it('retracts an approval whose loan was cancelled as a fraud hold', async () => {
      const { conv, app } = await application('fraud-hold')
      await decide(conv, app, 'APPROVED', 24)
      await run()
      await pool.query(
        `INSERT INTO loan_accounts (loan_account_id, account_number, account_status,
                                    application_number, cancellation_reason)
         VALUES ($1, 'ACC-546-FH', 'cancelled', $2, 'fraud_hold')`,
        [`${P}-loan-fraud-hold`, app],
      )
      await run()
      expect(google.retractionsFor(app)).toHaveLength(1)
      expect((await rowsFor(app))[1]).toMatchObject({
        action: 'retract',
        status_reason: 'FRAUD_HOLD',
      })
    })

    it('never claims a mock row live, even one queued after reconcile', async () => {
      const { conv, app } = await application('mock-race')
      await decide(conv, app, 'APPROVED', 24, true)
      await fillOutbox(pool) // queued, no reconcile
      const claimed = await claimDueRows(pool, 'live')
      expect(claimed.map((r) => r.applicationNumber)).not.toContain(app)
      expect((await rowsFor(app))[0]).toMatchObject({ status: 'pending' })
    })

    it('keeps a failed row failed, with Google’s code, after the window closes', async () => {
      const { conv, app } = await application('failed-then-closed')
      await decide(conv, app, 'APPROVED', 24)
      google.respond = (o) =>
        o === app ? { ok: false, errorCode: 'GCLID_NOT_FOUND' } : { ok: true }
      await run()
      await pool.query(
        `UPDATE google_ads_conversions SET expires_at = now() - interval '1 day'
          WHERE application_number = $1`,
        [app],
      )
      await run()
      expect((await rowsFor(app))[0]).toMatchObject({
        status: 'failed',
        last_error_code: 'GCLID_NOT_FOUND',
      })
    })
  })
})
