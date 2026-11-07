/**
 * Google Ads offline click conversions (BTB-546): fill the outbox from the
 * projections, reconcile it, and drain it to Google Ads exactly once.
 *
 * Design: Confluence "Google Ads Offline Conversions — Findings & Solution
 * Hypothesis". One deliberate change: the outbox is filled here, from
 * settled projection state, rather than by the event processor. Prod runs two
 * consumers with no event ordering, so a handler could see a revision before
 * the approval it revises; reading `reporting.decision_event` (idempotent per
 * event) and `loan_accounts.loan_terms_disbursed_date` (stamped once) makes
 * event replays and ordering irrelevant, and back-fills anything still inside
 * the click window.
 *
 * Each run:
 *   1. fill     — insert a row per approved / funded application that came
 *                 from an ad click. Unique on (application_number,
 *                 conversion_name, action); a repeat inserts nothing.
 *   2. reconcile — per approval, compare what Google should count (the
 *                 approval still stands: latest decision APPROVED, not stopped
 *                 by an operator, loan not cancelled as a fraud hold) with
 *                 what it was told, both ways: an unsent upload is cancelled
 *                 or restored, and a sent one gets a retraction queued,
 *                 re-armed or called off. Also expires rows past the click
 *                 window and releases stale claims.
 *   3. claim    — `FOR UPDATE SKIP LOCKED`, so concurrent runs take disjoint
 *                 rows.
 *   4. send     — one upload call and one retraction call, partial failure on.
 *   5. record   — each row's result. Google's "already exists" answers count
 *                 as sent, so a re-send after a crash between Google
 *                 accepting and this write is harmless (`order_id` is the
 *                 application number, which Google de-duplicates on). A row
 *                 fails for good only on an error about that click; anything
 *                 else (auth, quota, an unknown code) is retried until the
 *                 click window closes, so fixing credentials loses nothing.
 *
 * Sent per row: the click id, the conversion action, the time and the
 * application number as order id. Nothing else.
 */
import type { QueryablePool } from '@/lib/dashboard-aggregates'
import {
  GoogleAdsRequestError,
  type ClickIdType,
  type GoogleAdsConversionsClient,
  type RowResult,
} from './client'
import type { GoogleAdsConfig } from './config'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** Google rejects a conversion for a click it has not processed yet. */
export const CLICK_SETTLE_MS = 6 * HOUR_MS
/**
 * The longest click window Google allows. Every query is bounded by it: a
 * conversion older than this can never be sent or retracted, so each run
 * reads the last CLICK_WINDOW_DAYS of data whatever the size of the history.
 * Change it here only, if Google changes the limit.
 */
export const CLICK_WINDOW_DAYS = 90
export const CLICK_WINDOW_MS = CLICK_WINDOW_DAYS * DAY_MS
const WINDOW = `interval '${CLICK_WINDOW_DAYS} days'`
const BATCH_LIMIT = 500
const STALE_CLAIM_MINUTES = 30

/** Google already holds this one: record it as sent. */
const ALREADY_DONE = new Set([
  'CLICK_CONVERSION_ALREADY_EXISTS',
  'ORDER_ID_ALREADY_IN_USE',
  'CONVERSION_ALREADY_RETRACTED',
])
/** Not yet: Google has not processed the click or conversion. Retry after it settles. */
const NOT_YET = new Set([
  'TOO_RECENT_GCLID',
  'TOO_RECENT_EVENT',
  'TOO_RECENT_CONVERSION',
  'TOO_RECENT_CONVERSION_ACTION',
  'CONVERSION_NOT_FOUND',
])
/** About this click itself: it will never be accepted. The only final failures. */
const CLICK_REJECTED = new Set([
  'UNPARSEABLE_GCLID',
  'GCLID_NOT_FOUND',
  'CONVERSION_PRECEDES_GCLID',
  'CONVERSION_PRECEDES_EVENT',
  'EVENT_NOT_FOUND',
])
/** Past the conversion action's click window: Google will never take it. */
const EXPIRED = new Set(['EXPIRED_GCLID', 'EXPIRED_EVENT', 'CONVERSION_EXPIRED'])
/** Anything else is retried daily until the window closes, and turns the job red. */
const UNKNOWN_RETRY_MS = 24 * HOUR_MS
/** After a whole-request failure (auth, quota, network). The job runs hourly. */
const REQUEST_RETRY_MS = HOUR_MS

export type ConversionName = 'approved' | 'funded'

// ── 1. Fill ──────────────────────────────────────────────────────────────

export interface ConversionCandidate {
  applicationNumber: string
  conversationId: string
  convertedAt: Date
  mockOrigin: boolean
  attribution: unknown
  startedAt: Date | null
}

export interface OutboxRow {
  applicationNumber: string
  conversationId: string
  conversionName: ConversionName
  clickIdType: ClickIdType
  clickId: string
  clickAt: Date
  convertedAt: Date
  notBefore: Date
  expiresAt: Date
  mockOrigin: boolean
  status: 'pending' | 'expired'
  statusReason: string | null
}

const CLICK_ID_TYPES: ClickIdType[] = ['gclid', 'gbraid', 'wbraid']
// The event processor stores only sanitised values; check again, as these
// leave the building.
const CLICK_ID_RE = /^[\w\-.~+/]{1,512}$/

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string' || !value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Shape one outbox row, or null when the application did not come from an
 * ad click.
 *
 * The click time is the chat backend's `received_at` (server clock), then
 * the browser's `captured_at`, then the conversation start: the first that is
 * not after the conversion. A row whose click window has closed is written as
 * `expired`, so the panel shows why nothing was sent.
 */
export function buildOutboxRow(
  candidate: ConversionCandidate,
  conversionName: ConversionName,
  now: Date,
): OutboxRow | null {
  const attribution =
    candidate.attribution && typeof candidate.attribution === 'object'
      ? (candidate.attribution as Record<string, unknown>)
      : {}
  let clickIdType: ClickIdType | null = null
  let clickId: string | null = null
  for (const type of CLICK_ID_TYPES) {
    const value = attribution[type]
    if (typeof value === 'string' && CLICK_ID_RE.test(value)) {
      clickIdType = type
      clickId = value
      break
    }
  }
  if (!clickIdType || !clickId) return null

  const convertedAt = candidate.convertedAt
  const clickAt =
    [toDate(attribution.received_at), toDate(attribution.captured_at), candidate.startedAt].find(
      (d): d is Date => d !== null && d.getTime() <= convertedAt.getTime(),
    ) ?? convertedAt
  const expiresAt = new Date(clickAt.getTime() + CLICK_WINDOW_MS)
  const notBefore = new Date(Math.max(clickAt.getTime() + CLICK_SETTLE_MS, convertedAt.getTime()))
  const expired = convertedAt >= expiresAt || now >= expiresAt

  return {
    applicationNumber: candidate.applicationNumber,
    conversationId: candidate.conversationId,
    conversionName,
    clickIdType,
    clickId,
    clickAt,
    convertedAt,
    notBefore,
    expiresAt,
    mockOrigin: candidate.mockOrigin,
    status: expired ? 'expired' : 'pending',
    statusReason: expired ? 'CLICK_WINDOW' : null,
  }
}

const HAS_CLICK_ID = `(c.attribution ? 'gclid' OR c.attribution ? 'gbraid' OR c.attribution ? 'wbraid')`

/** First approval of each application, within the click window, not yet queued. */
const APPROVED_CANDIDATES = `
SELECT a.application_number, a.conversation_id, a.converted_at, a.mock_origin,
       c.attribution, c.started_at
  FROM (
    SELECT d.application_number,
           (array_agg(d.conversation_id ORDER BY d.decided_at))[1] AS conversation_id,
           min(d.decided_at)                                       AS converted_at,
           (array_agg(d.mock_origin ORDER BY d.decided_at))[1]     AS mock_origin
      FROM reporting.decision_event d
     WHERE d.decision = 'APPROVED'
       AND NULLIF(d.application_number, '') IS NOT NULL
       -- decided_on is indexed (decision_event_decided_on_idx); decided_at is the exact cut.
       AND d.decided_on >= (now() AT TIME ZONE 'Australia/Sydney')::date - ${CLICK_WINDOW_DAYS + 1}
       AND d.decided_at > now() - ${WINDOW}
     GROUP BY d.application_number
  ) a
  JOIN conversations c ON c.conversation_id = a.conversation_id
 WHERE ${HAS_CLICK_ID}
   AND NOT EXISTS (
     SELECT 1 FROM google_ads_conversions g
      WHERE g.application_number = a.application_number
        AND g.conversion_name = 'approved' AND g.action = 'upload')`

/** First disbursement of each application, within the click window, not yet queued. */
const FUNDED_CANDIDATES = `
SELECT f.application_number, c.conversation_id, f.converted_at,
       EXISTS (SELECT 1 FROM reporting.decision_event d
                WHERE d.conversation_id = c.conversation_id
                  AND d.decision = 'APPROVED' AND d.mock_origin) AS mock_origin,
       c.attribution, c.started_at
  FROM (
    SELECT la.application_number, min(la.loan_terms_disbursed_date) AS converted_at
      FROM loan_accounts la
     WHERE la.loan_terms_disbursed_date IS NOT NULL
       AND la.loan_terms_disbursed_date > now() - ${WINDOW}
       AND NULLIF(la.application_number, '') IS NOT NULL
     GROUP BY la.application_number
  ) f
  JOIN LATERAL (
    SELECT c.conversation_id, c.attribution, c.started_at
      FROM conversations c
     -- The raw column, so conversations_application_number_idx is used;
     -- f.application_number is never ''.
     WHERE c.application_number = f.application_number
       AND ${HAS_CLICK_ID}
     ORDER BY c.started_at
     LIMIT 1
  ) c ON true
 WHERE NOT EXISTS (
     SELECT 1 FROM google_ads_conversions g
      WHERE g.application_number = f.application_number
        AND g.conversion_name = 'funded' AND g.action = 'upload')`

const INSERT_ROW = `
INSERT INTO google_ads_conversions
  (application_number, conversation_id, conversion_name, action, click_id_type, click_id,
   click_at, converted_at, not_before, expires_at, mock_origin, status, status_reason, attempts)
VALUES ($1, $2, $3, 'upload', $4, $5, $6, $7, $8, $9, $10, $11, $12, 0)
ON CONFLICT (application_number, conversion_name, action) DO NOTHING`

function toCandidate(row: Record<string, unknown>): ConversionCandidate | null {
  const convertedAt = toDate(row.converted_at)
  if (!convertedAt || typeof row.application_number !== 'string') return null
  return {
    applicationNumber: row.application_number,
    conversationId: String(row.conversation_id ?? ''),
    convertedAt,
    mockOrigin: row.mock_origin === true,
    attribution: row.attribution,
    startedAt: toDate(row.started_at),
  }
}

/** Step 1. Returns how many rows were added, per conversion. */
export async function fillOutbox(
  pool: QueryablePool,
  now: Date = new Date(),
): Promise<Record<ConversionName, number>> {
  const added: Record<ConversionName, number> = { approved: 0, funded: 0 }
  for (const [name, query] of [
    ['approved', APPROVED_CANDIDATES],
    ['funded', FUNDED_CANDIDATES],
  ] as const) {
    const { rows } = await pool.query(query)
    for (const raw of rows) {
      const candidate = toCandidate(raw)
      const row = candidate && buildOutboxRow(candidate, name, now)
      if (!row) continue
      const result = (await pool.query(INSERT_ROW, [
        row.applicationNumber,
        row.conversationId,
        row.conversionName,
        row.clickIdType,
        row.clickId,
        row.clickAt,
        row.convertedAt,
        row.notBefore,
        row.expiresAt,
        row.mockOrigin,
        row.status,
        row.statusReason,
      ])) as { rowCount?: number | null }
      if (result.rowCount) added[name] += 1
    }
  }
  return added
}

// ── 2. Reconcile ─────────────────────────────────────────────────────────

/** An operator stopped the conversation. A customer's own cancellation is not a stop. */
const KILLED = `EXISTS (
    SELECT 1 FROM conversations c
     WHERE c.conversation_id = g.conversation_id
       AND c.kill_record IS NOT NULL
       AND c.kill_record->>'reason_category' IS DISTINCT FROM 'customer_request')`

/** The loan was cancelled before disbursement as a fraud hold (BTB-517). */
const FRAUD_HOLD = `EXISTS (
    SELECT 1 FROM loan_accounts la
     WHERE la.application_number = g.application_number
       AND la.cancellation_reason = 'fraud_hold')`

/**
 * The conversation's latest decision, with the tie-break reporting.decision
 * uses, so the outbox and the reports never disagree.
 */
const LATEST_DECISION = `(SELECT d.decision FROM reporting.decision_event d
    WHERE d.conversation_id = g.conversation_id
    ORDER BY d.decided_at DESC, d.decision_key DESC LIMIT 1)`

/**
 * True for an approval Google should count: still the latest decision, not
 * stopped by an operator, not a fraud hold. Fraud must not teach Google to
 * find more of the same.
 */
const APPROVAL_STANDS = `(${LATEST_DECISION} = 'APPROVED' AND NOT ${KILLED} AND NOT ${FRAUD_HOLD})`

const WHY_NOT = `CASE WHEN ${KILLED} THEN 'KILLED' WHEN ${FRAUD_HOLD} THEN 'FRAUD_HOLD'
  ELSE 'DECISION_REVISED' END`

export interface ReconcileSummary {
  cancelled: number
  restored: number
  retractionsQueued: number
  retractionsCancelled: number
  expired: number
  released: number
  mockCancelled: number
}

const count = (result: unknown): number => (result as { rowCount?: number | null }).rowCount ?? 0

/** Step 2. */
export async function reconcileOutbox(
  pool: QueryablePool,
  mode: GoogleAdsConfig['mode'],
): Promise<ReconcileSummary> {
  // A run that died mid-send. Re-sending is safe: Google answers "already
  // exists" for anything it took.
  const released = count(
    await pool.query(
      `UPDATE google_ads_conversions SET status = 'pending', claimed_at = NULL, updated_at = now()
        WHERE status = 'sending' AND claimed_at < now() - interval '${STALE_CLAIM_MINUTES} minutes'`,
    ),
  )
  // Past the click window, uploads and retractions alike: Google will take
  // neither. Runs first, so every step below sees only open rows. A failed
  // row keeps its status and Google's code.
  const expired = count(
    await pool.query(
      `UPDATE google_ads_conversions SET status = 'expired', status_reason = 'CLICK_WINDOW',
              updated_at = now()
        WHERE status = 'pending' AND expires_at <= now()`,
    ),
  )
  const cancelled = count(
    await pool.query(
      `UPDATE google_ads_conversions g SET status = 'cancelled', status_reason = ${WHY_NOT},
              updated_at = now()
        WHERE g.conversion_name = 'approved' AND g.action = 'upload'
          AND g.status = 'pending' AND g.expires_at > now()
          AND NOT ${APPROVAL_STANDS}`,
    ),
  )
  const restored = count(
    await pool.query(
      `UPDATE google_ads_conversions g SET status = 'pending', status_reason = NULL,
              attempts = 0, updated_at = now()
        WHERE g.conversion_name = 'approved' AND g.action = 'upload'
          AND g.status = 'cancelled'
          AND g.status_reason IN ('DECISION_REVISED', 'KILLED', 'FRAUD_HOLD')
          AND g.expires_at > now()
          AND ${APPROVAL_STANDS}`,
    ),
  )
  const retractionsQueued = count(
    await pool.query(
      `INSERT INTO google_ads_conversions
         (application_number, conversation_id, conversion_name, action, click_id_type, click_id,
          click_at, converted_at, not_before, expires_at, mock_origin, status, status_reason,
          attempts)
       SELECT g.application_number, g.conversation_id, g.conversion_name, 'retract',
              g.click_id_type, g.click_id, g.click_at, now(), now(), g.expires_at, g.mock_origin,
              'pending', ${WHY_NOT}, 0
         FROM google_ads_conversions g
        WHERE g.conversion_name = 'approved' AND g.action = 'upload' AND g.status = 'sent'
          AND g.expires_at > now()
          AND NOT ${APPROVAL_STANDS}
       -- A retraction called off because the approval came back is re-armed
       -- when it goes again. One already sent or in flight is left alone.
       ON CONFLICT (application_number, conversion_name, action) DO UPDATE
          SET status = 'pending', status_reason = EXCLUDED.status_reason,
              converted_at = now(), not_before = now(), claimed_at = NULL,
              last_error_code = NULL, updated_at = now()
        WHERE google_ads_conversions.status = 'cancelled'`,
    ),
  )
  // Approved again before the retraction went out: nothing to retract.
  const retractionsCancelled = count(
    await pool.query(
      `UPDATE google_ads_conversions g SET status = 'cancelled',
              status_reason = 'DECISION_RESTORED', updated_at = now()
        WHERE g.conversion_name = 'approved' AND g.action = 'retract'
          AND g.status = 'pending' AND g.expires_at > now()
          AND ${APPROVAL_STANDS}`,
    ),
  )
  // A mock approval is not a borrower. validate_only keeps them, so demo can
  // be tested end to end; live never sends one.
  const mockCancelled =
    mode === 'live'
      ? count(
          await pool.query(
            `UPDATE google_ads_conversions SET status = 'cancelled',
                    status_reason = 'MOCK_DECISION', updated_at = now()
              WHERE mock_origin AND status = 'pending'`,
          ),
        )
      : 0
  return {
    cancelled,
    restored,
    retractionsQueued,
    retractionsCancelled,
    expired,
    released,
    mockCancelled,
  }
}

// ── 3. Claim ─────────────────────────────────────────────────────────────

export interface ClaimedRow {
  id: string
  applicationNumber: string
  conversionName: ConversionName
  action: 'upload' | 'retract'
  clickIdType: ClickIdType
  clickId: string
  convertedAt: Date
  attempts: number
}

/**
 * Step 3. Take due rows for this run. In validate-only mode, each row is
 * checked once (`validated_at` stays set, and the row pending, for live).
 * Live never takes a mock row, even one queued by an overlapping run after
 * this run's reconcile.
 */
export async function claimDueRows(
  pool: QueryablePool,
  mode: GoogleAdsConfig['mode'],
  limit = BATCH_LIMIT,
): Promise<ClaimedRow[]> {
  const { rows } = await pool.query(
    `UPDATE google_ads_conversions SET status = 'sending', claimed_at = now(), updated_at = now()
      WHERE id IN (
        SELECT id FROM google_ads_conversions
         WHERE status = 'pending' AND not_before <= now()
           AND expires_at > now()
           ${mode === 'validate_only' ? 'AND validated_at IS NULL' : 'AND mock_origin IS NOT TRUE'}
         ORDER BY not_before
         LIMIT $1
         FOR UPDATE SKIP LOCKED)
      RETURNING id, application_number, conversion_name, action, click_id_type, click_id,
                converted_at, attempts`,
    [limit],
  )
  return rows.map((r) => ({
    id: String(r.id),
    applicationNumber: String(r.application_number),
    conversionName: r.conversion_name as ConversionName,
    action: r.action as 'upload' | 'retract',
    clickIdType: r.click_id_type as ClickIdType,
    clickId: String(r.click_id),
    convertedAt: toDate(r.converted_at) ?? new Date(),
    attempts: Number(r.attempts ?? 0),
  }))
}

// ── 4–5. Send and record ─────────────────────────────────────────────────

export interface SendSummary {
  sent: number
  validated: number
  retried: number
  failed: number
  expired: number
  /** Whole-request failures, by code. */
  requestErrors: string[]
  /** Per-row codes this code does not recognise; retried, and the job goes red. */
  unrecognised: string[]
}

type Outcome =
  | { kind: 'sent' }
  | { kind: 'validated'; errorCode: string | null }
  | { kind: 'retry'; errorCode: string; delayMs: number; unrecognised: boolean }
  | { kind: 'failed'; errorCode: string }
  | { kind: 'expired'; errorCode: string }

/**
 * What one row's result means for the row. Only an error about the click
 * itself fails a row for good; everything else is retried until the click
 * window closes, so nothing is lost to a misconfiguration or an error code
 * this code does not know.
 */
export function outcomeFor(result: RowResult, mode: GoogleAdsConfig['mode']): Outcome {
  if (mode === 'validate_only') {
    return { kind: 'validated', errorCode: result.ok ? null : result.errorCode }
  }
  if (result.ok || ALREADY_DONE.has(result.errorCode)) return { kind: 'sent' }
  const code = result.errorCode
  if (EXPIRED.has(code)) return { kind: 'expired', errorCode: code }
  if (CLICK_REJECTED.has(code)) return { kind: 'failed', errorCode: code }
  if (NOT_YET.has(code)) {
    return { kind: 'retry', errorCode: code, delayMs: CLICK_SETTLE_MS, unrecognised: false }
  }
  return { kind: 'retry', errorCode: code, delayMs: UNKNOWN_RETRY_MS, unrecognised: true }
}

// A live outcome clears validated_at, so the panel never shows a live error
// as the validate-only verdict.
async function record(pool: QueryablePool, row: ClaimedRow, outcome: Outcome): Promise<void> {
  switch (outcome.kind) {
    case 'sent':
      await pool.query(
        `UPDATE google_ads_conversions SET status = 'sent', sent_at = now(), last_error_code = NULL,
                attempts = attempts + 1, last_attempt_at = now(), claimed_at = NULL,
                validated_at = NULL, updated_at = now()
          WHERE id = $1`,
        [row.id],
      )
      return
    case 'validated':
      await pool.query(
        `UPDATE google_ads_conversions SET status = 'pending', validated_at = now(),
                last_error_code = $2, last_attempt_at = now(), claimed_at = NULL,
                updated_at = now()
          WHERE id = $1`,
        [row.id, outcome.errorCode],
      )
      return
    case 'retry':
      await pool.query(
        `UPDATE google_ads_conversions SET status = 'pending', last_error_code = $2,
                attempts = attempts + 1, last_attempt_at = now(), claimed_at = NULL,
                not_before = now() + ($3::int * interval '1 millisecond'),
                validated_at = NULL, updated_at = now()
          WHERE id = $1`,
        [row.id, outcome.errorCode, outcome.delayMs],
      )
      return
    case 'failed':
    case 'expired':
      // An expiry keeps Google's code as its reason (the conversion action's
      // window may be shorter than 90 days).
      await pool.query(
        `UPDATE google_ads_conversions SET status = $2, status_reason = $3, last_error_code = $4,
                attempts = attempts + 1, last_attempt_at = now(), claimed_at = NULL,
                validated_at = NULL, updated_at = now()
          WHERE id = $1`,
        [
          row.id,
          outcome.kind,
          outcome.kind === 'expired' ? outcome.errorCode : null,
          outcome.errorCode,
        ],
      )
  }
}

/**
 * Put a batch back after a whole-request failure (auth, quota, network): try
 * again next run. Never fails a row, so a weekend of revoked credentials
 * loses nothing; the click window bounds the retries, and the job is red
 * until it clears. Validate-only does not count attempts.
 */
async function releaseAfterRequestError(
  pool: QueryablePool,
  rows: ClaimedRow[],
  code: string,
  mode: GoogleAdsConfig['mode'],
): Promise<void> {
  const live = mode === 'live'
  await pool.query(
    `UPDATE google_ads_conversions
        SET status = 'pending', attempts = attempts + $3, last_error_code = $2,
            last_attempt_at = now(), claimed_at = NULL,
            not_before = now() + ($4::int * interval '1 millisecond'),
            validated_at = CASE WHEN $5 THEN NULL ELSE validated_at END,
            updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [rows.map((r) => r.id), code, live ? 1 : 0, REQUEST_RETRY_MS, live],
  )
}

/** Steps 4 and 5 for claimed rows. */
export async function sendClaimedRows(
  pool: QueryablePool,
  client: GoogleAdsConversionsClient,
  config: GoogleAdsConfig,
  claimed: ClaimedRow[],
): Promise<SendSummary> {
  const summary: SendSummary = {
    sent: 0,
    validated: 0,
    retried: 0,
    failed: 0,
    expired: 0,
    requestErrors: [],
    unrecognised: [],
  }
  const validateOnly = config.mode === 'validate_only'
  const uploads = claimed.filter((r) => r.action === 'upload')
  const retractions = claimed.filter((r) => r.action === 'retract')

  const batches: Array<[ClaimedRow[], () => Promise<RowResult[]>]> = [
    [
      uploads,
      () =>
        client.uploadClickConversions(
          uploads.map((r) => ({
            clickIdType: r.clickIdType,
            clickId: r.clickId,
            conversionAction: config.conversionActions[r.conversionName],
            conversionDateTime: r.convertedAt,
            orderId: r.applicationNumber,
          })),
          { validateOnly },
        ),
    ],
    [
      retractions,
      () =>
        client.uploadRetractions(
          retractions.map((r) => ({
            conversionAction: config.conversionActions[r.conversionName],
            adjustmentDateTime: r.convertedAt,
            orderId: r.applicationNumber,
          })),
          { validateOnly },
        ),
    ],
  ]

  for (const [rows, send] of batches) {
    if (rows.length === 0) continue
    let results: RowResult[]
    try {
      results = await send()
    } catch (error) {
      const code = error instanceof GoogleAdsRequestError ? error.code : 'REQUEST_FAILED'
      await releaseAfterRequestError(pool, rows, code, config.mode)
      summary.requestErrors.push(code)
      continue
    }
    for (const [i, row] of rows.entries()) {
      const outcome = outcomeFor(results[i] ?? { ok: false, errorCode: 'NO_RESULT' }, config.mode)
      await record(pool, row, outcome)
      if (outcome.kind === 'sent') summary.sent += 1
      else if (outcome.kind === 'validated') summary.validated += 1
      else if (outcome.kind === 'retry') {
        summary.retried += 1
        if (outcome.unrecognised && !summary.unrecognised.includes(outcome.errorCode)) {
          summary.unrecognised.push(outcome.errorCode)
        }
      } else if (outcome.kind === 'expired') summary.expired += 1
      else summary.failed += 1
    }
  }
  return summary
}

export interface RunSummary {
  mode: GoogleAdsConfig['mode']
  queued: Record<ConversionName, number>
  reconciled: ReconcileSummary
  claimed: number
  result: SendSummary
}

/** One scheduled run: fill, reconcile, claim, send, record. */
export async function runGoogleAdsConversions(
  pool: QueryablePool,
  client: GoogleAdsConversionsClient,
  config: GoogleAdsConfig,
): Promise<RunSummary> {
  const queued = await fillOutbox(pool)
  const reconciled = await reconcileOutbox(pool, config.mode)
  const claimed = await claimDueRows(pool, config.mode)
  const result = await sendClaimedRows(pool, client, config, claimed)
  return { mode: config.mode, queued, reconciled, claimed: claimed.length, result }
}
