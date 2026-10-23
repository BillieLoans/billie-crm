/**
 * POST /api/reports/jobs/portfolio-snapshot — nightly ledger portfolio copy
 * (BTB-504).
 *
 * Called nightly by .github/workflows/scheduled-reports.yml with
 * `Authorization: Bearer $REPORTING_JOB_TOKEN` and `?asOfDate=` the Sydney
 * day just ended (YYYY-MM-DD); without it, today in Sydney. A repeat call
 * for the same day replaces that day's row.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { getLedgerClient } from '@/server/grpc-client'
import { isReportingJobAuthorised } from '@/server/reporting/job-auth'
import { saveSnapshot, toSnapshotRow } from '@/server/reporting/portfolio-snapshot'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { sydneyDateString } from '@/lib/disbursement-cutoff'

export async function POST(request: NextRequest) {
  if (!isReportingJobAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const requested = request.nextUrl.searchParams.get('asOfDate') ?? sydneyDateString(new Date())
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    return NextResponse.json({ error: 'asOfDate must be YYYY-MM-DD' }, { status: 400 })
  }

  try {
    const summary = await getLedgerClient().getPortfolioSummary({ asOfDate: requested })
    const row = toSnapshotRow(summary, requested)
    const payload = await getPayload({ config: configPromise })
    const pool = getDashboardPool(payload)
    if (!pool) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }
    await saveSnapshot(pool, row)
    return NextResponse.json({
      asAtDate: row.asAtDate,
      totalActiveAccounts: row.totalActiveAccounts,
    })
  } catch (error) {
    console.error('[reports] portfolio snapshot failed:', error)
    return NextResponse.json({ error: 'Portfolio snapshot failed' }, { status: 502 })
  }
}
