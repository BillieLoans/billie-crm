/**
 * POST /api/reports/jobs/deliveries — send the report emails, Slack posts
 * and alerts people subscribed to that are due today (Sydney).
 *
 * Called by .github/workflows/scheduled-reports.yml with `Authorization:
 * Bearer $REPORTING_JOB_TOKEN`, several times each morning (GitHub cron is
 * UTC and can run late). `?notBeforeSydneyHour=7` makes a call before
 * 07:00 Sydney do nothing; each delivery's claim makes the repeats send
 * nothing. Without email configured it still posts to Slack and checks
 * alerts; each email fails on its own and is retried by the next call.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { deliverSubscriptions } from '@/server/reporting/deliveries'
import { isReportingJobAuthorised } from '@/server/reporting/job-auth'
import { sydneyClock } from '@/server/reporting/scheduled'

export async function POST(request: NextRequest) {
  if (!isReportingJobAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const notBefore = request.nextUrl.searchParams.get('notBeforeSydneyHour')
  if (notBefore !== null) {
    const hour = Number(notBefore)
    if (notBefore === '' || !Number.isInteger(hour) || hour < 0 || hour > 23) {
      return NextResponse.json({ error: 'notBeforeSydneyHour must be 0-23' }, { status: 400 })
    }
    if (sydneyClock().hour < hour) {
      return NextResponse.json({ skipped: 'Before the delivery hour in Sydney' })
    }
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL is not set' }, { status: 503 })
  }
  try {
    const payload = await getPayload({ config: configPromise })
    const summary = await deliverSubscriptions(payload, { appUrl })
    const counts = summary.results.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1
      return acc
    }, {})
    // Ids and outcomes only: never report data or addresses.
    const failed = summary.results.filter((r) => r.status === 'failed')
    return NextResponse.json(
      { day: summary.day, due: summary.due, counts, failed },
      { status: failed.length ? 502 : 200 },
    )
  } catch (error) {
    console.error('[reports] subscription delivery failed:', error)
    return NextResponse.json({ error: 'Subscription delivery failed' }, { status: 500 })
  }
}
