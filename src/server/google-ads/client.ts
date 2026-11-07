/**
 * Google Ads offline click conversions through the Data Manager API (BTB-546).
 *
 * Since 15 June 2026 the Google Ads API refuses UploadClickConversions for
 * developer tokens that had not used it before
 * (CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE); new integrations must use the
 * Data Manager API, `events:ingest`. It needs no developer token, only an
 * OAuth refresh token with the `datamanager` scope.
 *
 * Differences that shape the sender:
 *   - Fast fail: one bad event fails the whole request. The sender sends one
 *     conversion per request (a few a day), so a bad click blocks nothing.
 *   - No retractions. A conversion once sent stays counted, so approvals are
 *     held before sending (conversions.ts).
 *   - Re-sending the same transaction id is an adjustment, not an error, so a
 *     re-send after a crash is harmless.
 *   - Processing is asynchronous: a 200 means accepted for processing.
 *
 * Google's error messages are never returned (they can echo the request);
 * only codes. The sender talks to the `GoogleAdsConversionsClient`
 * interface; tests use a fake.
 */
import type { GoogleAdsConfig } from './config'

export type ClickIdType = 'gclid' | 'gbraid' | 'wbraid'

export interface ConversionEvent {
  clickIdType: ClickIdType
  clickId: string
  /** The conversion action's numeric id (Data Manager "product destination"). */
  conversionActionId: string
  eventTime: Date
  /** Our application number; de-duplicates per conversion action. */
  transactionId: string
}

/**
 * The outcome for one conversion. `ok: false` means Google rejected this
 * event: `final` when its own data is bad (it will never be accepted), not
 * final when the cause may pass (for example a newly created conversion
 * action Google has not finished setting up). Anything about the request as
 * a whole throws GoogleAdsRequestError instead.
 */
export type IngestResult = { ok: true } | { ok: false; errorCode: string; final: boolean }

/**
 * Event errors that mean this event's own data is bad, so re-sending it can
 * never succeed (Data Manager API ErrorReason). Every other event error,
 * NOT_FOUND among them, may be Google's side and is retried.
 */
const BAD_EVENT_DATA = new Set([
  'INVALID_FORMAT',
  'INVALID_EVENT',
  'INVALID_DATE',
  'INVALID_ENUM_VALUE',
  'REQUIRED_FIELD_MISSING',
  'FIELD_VALUE_TOO_LONG',
  'FIELD_VALUE_TOO_SHORT',
  'NO_IDENTIFIERS_PROVIDED',
  'EVENT_TIME_INVALID',
  'INVALID_AD_IDENTIFIER_FOR_ACCOUNT',
])

export interface IngestOptions {
  validateOnly: boolean
}

export interface GoogleAdsConversionsClient {
  ingestConversion(event: ConversionEvent, options: IngestOptions): Promise<IngestResult>
}

/** The request failed as a whole (auth, quota, network, config, a 5xx). Retry later. */
export class GoogleAdsRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleAdsRequestError'
  }
}

/** RFC 3339 in UTC, second precision: `2026-11-06T03:04:05Z`. */
export function rfc3339(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`
}

interface GoogleError {
  error?: {
    code?: number
    status?: string
    details?: Array<{
      '@type'?: string
      reason?: string
      fieldViolations?: Array<{ field?: string; reason?: string }>
    }>
  }
}

/**
 * Classify a failed response.
 *
 * A 400 whose field violations all point into `events` is about the event
 * itself. It is final only when the reason says the event's data is bad
 * (BAD_EVENT_DATA); otherwise the row is retried. Anything else
 * (destinations, auth, quota, a server error) is about the request or our
 * configuration and is retried, so a misconfiguration loses nothing.
 * The code is the most specific one Google gives: a field violation's
 * reason, an ErrorInfo reason, then the RPC status.
 */
export function classifyFailure(httpStatus: number, body: unknown): IngestResult {
  const error = (body as GoogleError | null)?.error
  const details = error?.details ?? []
  const violations = details.flatMap((d) => d.fieldViolations ?? [])
  const reason =
    violations.find((v) => v.reason)?.reason ??
    details.find((d) => d.reason)?.reason ??
    error?.status ??
    `HTTP_${httpStatus}`
  const aboutTheEvent =
    httpStatus === 400 &&
    violations.length > 0 &&
    violations.every((v) => (v.field ?? '').startsWith('events'))
  if (aboutTheEvent) return { ok: false, errorCode: reason, final: BAD_EVENT_DATA.has(reason) }
  throw new GoogleAdsRequestError(reason, `events:ingest: HTTP ${httpStatus}`)
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const INGEST_URL = 'https://datamanager.googleapis.com/v1/events:ingest'
const REQUEST_TIMEOUT_MS = 30_000

type Fetch = typeof fetch

/** The REST client. `fetchImpl` is for tests. */
export function createGoogleAdsClient(
  config: GoogleAdsConfig,
  fetchImpl: Fetch = fetch,
): GoogleAdsConversionsClient {
  let token: { value: string; expiresAt: number } | null = null

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value
    let res: Response
    try {
      res = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: config.oauthClientId,
          client_secret: config.oauthClientSecret,
          refresh_token: config.oauthRefreshToken,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw new GoogleAdsRequestError('NETWORK', 'OAuth token refresh did not complete')
    }
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string
      expires_in?: number
      error?: string
    }
    if (!res.ok || !body.access_token) {
      const code = body.error ? `OAUTH_${body.error.toUpperCase()}` : `OAUTH_${res.status}`
      throw new GoogleAdsRequestError(code, 'OAuth token refresh failed')
    }
    token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    }
    return token.value
  }

  return {
    async ingestConversion(event, { validateOnly }) {
      const destination: Record<string, unknown> = {
        operatingAccount: { accountType: 'GOOGLE_ADS', accountId: config.customerId },
        productDestinationId: event.conversionActionId,
      }
      if (config.loginCustomerId) {
        destination.loginAccount = { accountType: 'GOOGLE_ADS', accountId: config.loginCustomerId }
      }
      const body = {
        destinations: [destination],
        events: [
          {
            adIdentifiers: { [event.clickIdType]: event.clickId },
            eventTimestamp: rfc3339(event.eventTime),
            transactionId: event.transactionId,
            eventSource: 'WEB',
          },
        ],
        validateOnly,
      }
      const authorization = `Bearer ${await accessToken()}`
      let res: Response
      try {
        res = await fetchImpl(INGEST_URL, {
          method: 'POST',
          headers: { authorization, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch {
        throw new GoogleAdsRequestError('NETWORK', 'events:ingest did not complete')
      }
      if (res.ok) return { ok: true }
      return classifyFailure(res.status, await res.json().catch(() => null))
    },
  }
}
