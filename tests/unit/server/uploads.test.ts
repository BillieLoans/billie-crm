/**
 * Unit tests for the server-side upload helpers backing the proxied S3 upload
 * routes: capped body reading, magic-byte validation, and S3 path-segment
 * sanitisation.
 */
import { describe, test, expect } from 'vitest'
import {
  readBodyWithLimit,
  matchesMagicBytes,
  sanitizeS3PathSegment,
  DISBURSEMENT_ATTACHMENT_MAX_BYTES,
  ISSUE_SCREENSHOT_MAX_BYTES,
} from '@/server/uploads'

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0]

const bytesOf = (...parts: (number[] | string)[]): Uint8Array => {
  const nums: number[] = []
  for (const part of parts) {
    if (typeof part === 'string') {
      for (const ch of part) nums.push(ch.charCodeAt(0))
    } else {
      nums.push(...part)
    }
  }
  return new Uint8Array(nums)
}

describe('size cap constants', () => {
  test('disbursement cap is 10MB, screenshot cap is 5MB', () => {
    expect(DISBURSEMENT_ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024)
    expect(ISSUE_SCREENSHOT_MAX_BYTES).toBe(5 * 1024 * 1024)
  })
})

describe('sanitizeS3PathSegment', () => {
  test('normal account number passes through unchanged', () => {
    expect(sanitizeS3PathSegment('ACC-12345')).toBe('ACC-12345')
  })

  test('path traversal attempt is neutralised', () => {
    expect(sanitizeS3PathSegment('../../admin')).toBe('.._.._admin')
  })

  test('slashes, backslashes, null bytes, spaces and unicode are replaced', () => {
    expect(sanitizeS3PathSegment('foo/bar')).toBe('foo_bar')
    expect(sanitizeS3PathSegment('foo\\bar')).toBe('foo_bar')
    expect(sanitizeS3PathSegment('foo\0bar')).toBe('foo_bar')
    expect(sanitizeS3PathSegment('foo bar')).toBe('foo_bar')
    expect(sanitizeS3PathSegment('ACC-日本語')).toBe('ACC-___')
  })

  test('dots and hyphens are preserved', () => {
    expect(sanitizeS3PathSegment('ACC-123.v2')).toBe('ACC-123.v2')
  })
})

describe('matchesMagicBytes', () => {
  test('PDF signature matches application/pdf', () => {
    expect(matchesMagicBytes(bytesOf('%PDF-1.7 rest'), 'application/pdf')).toBe(true)
  })

  test('PNG bytes declared as application/pdf are rejected', () => {
    expect(matchesMagicBytes(bytesOf(PNG_HEADER), 'application/pdf')).toBe(false)
  })

  test('JPEG signature matches image/jpeg', () => {
    expect(matchesMagicBytes(bytesOf(JPEG_HEADER), 'image/jpeg')).toBe(true)
  })

  test('PNG signature matches image/png', () => {
    expect(matchesMagicBytes(bytesOf(PNG_HEADER, 'rest'), 'image/png')).toBe(true)
  })

  test('WebP requires both RIFF and WEBP markers', () => {
    expect(matchesMagicBytes(bytesOf('RIFF', [1, 2, 3, 4], 'WEBP'), 'image/webp')).toBe(true)
    expect(matchesMagicBytes(bytesOf('RIFF', [1, 2, 3, 4], 'WAVE'), 'image/webp')).toBe(false)
  })

  test('xlsx (zip) and legacy xls (OLE) signatures match their types', () => {
    expect(
      matchesMagicBytes(
        bytesOf([0x50, 0x4b, 0x03, 0x04]),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(true)
    expect(
      matchesMagicBytes(
        bytesOf([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        'application/vnd.ms-excel',
      ),
    ).toBe(true)
  })

  test('text/csv has no signature and always passes', () => {
    expect(matchesMagicBytes(bytesOf('a,b,c\n1,2,3'), 'text/csv')).toBe(true)
  })

  test('unknown content type is rejected', () => {
    expect(matchesMagicBytes(bytesOf('%PDF'), 'text/html')).toBe(false)
  })

  test('bytes shorter than the signature are rejected', () => {
    expect(matchesMagicBytes(bytesOf('%P'), 'application/pdf')).toBe(false)
    expect(matchesMagicBytes(new Uint8Array(0), 'image/png')).toBe(false)
  })
})

describe('readBodyWithLimit', () => {
  const makeRequest = (body: Uint8Array): Request =>
    new Request('http://localhost/upload', { method: 'POST', body })

  test('returns the full body when under the limit', async () => {
    const payload = bytesOf('%PDF-1.7 hello')
    const result = await readBodyWithLimit(makeRequest(payload), 1024)
    expect(result).toEqual(payload)
  })

  test('returns TOO_LARGE when the body exceeds the limit', async () => {
    const payload = new Uint8Array(2048)
    const result = await readBodyWithLimit(makeRequest(payload), 1024)
    expect(result).toBe('TOO_LARGE')
  })

  test('rejects early on a declared content-length over the limit without reading the body', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('body should not be read')
      },
    })
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-length': String(10 * 1024 * 1024) },
      body: stream,
      // @ts-expect-error -- undici requires duplex for stream bodies; not in TS lib yet
      duplex: 'half',
    })
    const result = await readBodyWithLimit(request, 1024)
    expect(result).toBe('TOO_LARGE')
  })

  test('returns an empty array for a request with no body', async () => {
    const request = new Request('http://localhost/upload', { method: 'POST' })
    const result = await readBodyWithLimit(request, 1024)
    expect(result).toEqual(new Uint8Array(0))
  })
})
