import { describe, it, expect } from 'vitest'
import { normaliseAuMobile, normaliseEmail } from '@/lib/marketing'

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
