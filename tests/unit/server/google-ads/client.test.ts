/**
 * BTB-546: the Data Manager API client — what goes over the wire, and how a
 * failure is classified (this event's fault vs the request's).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  GoogleAdsRequestError,
  classifyFailure,
  createGoogleAdsClient,
  rfc3339,
  type ConversionEvent,
} from '@/server/google-ads/client'
import type { GoogleAdsConfig } from '@/server/google-ads/config'

const CONFIG: GoogleAdsConfig = {
  mode: 'live',
  customerId: '9789998894',
  loginCustomerId: '3408470500',
  oauthClientId: 'client-id',
  oauthClientSecret: 'client-secret',
  oauthRefreshToken: 'refresh-token',
  conversionActions: { approved: '7891828470', funded: '222' },
}

const EVENT: ConversionEvent = {
  clickIdType: 'gbraid',
  clickId: 'gb-1',
  conversionActionId: '7891828470',
  eventTime: new Date('2026-11-06T03:04:05.678Z'),
  transactionId: 'APP-1',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeFetch(
  apiResponse: () => Response,
  token: () => Response = () => json({ access_token: 'access-1', expires_in: 3600 }),
) {
  return vi.fn(async (url: string | URL | Request) =>
    String(url).startsWith('https://oauth2.googleapis.com/token') ? token() : apiResponse(),
  )
}

describe('rfc3339', () => {
  it('formats in UTC to the second', () => {
    expect(rfc3339(new Date('2026-11-06T03:04:05.678Z'))).toBe('2026-11-06T03:04:05Z')
  })
})

describe('classifyFailure', () => {
  it("returns a row failure when every violation is in the event's fields", () => {
    const body = {
      error: {
        status: 'INVALID_ARGUMENT',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.BadRequest',
            fieldViolations: [
              { field: 'events.events[0].ad_identifiers.gclid', reason: 'INVALID_GCLID' },
            ],
          },
        ],
      },
    }
    expect(classifyFailure(400, body)).toEqual({ ok: false, errorCode: 'INVALID_GCLID' })
  })

  it('throws a request error for a destination or config problem', () => {
    const body = {
      error: {
        status: 'INVALID_ARGUMENT',
        details: [{ fieldViolations: [{ field: 'destinations[0].product_destination_id' }] }],
      },
    }
    expect(() => classifyFailure(400, body)).toThrow(GoogleAdsRequestError)
  })

  it('throws a request error for auth, quota and server failures, with the most specific code', () => {
    try {
      classifyFailure(403, {
        error: {
          status: 'PERMISSION_DENIED',
          details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
      })
      expect.unreachable()
    } catch (e) {
      expect((e as GoogleAdsRequestError).code).toBe('ACCESS_TOKEN_SCOPE_INSUFFICIENT')
    }
    expect(() => classifyFailure(503, null)).toThrow('HTTP 503')
  })
})

describe('createGoogleAdsClient', () => {
  it('sends one event with only the click id, time and transaction id', async () => {
    const fetchImpl = fakeFetch(() => json({ requestId: 'r-1' }))
    const client = createGoogleAdsClient(CONFIG, fetchImpl as unknown as typeof fetch)

    expect(await client.ingestConversion(EVENT, { validateOnly: true })).toEqual({ ok: true })

    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit]
    expect(url).toBe('https://datamanager.googleapis.com/v1/events:ingest')
    expect(init.headers).toEqual({
      authorization: 'Bearer access-1',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      destinations: [
        {
          operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '9789998894' },
          loginAccount: { accountType: 'GOOGLE_ADS', accountId: '3408470500' },
          productDestinationId: '7891828470',
        },
      ],
      events: [
        {
          adIdentifiers: { gbraid: 'gb-1' },
          eventTimestamp: '2026-11-06T03:04:05Z',
          transactionId: 'APP-1',
          eventSource: 'WEB',
        },
      ],
      validateOnly: true,
    })
  })

  it('omits the login account when there is none', async () => {
    const fetchImpl = fakeFetch(() => json({ requestId: 'r-1' }))
    const client = createGoogleAdsClient(
      { ...CONFIG, loginCustomerId: null },
      fetchImpl as unknown as typeof fetch,
    )
    await client.ingestConversion(EVENT, { validateOnly: false })
    const body = JSON.parse(
      String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body),
    )
    expect(body.destinations[0].loginAccount).toBeUndefined()
  })

  it('reuses the access token across calls', async () => {
    const fetchImpl = fakeFetch(() => json({ requestId: 'r' }))
    const client = createGoogleAdsClient(CONFIG, fetchImpl as unknown as typeof fetch)
    await client.ingestConversion(EVENT, { validateOnly: false })
    await client.ingestConversion(EVENT, { validateOnly: false })
    expect(fetchImpl.mock.calls.filter(([u]) => String(u).includes('oauth2'))).toHaveLength(1)
  })

  it('throws a request error with the OAuth error code when the refresh fails', async () => {
    const fetchImpl = fakeFetch(
      () => json({}),
      () => json({ error: 'invalid_grant', error_description: 'echoes things' }, 400),
    )
    const client = createGoogleAdsClient(CONFIG, fetchImpl as unknown as typeof fetch)
    const err = await client.ingestConversion(EVENT, { validateOnly: false }).catch((e) => e)
    expect(err).toBeInstanceOf(GoogleAdsRequestError)
    expect(err.code).toBe('OAUTH_INVALID_GRANT')
    expect(err.message).not.toContain('echoes')
  })
})
