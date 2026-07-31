import { describe, it, expect } from 'vitest'
import { formatCurrency } from '@/lib/formatters'

// ux-standards.md §5 requires the shared formatters rather than ad-hoc Intl calls.
// Twelve components had grown their own formatCurrency, and they disagreed: some
// returned an em-dash for missing values, others produced "$NaN". Widening the
// shared helper is what lets those duplicates be deleted.
describe('formatCurrency', () => {
  it('formats a number as AUD', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50')
  })

  it('accepts a numeric string, as the ledger returns decimals as strings', () => {
    expect(formatCurrency('1234.50')).toBe('$1,234.50')
  })

  it('returns an em-dash for null', () => {
    expect(formatCurrency(null)).toBe('—')
  })

  it('returns an em-dash for undefined', () => {
    expect(formatCurrency(undefined)).toBe('—')
  })

  it('returns an em-dash for an empty string', () => {
    expect(formatCurrency('')).toBe('—')
  })

  it('returns an em-dash for an unparseable string rather than $NaN', () => {
    expect(formatCurrency('not-a-number')).toBe('—')
  })

  it('supports whole-dollar display for summary widgets', () => {
    expect(formatCurrency(1234.56, { fractionDigits: 0 })).toBe('$1,235')
  })
})
