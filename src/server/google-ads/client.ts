/**
 * Google Ads API client for offline click conversions (BTB-546).
 *
 * Two calls over REST, with an OAuth refresh token for access:
 *   - ConversionUploadService.UploadClickConversions
 *   - ConversionAdjustmentUploadService.UploadConversionAdjustments (RETRACTION)
 *
 * Both run with partial failure on, so one bad row does not fail the batch.
 * Each result comes back as `ok` or an error code for the row at the same
 * index. Google's error messages are never returned: they can echo the
 * request, and only the code is stored.
 *
 * The sender talks to the `GoogleAdsConversionsClient` interface; tests use a
 * fake.
 */
import type { GoogleAdsConfig } from './config'

export type ClickIdType = 'gclid' | 'gbraid' | 'wbraid'

export interface ClickConversionInput {
  clickIdType: ClickIdType
  clickId: string
  /** Full resource name: customers/{id}/conversionActions/{id}. */
  conversionAction: string
  conversionDateTime: Date
  orderId: string
}

export interface RetractionInput {
  conversionAction: string
  adjustmentDateTime: Date
  orderId: string
}

/** One row's outcome, at the same index as its input. */
export type RowResult = { ok: true } | { ok: false; errorCode: string }

export interface UploadOptions {
  validateOnly: boolean
}

export interface GoogleAdsConversionsClient {
  uploadClickConversions(
    conversions: ClickConversionInput[],
    options: UploadOptions,
  ): Promise<RowResult[]>
  uploadRetractions(retractions: RetractionInput[], options: UploadOptions): Promise<RowResult[]>
}

/** The whole request failed (auth, quota, network, a 5xx). No row was processed. */
export class GoogleAdsRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleAdsRequestError'
  }
}

/** Google's date-time format: `yyyy-mm-dd hh:mm:ss+00:00`, sent in UTC. */
export function googleAdsDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace('T', ' ')}+00:00`
}

interface GoogleAdsErrorDetail {
  errors?: Array<{
    errorCode?: Record<string, string>
    location?: { fieldPathElements?: Array<{ fieldName?: string; index?: number }> }
  }>
}

/**
 * Map a partial-failure response to one result per input row.
 *
 * `partialFailureError.details[].errors[]` locates each failed row by the
 * index of the first field-path element (`conversions[i]` or
 * `conversion_adjustments[i]`); the error code is the single value of
 * `errorCode` (for example `{ conversionUploadError: "TOO_RECENT_GCLID" }`).
 * A row with no error succeeded. An error that names no row is treated as a
 * whole-request failure (thrown): nothing is recorded as sent that Google may
 * not have accepted, and nothing is failed for good. The retry re-sends the
 * accepted rows too, which Google answers "already exists".
 */
export function mapPartialFailure(response: unknown, count: number): RowResult[] {
  const results: RowResult[] = Array.from({ length: count }, () => ({ ok: true }) as RowResult)
  const failure = (response as { partialFailureError?: { details?: unknown[] } } | null)
    ?.partialFailureError
  if (!failure) return results
  let unlocated: string | null = null
  for (const detail of failure.details ?? []) {
    for (const error of (detail as GoogleAdsErrorDetail).errors ?? []) {
      const code = Object.values(error.errorCode ?? {})[0] ?? 'UNKNOWN'
      const index = error.location?.fieldPathElements?.find(
        (e) => typeof e.index === 'number',
      )?.index
      if (typeof index === 'number' && index >= 0 && index < count) {
        if (results[index].ok) results[index] = { ok: false, errorCode: code }
      } else {
        unlocated ??= code
      }
    }
  }
  if (unlocated !== null || (failure.details ?? []).length === 0) {
    throw new GoogleAdsRequestError(
      unlocated ?? 'PARTIAL_FAILURE',
      'Google reported an error that names no row',
    )
  }
  return results
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API_ROOT = 'https://googleads.googleapis.com'
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
    const res = await fetchImpl(TOKEN_URL, {
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
    if (!res.ok) {
      throw new GoogleAdsRequestError(`OAUTH_${res.status}`, 'OAuth token refresh failed')
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!body.access_token) {
      throw new GoogleAdsRequestError('OAUTH_NO_TOKEN', 'OAuth response had no access token')
    }
    token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    }
    return token.value
  }

  async function call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await accessToken()}`,
      'developer-token': config.developerToken,
      'content-type': 'application/json',
    }
    if (config.loginCustomerId) headers['login-customer-id'] = config.loginCustomerId
    let res: Response
    try {
      res = await fetchImpl(
        `${API_ROOT}/${config.apiVersion}/customers/${config.customerId}:${method}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
    } catch {
      throw new GoogleAdsRequestError('NETWORK', `${method}: request did not complete`)
    }
    if (!res.ok) {
      // The body names the failure; keep only the first error code.
      const failure = (await res.json().catch(() => null)) as {
        error?: { details?: GoogleAdsErrorDetail[] }
      } | null
      const code = Object.values(failure?.error?.details?.[0]?.errors?.[0]?.errorCode ?? {})[0]
      throw new GoogleAdsRequestError(code ?? `HTTP_${res.status}`, `${method}: HTTP ${res.status}`)
    }
    return res.json()
  }

  return {
    async uploadClickConversions(conversions, { validateOnly }) {
      if (conversions.length === 0) return []
      const response = await call('uploadClickConversions', {
        conversions: conversions.map((c) => ({
          [c.clickIdType]: c.clickId,
          conversionAction: c.conversionAction,
          conversionDateTime: googleAdsDateTime(c.conversionDateTime),
          orderId: c.orderId,
        })),
        partialFailure: true,
        validateOnly,
      })
      return mapPartialFailure(response, conversions.length)
    },
    async uploadRetractions(retractions, { validateOnly }) {
      if (retractions.length === 0) return []
      const response = await call('uploadConversionAdjustments', {
        conversionAdjustments: retractions.map((r) => ({
          conversionAction: r.conversionAction,
          adjustmentType: 'RETRACTION',
          adjustmentDateTime: googleAdsDateTime(r.adjustmentDateTime),
          orderId: r.orderId,
        })),
        partialFailure: true,
        validateOnly,
      })
      return mapPartialFailure(response, retractions.length)
    },
  }
}
