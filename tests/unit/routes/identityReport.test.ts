/**
 * Unit tests for GET /api/customer/[customerId]/identity-report — artifact
 * resolution, filename/content-type per artifact (LAB API v1 per-check
 * screening PDF), and 404 when an artifact is not archived.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const FakeNextResponse = vi.hoisted(
  () =>
    class FakeNextResponse {
      body: unknown
      status: number
      headers: Record<string, string>
      constructor(
        body: unknown,
        init?: { status?: number; headers?: Record<string, string> },
      ) {
        this.body = body
        this.status = init?.status ?? 200
        this.headers = init?.headers ?? {}
      }
      static json(body: unknown, init?: { status?: number }) {
        return new FakeNextResponse(body, { status: init?.status ?? 200 })
      }
    },
)

vi.mock('next/server', () => ({ NextResponse: FakeNextResponse }))

const mockFind = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockImplementation(async () => ({
    user: { id: 'ops-1', role: 'operations' },
    payload: { find: mockFind },
  })),
}))
vi.mock('@/lib/access', () => ({ hasAnyRole: () => true }))
vi.mock('@/lib/utils/rateLimit', () => ({
  checkRateLimit: () => true,
  ASSESSMENT_RATE_LIMIT: {},
}))

const mockGetObject = vi.hoisted(() => vi.fn())
vi.mock('@/server/s3-client', () => ({
  getObjectByUri: mockGetObject,
  parseS3Uri: (uri: string) => {
    const [, rest] = uri.split('s3://')
    const [bucket, ...key] = rest.split('/')
    return { bucket, key: key.join('/') }
  },
}))

import { GET } from '@/app/api/customer/[customerId]/identity-report/route'
import type { NextRequest } from 'next/server'

const IVR = {
  reportFileLocation: 's3://bucket/APP1/IdentityVerification/verification_report_identity_vid.pdf',
  reportFileName: 'verification_report_identity_vid.pdf',
  screeningReportFileLocation:
    's3://bucket/APP1/IdentityVerification/verification_report_screening_vid.pdf',
  screeningReportFileName: 'verification_report_screening_vid.pdf',
  rawResponseFileLocation: 's3://bucket/APP1/IdentityVerification/verify_response_vid.json',
  rawResponseFileName: 'verify_response_vid.json',
}

const makeRequest = (query: string) =>
  ({ nextUrl: { searchParams: new URLSearchParams(query) } }) as unknown as NextRequest

const call = async (query: string) =>
  (await GET(makeRequest(query), { params: Promise.resolve({ customerId: 'C1' }) })) as unknown as {
    status: number
    body: unknown
    headers: Record<string, string>
  }

describe('GET /api/customer/[customerId]/identity-report', () => {
  beforeEach(() => {
    mockFind.mockReset()
    mockGetObject.mockReset()
    mockFind.mockResolvedValue({ docs: [{ identityVerificationReport: IVR }] })
    mockGetObject.mockResolvedValue({
      body: 'bytes',
      contentType: 'application/octet-stream',
      contentLength: 5,
    })
  })

  it('serves the identity report as a PDF by default', async () => {
    const res = await call('')
    expect(res.status).toBe(200)
    expect(res.headers['Content-Type']).toBe('application/pdf')
    expect(res.headers['Content-Disposition']).toBe(
      'inline; filename="verification_report_identity_vid.pdf"',
    )
    expect(mockGetObject).toHaveBeenCalledWith(IVR.reportFileLocation)
  })

  it('serves the screening report as a PDF with its own filename', async () => {
    const res = await call('artifact=screening')
    expect(res.status).toBe(200)
    expect(res.headers['Content-Type']).toBe('application/pdf')
    expect(res.headers['Content-Disposition']).toBe(
      'inline; filename="verification_report_screening_vid.pdf"',
    )
    expect(mockGetObject).toHaveBeenCalledWith(IVR.screeningReportFileLocation)
    // the lookup asks for a conversation that HAS the screening artifact
    const where = mockFind.mock.calls[0][0].where.and[1]
    expect(Object.keys(where)[0]).toBe('identityVerificationReport.screeningReportFileLocation')
  })

  it('serves the raw response as JSON with attachment disposition', async () => {
    const res = await call('artifact=raw&disposition=attachment')
    expect(res.status).toBe(200)
    expect(res.headers['Content-Type']).toBe('application/json')
    expect(res.headers['Content-Disposition']).toBe(
      'attachment; filename="verify_response_vid.json"',
    )
  })

  it('404s when the artifact is not archived (legacy customer, screening)', async () => {
    mockFind.mockResolvedValue({ docs: [] })
    const res = await call('artifact=screening')
    expect(res.status).toBe(404)
    expect(mockGetObject).not.toHaveBeenCalled()
  })

  it('400s on an unknown artifact, including prototype keys', async () => {
    expect((await call('artifact=bogus')).status).toBe(400)
    expect((await call('artifact=toString')).status).toBe(400)
    expect(mockFind).not.toHaveBeenCalled()
  })
})
