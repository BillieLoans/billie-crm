/**
 * GET /api/reports/usage — how Reports is used over the last 30 days, with
 * an eight-week trend (report authors only). Aggregates only.
 */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { errorResponse } from '@/server/reporting/route-auth'
import { isReportAuthor } from '@/server/reporting/run-report'
import { reportUsage } from '@/server/reporting/usage'

export async function GET() {
  const auth = await requireAuth(isReportAuthor)
  if ('error' in auth) return auth.error
  try {
    return NextResponse.json(await reportUsage(auth.payload, auth.user))
  } catch (error) {
    console.error('[reports] usage failed:', error)
    return errorResponse(500, 'USAGE_FAILED', 'The usage figures could not be loaded. Try again.')
  }
}
