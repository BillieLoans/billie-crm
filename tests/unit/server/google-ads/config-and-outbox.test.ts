/**
 * BTB-546: settings, outbox row shaping and result handling (pure parts).
 * The SQL is covered against real Postgres in
 * tests/int/google-ads-conversions.int.spec.ts.
 */
import { describe, expect, it } from 'vitest'
import { googleAdsMode, readGoogleAdsConfig } from '@/server/google-ads/config'
import {
  CLICK_SETTLE_MS,
  buildOutboxRow,
  outcomeFor,
  type ConversionCandidate,
} from '@/server/google-ads/conversions'

const FULL_ENV = {
  GOOGLE_ADS_CONVERSIONS_MODE: 'live',
  GOOGLE_ADS_API_VERSION: 'v22',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'dev',
  GOOGLE_ADS_CUSTOMER_ID: '123-456-7890',
  GOOGLE_ADS_OAUTH_CLIENT_ID: 'id',
  GOOGLE_ADS_OAUTH_CLIENT_SECRET: 'secret',
  GOOGLE_ADS_OAUTH_REFRESH_TOKEN: 'refresh',
  GOOGLE_ADS_CONVERSION_ACTION_APPROVED: '111',
  GOOGLE_ADS_CONVERSION_ACTION_FUNDED: 'customers/1234567890/conversionActions/222',
} as unknown as NodeJS.ProcessEnv

describe('Google Ads settings', () => {
  it('is off unless the mode is validate_only or live', () => {
    expect(googleAdsMode({} as NodeJS.ProcessEnv)).toBe('off')
    expect(googleAdsMode({ GOOGLE_ADS_CONVERSIONS_MODE: 'yes' } as never)).toBe('off')
    expect(googleAdsMode({ GOOGLE_ADS_CONVERSIONS_MODE: ' LIVE ' } as never)).toBe('live')
    expect(googleAdsMode({ GOOGLE_ADS_CONVERSIONS_MODE: 'validate_only' } as never)).toBe(
      'validate_only',
    )
  })

  it('reads a complete configuration', () => {
    const result = readGoogleAdsConfig(FULL_ENV)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.customerId).toBe('1234567890')
    expect(result.config.loginCustomerId).toBeNull()
    expect(result.config.conversionActions).toEqual({
      approved: 'customers/1234567890/conversionActions/111',
      funded: 'customers/1234567890/conversionActions/222',
    })
  })

  it('names what is missing, never the values', () => {
    const result = readGoogleAdsConfig({
      ...FULL_ENV,
      GOOGLE_ADS_DEVELOPER_TOKEN: '',
      GOOGLE_ADS_API_VERSION: '22',
      GOOGLE_ADS_CONVERSION_ACTION_FUNDED: 'not-an-id',
    })
    expect(result).toEqual({
      ok: false,
      mode: 'live',
      missing: [
        'GOOGLE_ADS_API_VERSION',
        'GOOGLE_ADS_DEVELOPER_TOKEN',
        'GOOGLE_ADS_CONVERSION_ACTION_FUNDED',
      ],
    })
  })
})

describe('buildOutboxRow', () => {
  const now = new Date('2026-11-06T12:00:00Z')
  const candidate = (over: Partial<ConversionCandidate> = {}): ConversionCandidate => ({
    applicationNumber: 'APP-1',
    conversationId: 'conv-1',
    convertedAt: new Date('2026-11-06T02:00:00Z'),
    mockOrigin: false,
    attribution: {
      gclid: 'gclid-1',
      received_at: '2026-11-06T01:00:00Z',
      captured_at: '2026-11-06T00:59:58Z',
    },
    startedAt: new Date('2026-11-06T01:00:05Z'),
    ...over,
  })

  it('returns null without a click id', () => {
    expect(
      buildOutboxRow(candidate({ attribution: { utm_source: 'google' } }), 'approved', now),
    ).toBeNull()
    expect(buildOutboxRow(candidate({ attribution: null }), 'approved', now)).toBeNull()
  })

  it('prefers gclid, then gbraid, then wbraid', () => {
    const row = buildOutboxRow(
      candidate({ attribution: { wbraid: 'w', gbraid: 'g' } }),
      'approved',
      now,
    )
    expect(row).toMatchObject({ clickIdType: 'gbraid', clickId: 'g' })
  })

  it('rejects a click id with characters a click id never has', () => {
    expect(
      buildOutboxRow(candidate({ attribution: { gclid: 'a b<script>' } }), 'approved', now),
    ).toBeNull()
  })

  it('times the click from the server receipt and waits for Google to settle it', () => {
    const row = buildOutboxRow(candidate(), 'approved', now)!
    expect(row.clickAt.toISOString()).toBe('2026-11-06T01:00:00.000Z')
    expect(row.notBefore.getTime()).toBe(row.clickAt.getTime() + CLICK_SETTLE_MS)
    expect(row.expiresAt.toISOString()).toBe('2027-02-04T01:00:00.000Z')
    expect(row.status).toBe('pending')
  })

  it('ignores a click time after the conversion (a wrong browser clock)', () => {
    const row = buildOutboxRow(
      candidate({
        attribution: { gclid: 'g', captured_at: '2030-01-01T00:00:00Z' },
        startedAt: new Date('2026-11-06T01:30:00Z'),
      }),
      'approved',
      now,
    )!
    expect(row.clickAt.toISOString()).toBe('2026-11-06T01:30:00.000Z')
  })

  it('writes a row past the click window as expired', () => {
    const row = buildOutboxRow(
      candidate({
        attribution: { gclid: 'g', received_at: '2026-07-01T00:00:00Z' },
        convertedAt: new Date('2026-10-30T00:00:00Z'),
      }),
      'funded',
      now,
    )!
    expect(row).toMatchObject({ status: 'expired', statusReason: 'CLICK_WINDOW' })
  })
})

describe('outcomeFor', () => {
  it('counts success and "already exists" as sent', () => {
    expect(outcomeFor({ ok: true }, 'live')).toEqual({ kind: 'sent' })
    expect(outcomeFor({ ok: false, errorCode: 'CLICK_CONVERSION_ALREADY_EXISTS' }, 'live')).toEqual(
      { kind: 'sent' },
    )
  })

  it('retries a click or conversion Google has not processed yet after it settles', () => {
    for (const code of ['TOO_RECENT_GCLID', 'TOO_RECENT_CONVERSION', 'CONVERSION_NOT_FOUND']) {
      expect(outcomeFor({ ok: false, errorCode: code }, 'live')).toEqual({
        kind: 'retry',
        errorCode: code,
        delayMs: CLICK_SETTLE_MS,
        unrecognised: false,
      })
    }
  })

  it('fails for good only on an error about the click itself', () => {
    expect(outcomeFor({ ok: false, errorCode: 'GCLID_NOT_FOUND' }, 'live').kind).toBe('failed')
    expect(outcomeFor({ ok: false, errorCode: 'EXPIRED_GCLID' }, 'live')).toEqual({
      kind: 'expired',
      errorCode: 'EXPIRED_GCLID',
    })
  })

  it('retries an unknown or configuration error daily and flags it', () => {
    expect(outcomeFor({ ok: false, errorCode: 'INVALID_CONVERSION_ACTION' }, 'live')).toEqual({
      kind: 'retry',
      errorCode: 'INVALID_CONVERSION_ACTION',
      delayMs: 24 * 3_600_000,
      unrecognised: true,
    })
  })

  it('only records the check in validate-only mode', () => {
    expect(outcomeFor({ ok: true }, 'validate_only')).toEqual({
      kind: 'validated',
      errorCode: null,
    })
    expect(outcomeFor({ ok: false, errorCode: 'GCLID_NOT_FOUND' }, 'validate_only')).toEqual({
      kind: 'validated',
      errorCode: 'GCLID_NOT_FOUND',
    })
  })
})
