import { describe, it, expect } from 'vitest'
import { normaliseAuMobile, normaliseEmail, siblingBases } from '@/lib/marketing'

// Parity cases mirroring the platform's normalise_mobile/normalise_email
// (marketingService commands.py) — the duplicate pre-check must resolve the
// same way the UpsertContact command does.
describe('normaliseAuMobile', () => {
  it.each([
    ['0403 320 117', '+61403320117'],
    ['0403-320-117', '+61403320117'],
    ['61403320117', '+61403320117'],
    ['+61403320117', '+61403320117'],
    ['+61 403 320 117', '+61403320117'],
  ])('normalises %s to %s', (raw, expected) => {
    expect(normaliseAuMobile(raw)).toBe(expected)
  })

  it.each([
    ['', null],
    [null, null],
    [undefined, null],
    ['12345', null], // not an AU shape
    ['0403 320 11', null], // too short
    ['+6140332011789', null], // too long
    ['+64211234567', null], // NZ number
  ])('rejects %s', (raw, expected) => {
    expect(normaliseAuMobile(raw as string | null | undefined)).toBe(expected)
  })
})

describe('normaliseEmail', () => {
  it('lowercases and trims', () => {
    expect(normaliseEmail('  Rohan@Billie.LOANS ')).toBe('rohan@billie.loans')
  })
  it('returns null for empty/blank', () => {
    expect(normaliseEmail('')).toBeNull()
    expect(normaliseEmail('   ')).toBeNull()
    expect(normaliseEmail(null)).toBeNull()
  })
})

describe('siblingBases', () => {
  const self = { customerId: 'CUST-1', mobileE164: '+61403320117', email: 'rohan@billie.loans' }

  it('collects every matching basis in display order', () => {
    expect(siblingBases(self, self)).toEqual(['same_customer', 'same_mobile', 'same_email'])
    expect(
      siblingBases(self, { customerId: 'CUST-1', mobileE164: '+61400111222', email: null }),
    ).toEqual(['same_customer'])
    expect(
      siblingBases(self, { customerId: null, mobileE164: null, email: 'rohan@billie.loans' }),
    ).toEqual(['same_email'])
  })

  it('never matches on a key the contact itself lacks', () => {
    const noKeys = { customerId: null, mobileE164: null, email: null }
    expect(siblingBases(noKeys, self)).toEqual([])
    // Both null must not count as "same"
    expect(siblingBases(noKeys, noKeys)).toEqual([])
  })
})
