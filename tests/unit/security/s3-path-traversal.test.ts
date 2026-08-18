import { describe, test, expect } from 'vitest'
import { sanitizeS3PathSegment, buildDisbursementAttachmentKey } from '@/server/uploads'

/**
 * Tests for the S3 key sanitisation used by the disbursement-attachment
 * upload route: user-supplied account numbers and file names must never be
 * able to introduce path separators into an S3 object key.
 */

describe('S3 Key Sanitisation', () => {
  test('normal account number passes through unchanged', () => {
    expect(sanitizeS3PathSegment('ACC-12345')).toBe('ACC-12345')
  })

  test('path traversal attempt is sanitised', () => {
    // Dots and hyphens are preserved, only slashes become underscores
    expect(sanitizeS3PathSegment('../../admin')).toBe('.._.._admin')
  })

  test('forward slashes are replaced', () => {
    expect(sanitizeS3PathSegment('foo/bar')).toBe('foo_bar')
  })

  test('backslashes are replaced', () => {
    expect(sanitizeS3PathSegment('foo\\bar')).toBe('foo_bar')
  })

  test('null bytes are replaced', () => {
    expect(sanitizeS3PathSegment('foo\0bar')).toBe('foo_bar')
  })

  test('spaces are replaced', () => {
    expect(sanitizeS3PathSegment('foo bar')).toBe('foo_bar')
  })

  test('dots and hyphens are preserved', () => {
    expect(sanitizeS3PathSegment('ACC-123.v2')).toBe('ACC-123.v2')
  })

  test('empty string stays empty', () => {
    expect(sanitizeS3PathSegment('')).toBe('')
  })

  test('unicode characters are replaced', () => {
    expect(sanitizeS3PathSegment('ACC-日本語')).toBe('ACC-___')
  })
})

describe('Disbursement Attachment Key Construction', () => {
  const TIMESTAMP = 1234567890 // fixed for testing

  test('normal inputs produce expected key', () => {
    expect(
      buildDisbursementAttachmentKey('2101C867-822', 'ACC-12345', 'document.pdf', TIMESTAMP),
    ).toBe('customer/2101C867-822/Disbursements/ACC-12345/1234567890-document.pdf')
  })

  test('path traversal in customerId is neutralised', () => {
    const key = buildDisbursementAttachmentKey('../../etc', 'ACC-001', 'report.pdf', TIMESTAMP)
    expect(key).toBe('customer/.._.._etc/Disbursements/ACC-001/1234567890-report.pdf')
    // The sanitised customer segment must not contain slashes
    const customerSegment = key.split('/')[1]
    expect(customerSegment).not.toContain('/')
    // Only structural slashes remain in the full key
    expect(key.split('/')).toHaveLength(5)
  })

  test('path traversal in accountNumber is neutralised', () => {
    const key = buildDisbursementAttachmentKey('CUST-1', '../../etc', 'report.pdf', TIMESTAMP)
    expect(key).toBe('customer/CUST-1/Disbursements/.._.._etc/1234567890-report.pdf')
    expect(key.split('/')).toHaveLength(5)
  })

  test('path traversal in fileName is neutralised', () => {
    const key = buildDisbursementAttachmentKey('CUST-1', 'ACC-001', '../../../etc/passwd', TIMESTAMP)
    expect(key).toBe('customer/CUST-1/Disbursements/ACC-001/1234567890-.._.._.._etc_passwd')
    // The file portion (final segment) must not contain slashes
    expect(key.split('/')).toHaveLength(5)
  })

  test('traversal attempts in every field produce a safe key', () => {
    const key = buildDisbursementAttachmentKey('../..', '../../..', '../../../secret', TIMESTAMP)
    expect(key).toBe('customer/.._../Disbursements/.._.._../1234567890-.._.._.._secret')
    // Slashes in user input are replaced, so only structural slashes remain
    const parts = key.split('/')
    expect(parts).toHaveLength(5) // customer / customerId / Disbursements / account / timestamp-file
  })
})
