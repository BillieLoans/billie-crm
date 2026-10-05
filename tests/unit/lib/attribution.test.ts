import { describe, expect, it } from 'vitest'

import { shapeAttribution } from '@/lib/attribution'

const STORED = {
  gclid: 'Cj0KCQjw-abc_123',
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'borrow-200',
  utm_term: 'pay advance',
  matchtype: 'p',
  captured_at: '2026-10-12T01:02:03.000Z',
  received_at: '2026-10-12T01:02:04+00:00',
}

describe('shapeAttribution', () => {
  it('maps the stored snake_case jsonb to the browser shape', () => {
    expect(shapeAttribution(STORED)).toEqual({
      gclid: 'Cj0KCQjw-abc_123',
      gbraid: null,
      wbraid: null,
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'borrow-200',
      utmContent: null,
      utmTerm: 'pay advance',
      matchtype: 'p',
      capturedAt: '2026-10-12T01:02:03.000Z',
      receivedAt: '2026-10-12T01:02:04+00:00',
    })
  })

  it('returns null for a missing or non-object value', () => {
    expect(shapeAttribution(null)).toBeNull()
    expect(shapeAttribution(undefined)).toBeNull()
    expect(shapeAttribution('gclid=abc')).toBeNull()
    expect(shapeAttribution([])).toBeNull()
  })

  it('returns null when no parameter is present', () => {
    expect(shapeAttribution({ captured_at: '2026-10-12T01:02:03Z' })).toBeNull()
  })

  it('ignores non-string values', () => {
    expect(shapeAttribution({ gclid: 'abc', utm_term: { $ne: null } })?.utmTerm).toBeNull()
  })
})
