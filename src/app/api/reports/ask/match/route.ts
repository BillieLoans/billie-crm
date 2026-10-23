/**
 * GET /api/reports/ask/match?q=… — published reports that already answer a
 * question, before anyone waits for Claude. Instant; no Claude call.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { findExistingReports } from '@/lib/reports/catalogue'
import { listReports } from '@/server/reporting/run-report'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  const question = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 2000)
  const reports = (await listReports(auth.payload, auth.user)).filter((r) => r.published)
  const matches = findExistingReports(question, reports).map(({ report, parameters }) => ({
    slug: report.slug,
    title: report.title,
    description: report.description,
    parameters,
  }))
  return NextResponse.json({ matches })
}
