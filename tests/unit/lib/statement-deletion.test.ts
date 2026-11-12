import { describe, it, expect } from 'vitest'
import {
  CONFIRM_WORD,
  DELETION_WARNING_COPY,
  KEPT_DATA_COPY,
  STATEMENT_SUBFOLDERS,
  isKeyWithinPrefixes,
  isValidApplicationNumber,
  statementPrefixes,
} from '@/lib/statement-deletion'

describe('statement-deletion helpers', () => {
  it('builds the two prefixes, each ending in a slash', () => {
    expect(statementPrefixes('customer', 'APP-1')).toEqual([
      'customer/APP-1/statements/',
      'customer/APP-1/AffordabilityReports/',
    ])
    expect(STATEMENT_SUBFOLDERS).toEqual(['statements', 'AffordabilityReports'])
  })

  it('strips leading and trailing slashes from the base', () => {
    expect(statementPrefixes('/demo/', 'APP-1')[0]).toBe('demo/APP-1/statements/')
  })

  it('rejects invalid application numbers', () => {
    for (const bad of ['', 'APP/1', '../x', 'APP 1', 'a..b/c', null, 42]) {
      expect(isValidApplicationNumber(bad)).toBe(false)
    }
    expect(isValidApplicationNumber('APP_1-b')).toBe(true)
  })

  it('throws on an invalid number or empty base', () => {
    expect(() => statementPrefixes('customer', 'APP/1')).toThrow()
    expect(() => statementPrefixes('', 'APP-1')).toThrow()
    expect(() => statementPrefixes('/', 'APP-1')).toThrow()
  })

  it('checks keys against prefixes without prefix collisions', () => {
    const p = statementPrefixes('customer', 'APP-1')
    expect(isKeyWithinPrefixes('customer/APP-1/statements/a.json', p)).toBe(true)
    expect(isKeyWithinPrefixes('customer/APP-1/AffordabilityReports/a.json', p)).toBe(true)
    expect(isKeyWithinPrefixes('customer/APP-10/statements/a.json', p)).toBe(false)
    expect(isKeyWithinPrefixes('customer/APP-1/StatementCapture/a.json', p)).toBe(false)
  })

  it('exposes verbatim copy', () => {
    expect(CONFIRM_WORD).toBe('DELETE')
    expect(KEPT_DATA_COPY).toBe(
      'Kept: the affordability summary, account-holder names and credit assessment records in the CRM, and anything held by TaleFin.',
    )
    expect(DELETION_WARNING_COPY.in_progress).toBe(
      "This application is still in progress. Deleting its statements may break the assessment that's about to read them.",
    )
    expect(DELETION_WARNING_COPY.funded_loan).toBe(
      'This application has a funded loan. Responsible-lending record-keeping may require keeping these statements — check before going ahead.',
    )
  })
})
