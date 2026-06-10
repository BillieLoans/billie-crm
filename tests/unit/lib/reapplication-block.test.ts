// tests/unit/lib/reapplication-block.test.ts
import { describe, it, expect } from 'vitest'
import {
  formatBlockReason,
  formatBlockedUntil,
  isBlockActive,
  isBlockDeclineReason,
} from '@/lib/reapplicationBlock'

const TODAY = new Date('2026-06-10T12:00:00+10:00')

describe('formatBlockReason', () => {
  it('humanizes known reason enums', () => {
    expect(formatBlockReason('ID_VERIFICATION')).toBe('ID verification')
    expect(formatBlockReason('ACTIVE_LOAN')).toBe('Active loan')
    expect(formatBlockReason('PRIOR_DEFAULT')).toBe('Prior default')
    expect(formatBlockReason('PEP')).toBe('PEP')
    expect(formatBlockReason('SERVICEABILITY')).toBe('Serviceability')
    expect(formatBlockReason('ACCOUNT_CONDUCT')).toBe('Account conduct')
    expect(formatBlockReason('IDENTITY_CONFLICT')).toBe('Identity conflict')
  })

  it('falls back to the raw value for unknown enums', () => {
    expect(formatBlockReason('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })

  it('returns em dash for missing reason', () => {
    expect(formatBlockReason(null)).toBe('—')
    expect(formatBlockReason(undefined)).toBe('—')
  })
})

describe('formatBlockedUntil', () => {
  it('formats a dated window', () => {
    expect(
      formatBlockedUntil({ reason: 'ID_VERIFICATION', blockedUntil: '2026-12-10T01:02:21+00:00' }),
    ).toBe('until 10 December 2026')
  })

  it('null window is permanent for PEP-class reasons', () => {
    expect(formatBlockedUntil({ reason: 'PEP', blockedUntil: null })).toBe('permanent')
    expect(formatBlockedUntil({ reason: 'PRIOR_DEFAULT', blockedUntil: null })).toBe('permanent')
    expect(formatBlockedUntil({ reason: 'IDENTITY_CONFLICT', blockedUntil: null })).toBe('permanent')
  })

  it('null window is while-loan-open for ACTIVE_LOAN', () => {
    expect(formatBlockedUntil({ reason: 'ACTIVE_LOAN', blockedUntil: null })).toBe('while loan open')
  })
})

describe('isBlockActive', () => {
  it('false for missing block', () => {
    expect(isBlockActive(null, TODAY)).toBe(false)
    expect(isBlockActive(undefined, TODAY)).toBe(false)
    expect(isBlockActive({ reason: null, blockedUntil: null }, TODAY)).toBe(false)
  })

  it('active while blockedUntil is in the future', () => {
    expect(
      isBlockActive({ reason: 'ID_VERIFICATION', blockedUntil: '2026-12-10T01:02:21+00:00' }, TODAY),
    ).toBe(true)
  })

  it('inclusive boundary — still active on the blockedUntil day itself', () => {
    expect(isBlockActive({ reason: 'SERVICEABILITY', blockedUntil: '2026-06-10' }, TODAY)).toBe(true)
  })

  it('inactive once the window has lapsed', () => {
    expect(
      isBlockActive({ reason: 'SERVICEABILITY', blockedUntil: '2026-06-01T00:00:00+00:00' }, TODAY),
    ).toBe(false)
  })

  it('null window (permanent / ongoing) is always active', () => {
    expect(isBlockActive({ reason: 'PEP', blockedUntil: null }, TODAY)).toBe(true)
    expect(isBlockActive({ reason: 'ACTIVE_LOAN', blockedUntil: null }, TODAY)).toBe(true)
  })

  it('unparseable dates are treated as inactive', () => {
    expect(isBlockActive({ reason: 'PEP', blockedUntil: 'not-a-date' }, TODAY)).toBe(false)
  })
})

describe('isBlockDeclineReason', () => {
  it('matches REAPPLICATION_BLOCK-prefixed decision reasons', () => {
    expect(isBlockDeclineReason('REAPPLICATION_BLOCK:ID_VERIFICATION')).toBe(true)
    expect(isBlockDeclineReason('REAPPLICATION_BLOCK:PEP')).toBe(true)
  })

  it('does not match other or missing reasons', () => {
    expect(isBlockDeclineReason('SERVICEABILITY_FAILED')).toBe(false)
    expect(isBlockDeclineReason(null)).toBe(false)
    expect(isBlockDeclineReason(undefined)).toBe(false)
  })
})
