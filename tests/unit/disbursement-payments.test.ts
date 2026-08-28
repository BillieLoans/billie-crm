import { describe, it, expect } from 'vitest'
import {
  BILLIE_REPAYMENT_ACCOUNT,
  OSKO_MESSAGE_MAX_LENGTH,
  buildOskoMessage,
  calculateDailyLimitUsage,
  isWithinOskoLimit,
} from '@/lib/disbursement-payments'

describe('buildOskoMessage', () => {
  const input = { reference: 'F92C001D-AB9', firstDueDate: '2026-09-04' }

  it('carries the loan reference, first due date and both repayment rails', () => {
    const msg = buildOskoMessage(input)
    expect(msg).toContain('F92C001D-AB9')
    expect(msg).toContain('04/09/2026')
    expect(msg).toContain(BILLIE_REPAYMENT_ACCOUNT.payId)
    expect(msg).toContain(BILLIE_REPAYMENT_ACCOUNT.bsb)
    expect(msg).toContain(BILLIE_REPAYMENT_ACCOUNT.accountNumber)
  })

  it('names the ANZ account as Finscale, matching the agreement and the bank', () => {
    // The ASIC rename is not reflected at ANZ yet (BTB-275); the agreement discloses
    // Finscale too, so "correcting" this would make the document and bank disagree.
    expect(buildOskoMessage(input)).toContain('Finscale Pty Ltd')
  })

  it('fits inside the 280-character Osko message field', () => {
    expect(isWithinOskoLimit(buildOskoMessage(input))).toBe(true)
  })

  it('stays within the limit even with an unusually long reference', () => {
    const msg = buildOskoMessage({ reference: 'X'.repeat(60), firstDueDate: '2026-09-04' })
    expect(msg.length).toBeLessThanOrEqual(OSKO_MESSAGE_MAX_LENGTH)
  })

  it('still gives complete payment instructions when the reference is missing', () => {
    const msg = buildOskoMessage({ reference: null, firstDueDate: '2026-09-04' })
    expect(msg).toContain(BILLIE_REPAYMENT_ACCOUNT.payId)
    expect(msg).not.toContain('Reference')
  })

  it('omits the due date rather than printing an invalid one', () => {
    const msg = buildOskoMessage({ reference: 'REF-1', firstDueDate: 'not-a-date' })
    expect(msg).not.toContain('First repayment')
    expect(msg).toContain('REF-1')
  })

  it('handles a missing due date', () => {
    const msg = buildOskoMessage({ reference: 'REF-1', firstDueDate: null })
    expect(msg).toContain('REF-1')
    expect(msg).not.toContain('First repayment')
  })
})

describe('calculateDailyLimitUsage', () => {
  it('projects paid plus queued, not just what has gone out', () => {
    const usage = calculateDailyLimitUsage(400, 600, 10_000)
    expect(usage.projectedTotal).toBe(1000)
    expect(usage.ratio).toBeCloseTo(0.1)
    expect(usage.status).toBe('ok')
  })

  it('warns at 80% of the limit', () => {
    expect(calculateDailyLimitUsage(8000, 0, 10_000).status).toBe('warn')
  })

  it('stays ok just below the warn threshold', () => {
    expect(calculateDailyLimitUsage(7999, 0, 10_000).status).toBe('ok')
  })

  it('reports exceeded at exactly the limit — the next payment would fail', () => {
    expect(calculateDailyLimitUsage(10_000, 0, 10_000).status).toBe('exceeded')
  })

  it('reports exceeded beyond the limit', () => {
    const usage = calculateDailyLimitUsage(9000, 3000, 10_000)
    expect(usage.status).toBe('exceeded')
    expect(usage.ratio).toBeGreaterThan(1)
  })

  it('treats negative inputs as zero rather than crediting headroom', () => {
    const usage = calculateDailyLimitUsage(-500, 1000, 10_000)
    expect(usage.projectedTotal).toBe(1000)
  })

  it('falls back to the configured limit when given a nonsensical one', () => {
    expect(calculateDailyLimitUsage(100, 0, 0).limit).toBeGreaterThan(0)
  })
})
