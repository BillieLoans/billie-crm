import { describe, it, expect } from 'vitest'
import {
  CONFIRM_WORD,
  DELETION_WARNING_COPY,
  KEPT_DATA_COPY,
  STATEMENT_SUBFOLDERS,
  confirmDeletionWarning,
  isKeptKey,
  isKeyWithinPrefixes,
  isValidApplicationNumber,
  keptStatementKeys,
  statementPrefixes,
} from '@/lib/statement-deletion'

describe('statement-deletion helpers', () => {
  it('states the confirm warning, with backups erased after 180 days', () => {
    expect(confirmDeletionWarning(3, 1)).toBe(
      "3 files across 1 application will be deleted from Billie's storage now. Backup copies are erased after 180 days.",
    )
    expect(confirmDeletionWarning(1, 2)).toBe(
      "1 file across 2 applications will be deleted from Billie's storage now. Backup copies are erased after 180 days.",
    )
  })

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

  it('keeps exactly one key: the application affordability report', () => {
    expect(keptStatementKeys('customer', 'APP-1')).toEqual([
      'customer/APP-1/AffordabilityReports/APP-1_affordability.json',
    ])
    expect(keptStatementKeys('/demo/', 'APP-1')).toEqual([
      'demo/APP-1/AffordabilityReports/APP-1_affordability.json',
    ])
  })

  it('throws on an invalid number or empty base when building the kept keys', () => {
    expect(() => keptStatementKeys('customer', 'APP/1')).toThrow()
    expect(() => keptStatementKeys('customer', '../x')).toThrow()
    expect(() => keptStatementKeys('', 'APP-1')).toThrow()
    expect(() => keptStatementKeys('/', 'APP-1')).toThrow()
  })

  it('matches a kept key exactly, nothing near it', () => {
    const kept = keptStatementKeys('customer', 'APP-1')
    expect(isKeptKey('customer/APP-1/AffordabilityReports/APP-1_affordability.json', kept)).toBe(
      true,
    )
    for (const key of [
      'customer/APP-1/AffordabilityReports/sub/APP-1_affordability.json',
      'customer/APP-1/statements/APP-1_affordability.json',
      'customer/APP-1/AffordabilityReports/APP-10_affordability.json',
      'customer/APP-10/AffordabilityReports/APP-10_affordability.json',
      'customer/APP-1/AffordabilityReports/APP-1_categorized.csv',
      'customer/APP-1/AffordabilityReports/APP-1_accounts.json',
    ]) {
      expect(isKeptKey(key, kept)).toBe(false)
    }
  })

  it('exposes verbatim copy', () => {
    expect(CONFIRM_WORD).toBe('DELETE')
    expect(KEPT_DATA_COPY).toBe(
      'Kept: the affordability report file (category totals), the affordability summary, account-holder names and credit assessment records in the CRM, and anything held by TaleFin.',
    )
    expect(DELETION_WARNING_COPY.in_progress).toBe(
      "This application is still in progress. Deleting its statements may break the assessment that's about to read them.",
    )
    expect(DELETION_WARNING_COPY.funded_loan).toBe(
      'This application has a funded loan. Responsible-lending record-keeping may require keeping these statements — check before going ahead.',
    )
  })
})
