/**
 * Unit tests for POST /api/issues/screenshot.
 *
 * Proxied replacement for the retired screenshot presign flow: the browser
 * POSTs the image bytes, the server validates (5MB cap, JPEG/PNG only, magic
 * bytes) and PUTs to S3 under issues/{yyyy}-{mm}/{uuid}.{ext}.
 *
 * Mocks mirror disbursement-attachment-upload.test.ts; @/server/uploads is
 * the REAL implementation.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

const mockRequireAuth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ requireAuth: mockRequireAuth }))

const mockUploadObject = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/server/s3-client', () => ({
  uploadObject: mockUploadObject,
  buildS3Uri: (key: string) => `s3://test-bucket/${key}`,
}))

import { POST } from '@/app/api/issues/screenshot/route'

type MockResponse = { body: any; status: number }

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

function makeRequest(contentType: string, body: Uint8Array): NextRequest {
  return new Request('http://localhost/api/issues/screenshot', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  }) as unknown as NextRequest
}

beforeEach(() => {
  mockRequireAuth.mockReset().mockResolvedValue({ user: { id: 'user-1' }, payload: {} })
  mockUploadObject.mockReset().mockResolvedValue(undefined)
})

describe('POST /api/issues/screenshot', () => {
  test('returns the auth error when the caller is not authorised', async () => {
    const authError = { body: { error: { code: 'UNAUTHENTICATED' } }, status: 401 }
    mockRequireAuth.mockResolvedValue({ error: authError })

    const res = (await POST(makeRequest('image/png', PNG_BYTES))) as MockResponse
    expect(res.status).toBe(401)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  test('400s on a non-image content type', async () => {
    const res = (await POST(
      makeRequest('application/pdf', new TextEncoder().encode('%PDF-1.7')),
    )) as MockResponse
    expect(res.status).toBe(400)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  test('413s when the image exceeds the 5MB cap', async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1)
    oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const res = (await POST(makeRequest('image/png', oversized))) as MockResponse
    expect(res.status).toBe(413)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  test('400s when the bytes are not the declared image type', async () => {
    const res = (await POST(makeRequest('image/png', JPEG_BYTES))) as MockResponse
    expect(res.status).toBe(400)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  test('uploads a PNG under issues/{yyyy}-{mm}/ and returns the S3 URI', async () => {
    const res = (await POST(makeRequest('image/png', PNG_BYTES))) as MockResponse

    expect(res.status).toBe(200)
    expect(mockUploadObject).toHaveBeenCalledTimes(1)
    const [key, contentType, bytes] = mockUploadObject.mock.calls[0] as unknown as [
      string,
      string,
      Uint8Array,
    ]
    expect(key).toMatch(/^issues\/\d{4}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/)
    expect(contentType).toBe('image/png')
    // Array.from: cross-realm Uint8Array — compare contents, not constructor
    expect(Array.from(bytes)).toEqual(Array.from(PNG_BYTES))
    expect(res.body.s3Uri).toBe(`s3://test-bucket/${key}`)
  })

  test('uploads a JPEG with a .jpg extension', async () => {
    const res = (await POST(makeRequest('image/jpeg', JPEG_BYTES))) as MockResponse

    expect(res.status).toBe(200)
    const [key] = mockUploadObject.mock.calls[0] as unknown as [string]
    expect(key).toMatch(/\.jpg$/)
  })
})
