/**
 * POST /api/reports/jobs/scheduled — scheduled report delivery (BTB-507).
 *
 * Called by .github/workflows/scheduled-reports.yml with `Authorization:
 * Bearer $REPORTING_JOB_TOKEN`. `?schedule=weekly_monday` picks the reports;
 * `?sydneyHour=8` makes the call a no-op outside 08:00 Sydney, so the
 * workflow can fire at both daylight-saving offsets and exactly one call
 * sends. A repeat call on the same Sydney day sends nothing new.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { isReportingJobAuthorised } from '@/server/reporting/job-auth'
import { deliverScheduledReports, sydneyHour } from '@/server/reporting/scheduled'

const SCHEDULES = ['weekly_monday'] as const

export async function POST(request: NextRequest) {
  if (!isReportingJobAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const params = request.nextUrl.searchParams
  const schedule = params.get('schedule')
  if (!SCHEDULES.includes(schedule as (typeof SCHEDULES)[number])) {
    return NextResponse.json(
      { error: `schedule must be one of ${SCHEDULES.join(', ')}` },
      { status: 400 },
    )
  }
  const hourParam = params.get('sydneyHour')
  if (hourParam !== null) {
    const wanted = Number(hourParam)
    if (!Number.isInteger(wanted) || wanted < 0 || wanted > 23) {
      return NextResponse.json({ error: 'sydneyHour must be 0-23' }, { status: 400 })
    }
    const now = sydneyHour()
    if (now !== wanted) {
      return NextResponse.json({ skipped: `It is ${now}:00 in Sydney, not ${wanted}:00` })
    }
  }
  if (process.env.NODE_ENV === 'production' && !process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email is not configured (RESEND_API_KEY)' }, { status: 503 })
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL is not set' }, { status: 503 })
  }

  try {
    const payload = await getPayload({ config: configPromise })
    const summary = await deliverScheduledReports(payload, {
      schedule: schedule as (typeof SCHEDULES)[number],
      appUrl,
    })
    const failed = summary.reports.some((r) => r.status === 'failed')
    return NextResponse.json(summary, { status: failed ? 502 : 200 })
  } catch (error) {
    console.error('[reports] scheduled delivery failed:', error)
    return NextResponse.json({ error: 'Scheduled delivery failed' }, { status: 500 })
  }
}
