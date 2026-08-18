/**
 * Unit tests for POST /api/uploads/disbursement-attachment.
 *
 * The proxied replacement for the retired presigned-URL flow: the browser
 * POSTs the file bytes to this route and the server PUTs them to S3, so the
 * app's CSP can stay connect-src 'self' and size/content rules are enforced
 * server-side.
 *
 * Mocks:
 *   - next/server          → NextResponse.json returns { body, status }
 *   - @/lib/auth           → requireAuth mocked per test
 *   - @/server/s3-client   → uploadObject captured; buildS3Uri deterministic
 *   - @/server/uploads is the REAL implementation (cap + magic bytes + sanitiser)
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

import { POST } from '@/app/api/uploads/disbursement-attachment/route'

type MockResponse = { body: any; status: number }

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 test document content')

const mockFind = vi.fn()

function authOk() {
  mockRequireAuth.mockResolvedValue({
    user: { id: 'user-1', roles: ['operations'] },
    payload: { find: mockFind },
  })
}

const ACCOUNT_DOC = { id: 'acc-1', customerIdString: '2101C867-822' }

function makeRequest(opts: {
  accountNumber?: string
  fileName?: string
  contentType?: string
  body?: Uint8Array
}): NextRequest {
  const params = new URLSearchParams()
  if (opts.accountNumber !== undefined) params.set('accountNumber', opts.accountNumber)
  if (opts.fileName !== undefined) params.set('fileName', opts.fileName)
  return new Request(`http://localhost/api/uploads/disbursement-attachment?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': opts.contentType ?? 'application/pdf' },
    body: opts.body ?? PDF_BYTES,
  }) as unknown as NextRequest
}

beforeEach(() => {
  mockRequireAuth.mockReset()
  mockUploadObject.mockReset().mockResolvedValue(undefined)
  mockFind.mockReset().mockResolvedValue({ docs: [ACCOUNT_DOC] })
})

describe('POST /api/uploads/disbursement-attachment', () => {
  test('returns the auth error when the caller is not authorised', async () => {
    const authError = { body: { error: 'nope' }, status: 401 }
    mockRequireAuth.mockResolvedValue({ error: authError })

    const res = (await POST(makeRequest({ accountNumber: 'ACC-1', fileName: 'a.pdf' }))) as MockResponse
    expect(res.status).toBe(401)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  test('400s when accountNumber or fileName is missing', async () => {
    authOk()
    const res = (await POST(makeRequest({ fileName: 'a.pdf' }))) as MockResponse
    expect(res.status).toBe(400)

    const res2 = (await POST(makeRequest({ accountNumber: 'ACC-1' }))) as MockResponse
    expect(res2.status).toBe(400)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  test('400s on a content type outside the allowlist', async () => {
    authOk()
    const res = (await POST(
      makeRequest({ accountNumber: 'ACC-1', fileName: 'a.html', contentType: 'text/html' }),
    )) as MockResponse
    expect(res.status).toBe(400)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  test('404s when the loan account does not exist', async () => {
    authOk()
    mockFind.mockResolvedValue({ docs: [] })
    const res = (await POST(makeRequest({ accountNumber: 'ACC-404', fileName: 'a.pdf' }))) as MockResponse
    expect(res.status).toBe(404)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  test('413s when the body exceeds the 10MB cap', async () => {
    authOk()
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1)
    oversized.set([0x25, 0x50, 0x44, 0x46]) // valid %PDF header — size is the only problem
    const res = (await POST(
      makeRequest({ accountNumber: 'ACC-1', fileName: 'big.pdf', body: oversized }),
    )) as MockResponse
    expect(res.status).toBe(413)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  test('400s when the bytes do not match the declared content type', async () => {
    authOk()
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const res = (await POST(
      makeRequest({ accountNumber: 'ACC-1', fileName: 'fake.pdf', body: pngBytes }),
    )) as MockResponse
    expect(res.status).toBe(400)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  test('400s on an empty body', async () => {
    authOk()
    const res = (await POST(
      makeRequest({ accountNumber: 'ACC-1', fileName: 'a.pdf', body: new Uint8Array(0) }),
    )) as MockResponse
    expect(res.status).toBe(400)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  test('uploads under customer/{customerId}/Disbursements/{account}/ and returns the S3 URI', async () => {
    authOk()
    const res = (await POST(
      makeRequest({ accountNumber: '5064E6C1-738', fileName: 'ANZ Receipt.pdf' }),
    )) as MockResponse

    expect(res.status).toBe(200)
    expect(mockUploadObject).toHaveBeenCalledTimes(1)
    const [key, contentType, bytes] = mockUploadObject.mock.calls[0] as unknown as [
      string,
      string,
      Uint8Array,
    ]
    expect(key).toMatch(
      /^customer\/2101C867-822\/Disbursements\/5064E6C1-738\/\d+-ANZ_Receipt\.pdf$/,
    )
    expect(contentType).toBe('application/pdf')
    // Array.from: the route's Uint8Array comes from another realm, so
    // constructor-sensitive deep equality would fail despite equal contents
    expect(Array.from(bytes)).toEqual(Array.from(PDF_BYTES))
    expect(res.body.s3Uri).toBe(`s3://test-bucket/${key}`)
    expect(res.body.s3Key).toBe(key)
  })

  test('422s when the account has no customer ID to key the path on', async () => {
    authOk()
    mockFind.mockResolvedValue({ docs: [{ id: 'acc-1', customerIdString: null }] })
    const res = (await POST(
      makeRequest({ accountNumber: 'ACC-1', fileName: 'a.pdf' }),
    )) as MockResponse
    expect(res.status).toBe(422)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  test('neutralises path traversal in accountNumber and fileName', async () => {
    authOk()
    const res = (await POST(
      makeRequest({ accountNumber: '../../etc', fileName: '../../../passwd.pdf' }),
    )) as MockResponse

    expect(res.status).toBe(200)
    const [key] = mockUploadObject.mock.calls[0] as unknown as [string]
    expect(key).toMatch(
      /^customer\/2101C867-822\/Disbursements\/\.\._\.\._etc\/\d+-\.\._\.\._\.\._passwd\.pdf$/,
    )
    // Only the structural slashes remain: customer / customerId / Disbursements / account / file
    expect(key.split('/')).toHaveLength(5)
  })
})
