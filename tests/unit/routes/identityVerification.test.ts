/**
 * Unit tests for GET /api/customer/[customerId]/identity-verification —
 * resolves the latest assessed conversation and returns the verbatim identity
 * assessment plus report availability (servicing-view drawer).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

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

import { GET } from '@/app/api/customer/[customerId]/identity-verification/route'
import type { NextRequest } from 'next/server'

const call = async () =>
  (await GET({} as unknown as NextRequest, {
    params: Promise.resolve({ customerId: 'C1' }),
  })) as unknown as { status: number; body: Record<string, unknown> }

const DOC = {
  conversationId: 'conv-9',
  applicationNumber: 'APP-9',
  updatedAt: '2026-09-12T01:00:00.000Z',
  assessments: {
    identityRisk: {
      decision: 'APPROVED',
      lab_verification: { id: 'vid-1', verificationNumber: 'V1', result: { outcome: 'pass', checks: [] } },
    },
  },
  identityVerificationReport: {
    reportFileLocation: 's3://b/identity.pdf',
    reportFileName: 'identity.pdf',
    screeningReportFileLocation: 's3://b/screening.pdf',
    screeningReportFileName: 'screening.pdf',
    verificationNumber: 'V1',
  },
}

describe('GET /api/customer/[customerId]/identity-verification', () => {
  beforeEach(() => {
    mockFind.mockReset()
  })

  it('returns the latest assessed conversation with report availability', async () => {
    mockFind.mockResolvedValue({ docs: [DOC] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.body.conversationId).toBe('conv-9')
    expect(res.body.applicationNumber).toBe('APP-9')
    expect(res.body.assessedAt).toBe('2026-09-12T01:00:00.000Z')
    expect((res.body.identity as Record<string, unknown>).decision).toBe('APPROVED')
    const report = res.body.report as Record<string, unknown>
    expect(report.reportAvailable).toBe(true)
    expect(report.screeningReportAvailable).toBe(true)
    expect(report.rawResponseAvailable).toBe(false)
    expect(report.verificationNumber).toBe('V1')

    const query = mockFind.mock.calls[0][0]
    expect(query.collection).toBe('conversations')
    expect(query.sort).toBe('-updatedAt')
    expect(query.where.and[0]).toEqual({ customerIdString: { equals: 'C1' } })
    expect(query.where.and[1]).toEqual({ 'assessments.identityRisk': { exists: true } })
  })

  it('404s when the customer has no assessed conversation', async () => {
    mockFind.mockResolvedValue({ docs: [] })
    const res = await call()
    expect(res.status).toBe(404)
  })

  it('404s when the conversation carries no identity assessment', async () => {
    mockFind.mockResolvedValue({ docs: [{ ...DOC, assessments: {} }] })
    expect((await call()).status).toBe(404)
  })
})
