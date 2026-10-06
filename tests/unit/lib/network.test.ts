import { describe, expect, it } from 'vitest'

import { asnLabel, networkIpOf, shapeNetwork } from '@/lib/network'

const STORED = {
  country: 'AU',
  asn: '1221',
  ip: '203.0.113.9',
  received_at: '2026-10-12T01:02:04+00:00',
}

describe('shapeNetwork', () => {
  it('maps the stored snake_case jsonb to the browser shape without the IP', () => {
    expect(shapeNetwork(STORED)).toEqual({
      country: 'AU',
      asn: '1221',
      asnLabel: 'Telstra (AS1221)',
      receivedAt: '2026-10-12T01:02:04+00:00',
    })
  })

  it('returns null for a missing or non-object value', () => {
    expect(shapeNetwork(null)).toBeNull()
    expect(shapeNetwork(undefined)).toBeNull()
    expect(shapeNetwork('country=AU')).toBeNull()
    expect(shapeNetwork([])).toBeNull()
  })

  it('returns null when no value is present', () => {
    expect(shapeNetwork({ received_at: '2026-10-12T01:02:03Z' })).toBeNull()
  })

  it('keeps a record that has only an IP so a supervisor can still see it', () => {
    expect(shapeNetwork({ ip: '203.0.113.9' })).toEqual({
      country: null,
      asn: null,
      asnLabel: null,
      receivedAt: null,
    })
  })

  it('ignores non-string values', () => {
    expect(shapeNetwork({ country: 'AU', asn: { $ne: null } })?.asn).toBeNull()
  })
})

describe('asnLabel', () => {
  it('names the carriers staff will see most', () => {
    expect(asnLabel('1221')).toBe('Telstra (AS1221)')
    expect(asnLabel('4804')).toBe('Optus (AS4804)')
  })

  it('marks cloud and hosting providers', () => {
    expect(asnLabel('16509')).toBe('AWS (AS16509) — hosting')
    expect(asnLabel('14061')).toBe('DigitalOcean (AS14061) — hosting')
  })

  it('falls back to the bare number', () => {
    expect(asnLabel('123456')).toBe('AS123456')
  })

  it('is null for null', () => {
    expect(asnLabel(null)).toBeNull()
  })
})

describe('networkIpOf', () => {
  it('returns the stored IP', () => {
    expect(networkIpOf(STORED)).toBe('203.0.113.9')
  })

  it('is null when absent or malformed', () => {
    expect(networkIpOf({ country: 'AU' })).toBeNull()
    expect(networkIpOf(null)).toBeNull()
    expect(networkIpOf({ ip: 42 })).toBeNull()
  })
})
