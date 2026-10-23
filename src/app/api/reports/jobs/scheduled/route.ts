/**
 * POST /api/reports/jobs/scheduled — scheduled report delivery (BTB-507).
 *
 * Called by .github/workflows/scheduled-reports.yml with `Authorization:
 * Bearer $REPORTING_JOB_TOKEN`. `?schedule=weekly_monday` picks the reports.
 *
 * Scheduled calls also pass `?notBeforeSydneyHour=8`: the call does nothing
 * unless it is Monday in Sydney and at least 08:00. GitHub cron is UTC and
 * may run late, so the workflow fires several times on Monday morning; the
 * first call at or after 08:00 sends, and each report's per-day claim makes
 * the others send nothing.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { staffEmailConfigured } from '@/server/email/staff-email'
import { isReportingJobAuthorised } from '@/server/reporting/job-auth'
import { deliverScheduledReports, sydneyClock } from '@/server/reporting/scheduled'

const SCHEDULES = ['weekly_monday'] as const
const MONDAY = 1

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
  const notBefore = params.get('notBeforeSydneyHour')
  if (notBefore !== null) {
    const hour = Number(notBefore)
    if (notBefore === '' || !Number.isInteger(hour) || hour < 0 || hour > 23) {
      return NextResponse.json({ error: 'notBeforeSydneyHour must be 0-23' }, { status: 400 })
    }
    const now = sydneyClock()
    if (now.weekday !== MONDAY || now.hour < hour) {
      return NextResponse.json({ skipped: 'Not Monday after the scheduled hour in Sydney' })
    }
  }
  if (!staffEmailConfigured()) {
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
    // Red in the workflow whenever something that should have gone out did not.
    const failed = summary.reports.some(
      (r) => r.status === 'failed' || r.status === 'no_recipients',
    )
    return NextResponse.json(summary, { status: failed ? 502 : 200 })
  } catch (error) {
    console.error('[reports] scheduled delivery failed:', error)
    return NextResponse.json({ error: 'Scheduled delivery failed' }, { status: 500 })
  }
}
