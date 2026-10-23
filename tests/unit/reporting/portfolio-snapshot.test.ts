/**
 * Unit tests for the nightly ledger portfolio snapshot (BTB-504): the job
 * token check, the response validation and the route wiring. The ledger
 * client and Payload are mocked.
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

const mockSummary = vi.hoisted(() => vi.fn())
vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: () => ({ getPortfolioSummary: mockSummary }),
}))

const mockQuery = vi.hoisted(() => vi.fn(async () => ({ rows: [] })))
vi.mock('payload', () => ({
  getPayload: vi.fn(async () => ({ db: { pool: { query: mockQuery } } })),
}))
vi.mock('@payload-config', () => ({ default: {} }))

import { POST } from '@/app/api/reports/jobs/portfolio-snapshot/route'
import { isReportingJobAuthorised } from '@/server/reporting/job-auth'
import { toSnapshotRow } from '@/server/reporting/portfolio-snapshot'

const TOKEN = 'job-token-for-tests'

function req(url: string, token?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  const request = new Request(url, { method: 'POST', headers }) as unknown as NextRequest
  ;(request as unknown as { nextUrl: URL }).nextUrl = new URL(url)
  return request
}

const SUMMARY = {
  asOfDate: '2026-10-21',
  totalActiveAccounts: 12,
  principalReceivable: '3400.50',
  feesReceivable: '120.00',
  totalReceivables: '3520.50',
  generatedAt: { seconds: '1792544400', nanos: 0 },
}

beforeEach(() => {
  process.env.REPORTING_JOB_TOKEN = TOKEN
  mockSummary.mockReset().mockResolvedValue(SUMMARY)
  mockQuery.mockClear()
})

describe('isReportingJobAuthorised', () => {
  test('accepts the configured bearer token', () => {
    expect(isReportingJobAuthorised(req('http://x/', TOKEN))).toBe(true)
  })

  test('refuses a wrong or missing token', () => {
    expect(isReportingJobAuthorised(req('http://x/', 'nope'))).toBe(false)
    expect(isReportingJobAuthorised(req('http://x/'))).toBe(false)
  })

  test('refuses everything when no token is configured', () => {
    delete process.env.REPORTING_JOB_TOKEN
    expect(isReportingJobAuthorised(req('http://x/', ''))).toBe(false)
    expect(isReportingJobAuthorised(req('http://x/', 'anything'))).toBe(false)
  })
})

describe('toSnapshotRow', () => {
  test('keeps amounts as the ledger sent them', () => {
    const row = toSnapshotRow(SUMMARY, '2026-10-21')
    expect(row).toEqual({
      asAtDate: '2026-10-21',
      totalActiveAccounts: 12,
      principalReceivable: '3400.50',
      feesReceivable: '120.00',
      totalReceivables: '3520.50',
      ledgerGeneratedAt: new Date(1792544400 * 1000),
    })
  })

  test('falls back to the requested date when the ledger omits one', () => {
    expect(toSnapshotRow({ ...SUMMARY, asOfDate: '' }, '2026-10-20').asAtDate).toBe('2026-10-20')
  })

  test('rejects a malformed amount rather than storing it', () => {
    expect(() => toSnapshotRow({ ...SUMMARY, feesReceivable: '1,200' }, '2026-10-21')).toThrow(
      /fees_receivable/,
    )
  })

  test('rejects a missing or fractional account count rather than storing zero', () => {
    for (const bad of [undefined, -1, 1.5, Number.NaN]) {
      expect(() =>
        toSnapshotRow({ ...SUMMARY, totalActiveAccounts: bad as unknown as number }, '2026-10-21'),
      ).toThrow(/total_active_accounts/)
    }
  })
})

describe('POST /api/reports/jobs/portfolio-snapshot', () => {
  test('401 without the job token, and the ledger is not called', async () => {
    const res = (await POST(
      req('http://x/api/reports/jobs/portfolio-snapshot', 'bad'),
    )) as unknown as {
      status: number
    }
    expect(res.status).toBe(401)
    expect(mockSummary).not.toHaveBeenCalled()
  })

  test('400 on a malformed asOfDate', async () => {
    const res = (await POST(
      req('http://x/api/reports/jobs/portfolio-snapshot?asOfDate=21-10-2026', TOKEN),
    )) as unknown as { status: number }
    expect(res.status).toBe(400)
  })

  test('copies the summary for the requested day', async () => {
    const res = (await POST(
      req('http://x/api/reports/jobs/portfolio-snapshot?asOfDate=2026-10-21', TOKEN),
    )) as unknown as { status: number; body: unknown }
    expect(res.status).toBe(200)
    expect(mockSummary).toHaveBeenCalledWith({ asOfDate: '2026-10-21' })
    const [sql, params] = mockQuery.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('INSERT INTO reporting.snap_portfolio')
    expect(params.slice(0, 5)).toEqual(['2026-10-21', 12, '3400.50', '120.00', '3520.50'])
  })

  test('502 when the ledger fails, without writing', async () => {
    mockSummary.mockRejectedValue(new Error('UNAVAILABLE'))
    const res = (await POST(
      req('http://x/api/reports/jobs/portfolio-snapshot', TOKEN),
    )) as unknown as { status: number }
    expect(res.status).toBe(502)
    expect(mockQuery).not.toHaveBeenCalled()
  })
})
