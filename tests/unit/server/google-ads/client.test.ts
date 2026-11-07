/**
 * BTB-546: the Google Ads REST client — what goes over the wire, and how a
 * partial-failure response maps back to rows.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  GoogleAdsRequestError,
  createGoogleAdsClient,
  googleAdsDateTime,
  mapPartialFailure,
} from '@/server/google-ads/client'
import type { GoogleAdsConfig } from '@/server/google-ads/config'

const CONFIG: GoogleAdsConfig = {
  mode: 'live',
  apiVersion: 'v22',
  developerToken: 'dev-token',
  customerId: '1234567890',
  loginCustomerId: '9999999999',
  oauthClientId: 'client-id',
  oauthClientSecret: 'client-secret',
  oauthRefreshToken: 'refresh-token',
  conversionActions: {
    approved: 'customers/1234567890/conversionActions/111',
    funded: 'customers/1234567890/conversionActions/222',
  },
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeFetch(apiResponse: Response | (() => Response)) {
  return vi.fn(async (url: string | URL | Request) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      return json({ access_token: 'access-1', expires_in: 3600 })
    }
    return typeof apiResponse === 'function' ? apiResponse() : apiResponse
  })
}

describe('googleAdsDateTime', () => {
  it('formats in UTC with an explicit offset', () => {
    expect(googleAdsDateTime(new Date('2026-11-06T03:04:05.678Z'))).toBe(
      '2026-11-06 03:04:05+00:00',
    )
  })
})

describe('mapPartialFailure', () => {
  it('is all ok without a partial failure error', () => {
    expect(mapPartialFailure({ results: [{}, {}] }, 2)).toEqual([{ ok: true }, { ok: true }])
  })

  it('maps each error to the row at its index', () => {
    const response = {
      results: [{}, { gclid: 'b' }, {}],
      partialFailureError: {
        code: 3,
        details: [
          {
            errors: [
              {
                errorCode: { conversionUploadError: 'TOO_RECENT_GCLID' },
                location: { fieldPathElements: [{ fieldName: 'conversions', index: 0 }] },
              },
              {
                errorCode: { conversionUploadError: 'GCLID_NOT_FOUND' },
                location: {
                  fieldPathElements: [
                    { fieldName: 'conversions', index: 2 },
                    { fieldName: 'gclid' },
                  ],
                },
              },
            ],
          },
        ],
      },
    }
    expect(mapPartialFailure(response, 3)).toEqual([
      { ok: false, errorCode: 'TOO_RECENT_GCLID' },
      { ok: true },
      { ok: false, errorCode: 'GCLID_NOT_FOUND' },
    ])
  })

  it('treats an error that names no row as a whole-request failure', () => {
    const response = {
      partialFailureError: {
        details: [{ errors: [{ errorCode: { authorizationError: 'USER_PERMISSION_DENIED' } }] }],
      },
    }
    expect(() => mapPartialFailure(response, 2)).toThrow(GoogleAdsRequestError)
    try {
      mapPartialFailure(response, 2)
    } catch (e) {
      expect((e as GoogleAdsRequestError).code).toBe('USER_PERMISSION_DENIED')
    }
  })
})

describe('createGoogleAdsClient', () => {
  it('sends only the click id, conversion action, time and order id', async () => {
    const fetchImpl = fakeFetch(json({ results: [{}] }))
    const client = createGoogleAdsClient(CONFIG, fetchImpl as unknown as typeof fetch)

    const results = await client.uploadClickConversions(
      [
        {
          clickIdType: 'gbraid',
          clickId: 'gb-1',
          conversionAction: CONFIG.conversionActions.approved,
          conversionDateTime: new Date('2026-11-06T03:04:05Z'),
          orderId: 'APP-1',
        },
      ],
      { validateOnly: true },
    )

    expect(results).toEqual([{ ok: true }])
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit]
    expect(url).toBe(
      'https://googleads.googleapis.com/v22/customers/1234567890:uploadClickConversions',
    )
    expect(init.headers).toMatchObject({
      authorization: 'Bearer access-1',
      'developer-token': 'dev-token',
      'login-customer-id': '9999999999',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      conversions: [
        {
          gbraid: 'gb-1',
          conversionAction: 'customers/1234567890/conversionActions/111',
          conversionDateTime: '2026-11-06 03:04:05+00:00',
          orderId: 'APP-1',
        },
      ],
      partialFailure: true,
      validateOnly: true,
    })
  })

  it('sends a retraction by order id', async () => {
    const fetchImpl = fakeFetch(json({ results: [{}] }))
    const client = createGoogleAdsClient(CONFIG, fetchImpl as unknown as typeof fetch)
    await client.uploadRetractions(
      [
        {
          conversionAction: CONFIG.conversionActions.approved,
          adjustmentDateTime: new Date('2026-11-08T00:00:00Z'),
          orderId: 'APP-1',
        },
      ],
      { validateOnly: false },
    )
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit]
    expect(url).toMatch(/:uploadConversionAdjustments$/)
    expect(JSON.parse(String(init.body))).toEqual({
      conversionAdjustments: [
        {
          conversionAction: 'customers/1234567890/conversionActions/111',
          adjustmentType: 'RETRACTION',
          adjustmentDateTime: '2026-11-08 00:00:00+00:00',
          orderId: 'APP-1',
        },
      ],
      partialFailure: true,
      validateOnly: false,
    })
  })

  it('reuses the access token across calls', async () => {
    const fetchImpl = fakeFetch(() => json({ results: [{}] }))
    const client = createGoogleAdsClient(CONFIG, fetchImpl as unknown as typeof fetch)
    const one = {
      conversionAction: CONFIG.conversionActions.approved,
      adjustmentDateTime: new Date(),
      orderId: 'A',
    }
    await client.uploadRetractions([one], { validateOnly: false })
    await client.uploadRetractions([one], { validateOnly: false })
    const tokenCalls = fetchImpl.mock.calls.filter(([u]) => String(u).includes('oauth2'))
    expect(tokenCalls).toHaveLength(1)
  })

  it('throws a request error with the first error code on an HTTP failure', async () => {
    const fetchImpl = fakeFetch(
      json(
        {
          error: {
            code: 401,
            message: 'echoes the request',
            details: [{ errors: [{ errorCode: { authenticationError: 'NOT_ADS_USER' } }] }],
          },
        },
        401,
      ),
    )
    const client = createGoogleAdsClient(CONFIG, fetchImpl as unknown as typeof fetch)
    const err = await client
      .uploadClickConversions(
        [
          {
            clickIdType: 'gclid',
            clickId: 'g',
            conversionAction: CONFIG.conversionActions.approved,
            conversionDateTime: new Date(),
            orderId: 'A',
          },
        ],
        { validateOnly: false },
      )
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GoogleAdsRequestError)
    expect((err as GoogleAdsRequestError).code).toBe('NOT_ADS_USER')
    expect((err as Error).message).not.toContain('echoes')
  })

  it('makes no call for an empty batch', async () => {
    const fetchImpl = fakeFetch(json({}))
    const client = createGoogleAdsClient(CONFIG, fetchImpl as unknown as typeof fetch)
    expect(await client.uploadClickConversions([], { validateOnly: false })).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
