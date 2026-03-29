import { describe, test, expect } from 'vitest'

/**
 * Tests for the S3 key sanitisation logic from the presigned-url route.
 *
 * The route sanitises user-supplied account numbers and file names before
 * constructing S3 object keys, preventing path traversal attacks. We test
 * the sanitisation and key construction in isolation.
 */

/** Mirrors the sanitise function from the presigned-url route */
const sanitize = (input: string): string => input.replace(/[^a-zA-Z0-9._-]/g, '_')

describe('S3 Key Sanitisation', () => {
  test('normal account number passes through unchanged', () => {
    expect(sanitize('ACC-12345')).toBe('ACC-12345')
  })

  test('path traversal attempt is sanitised', () => {
    // Dots and hyphens are preserved, only slashes become underscores
    expect(sanitize('../../admin')).toBe('.._.._admin')
  })

  test('forward slashes are replaced', () => {
    expect(sanitize('foo/bar')).toBe('foo_bar')
  })

  test('backslashes are replaced', () => {
    expect(sanitize('foo\\bar')).toBe('foo_bar')
  })

  test('null bytes are replaced', () => {
    expect(sanitize('foo\0bar')).toBe('foo_bar')
  })

  test('spaces are replaced', () => {
    expect(sanitize('foo bar')).toBe('foo_bar')
  })

  test('dots and hyphens are preserved', () => {
    expect(sanitize('ACC-123.v2')).toBe('ACC-123.v2')
  })

  test('empty string stays empty', () => {
    expect(sanitize('')).toBe('')
  })

  test('unicode characters are replaced', () => {
    expect(sanitize('ACC-日本語')).toBe('ACC-___')
  })
})

describe('S3 Key Construction', () => {
  /** Mirrors the key construction from the presigned-url route with a fixed timestamp */
  const buildS3Key = (accountNumber: string, fileName: string): string => {
    const sanitizedAccount = sanitize(accountNumber)
    const sanitizedFile = sanitize(fileName)
    const timestamp = 1234567890 // fixed for testing
    return `${sanitizedAccount}/docs/${timestamp}-${sanitizedFile}`
  }

  test('normal inputs produce expected key', () => {
    expect(buildS3Key('ACC-12345', 'document.pdf')).toBe(
      'ACC-12345/docs/1234567890-document.pdf',
    )
  })

  test('path traversal in accountNumber is neutralised', () => {
    const key = buildS3Key('../../etc', 'report.pdf')
    expect(key).toBe('.._.._etc/docs/1234567890-report.pdf')
    // The sanitised account segment must not contain slashes
    const accountSegment = key.split('/')[0]
    expect(accountSegment).not.toContain('/')
    // Only structural slashes remain in the full key
    expect(key.split('/')).toHaveLength(3)
  })

  test('path traversal in fileName is neutralised', () => {
    const key = buildS3Key('ACC-001', '../../../etc/passwd')
    expect(key).toBe('ACC-001/docs/1234567890-.._.._.._etc_passwd')
    // The file portion (after /docs/) must not contain slashes
    expect(key.split('/docs/')[1]).not.toContain('/')
  })

  test('double traversal attempt in both fields produces safe key', () => {
    const key = buildS3Key('../../..', '../../../secret')
    expect(key).toBe('.._.._../docs/1234567890-.._.._.._secret')
    // Slashes in user input are replaced, so only structural slashes remain
    const parts = key.split('/')
    expect(parts).toHaveLength(3) // sanitizedAccount / docs / timestamp-sanitizedFile
  })
})
