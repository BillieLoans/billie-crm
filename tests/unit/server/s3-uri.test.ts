/**
 * Tests for parseS3Uri from src/server/s3-client.ts
 *
 * The assessment proxy routes (account-conduct, serviceability) call
 * parseS3Uri to extract the bucket and key from stored s3:// URIs, and
 * then check key.includes('..') to block path traversal (NFR8).
 */

import { describe, test, expect } from 'vitest'
import { parseS3Uri } from '@/server/s3-client'

describe('parseS3Uri', () => {
  test('parses a valid s3:// URI', () => {
    const { bucket, key } = parseS3Uri('s3://my-bucket/path/to/report.json')
    expect(bucket).toBe('my-bucket')
    expect(key).toBe('path/to/report.json')
  })

  test('parses a URI with nested key path', () => {
    const { bucket, key } = parseS3Uri('s3://billie-applications-nonprod/conv-123/account-conduct/result.json')
    expect(bucket).toBe('billie-applications-nonprod')
    expect(key).toBe('conv-123/account-conduct/result.json')
  })

  test('trims surrounding whitespace before parsing', () => {
    const { bucket, key } = parseS3Uri('  s3://bucket/key.json  ')
    expect(bucket).toBe('bucket')
    expect(key).toBe('key.json')
  })

  test('throws for a non-s3:// URI', () => {
    expect(() => parseS3Uri('https://s3.amazonaws.com/bucket/key')).toThrow()
  })

  test('throws for a URI missing a key', () => {
    // s3://bucket-only (no slash after bucket name) — no key segment
    expect(() => parseS3Uri('s3://bucket-only')).toThrow()
  })

  test('throws for an empty string', () => {
    expect(() => parseS3Uri('')).toThrow()
  })

  test('throws for a plain file path', () => {
    expect(() => parseS3Uri('/some/local/path.json')).toThrow()
  })

  // Path traversal — the route checks key.includes('..') after parsing.
  // Verify the key extracted from a traversal URI actually contains '..'
  // so the route-level guard fires correctly.
  test('parsed key from path-traversal URI contains ".." (guard detects it)', () => {
    const { key } = parseS3Uri('s3://bucket/../../etc/passwd')
    expect(key).toContain('..')
  })

  test('legitimate key with dots in filename does NOT contain ".."', () => {
    const { key } = parseS3Uri('s3://bucket/conv-123/v1.2/report.final.json')
    expect(key).not.toContain('..')
  })
})
