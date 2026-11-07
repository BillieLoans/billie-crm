/**
 * POST /api/reports/jobs/google-ads-conversions — send approved and funded
 * ad-click applications to Google Ads as offline click conversions (BTB-546).
 *
 * Called hourly by .github/workflows/scheduled-reports.yml with
 * `Authorization: Bearer $REPORTING_JOB_TOKEN`. A repeat or concurrent call
 * sends nothing twice: rows are claimed with SKIP LOCKED and Google
 * de-duplicates on order id (src/server/google-ads/conversions.ts).
 *
 * `GOOGLE_ADS_CONVERSIONS_MODE` (off | validate_only | live) is the switch;
 * off returns 200 and does nothing, so the schedule can stay on.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { isReportingJobAuthorised } from '@/server/reporting/job-auth'
import { createGoogleAdsClient } from '@/server/google-ads/client'
import { readGoogleAdsConfig } from '@/server/google-ads/config'
import { runGoogleAdsConversions } from '@/server/google-ads/conversions'

export async function POST(request: NextRequest) {
  if (!isReportingJobAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const settings = readGoogleAdsConfig()
  if (!settings.ok) {
    if (settings.mode === 'off') {
      return NextResponse.json({ skipped: 'GOOGLE_ADS_CONVERSIONS_MODE is off' })
    }
    // Names only, never values.
    return NextResponse.json(
      { error: 'Google Ads is not configured', missing: settings.missing },
      { status: 503 },
    )
  }

  try {
    const payload = await getPayload({ config: configPromise })
    const pool = getDashboardPool(payload)
    if (!pool) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }
    const summary = await runGoogleAdsConversions(
      pool,
      createGoogleAdsClient(settings.config),
      settings.config,
    )
    // Red in the workflow when Google refused a whole request (auth, quota)
    // or answered with a code this code does not know. Both are retried.
    const attention = summary.result.requestErrors.length + summary.result.unrecognised.length
    return NextResponse.json(summary, { status: attention ? 502 : 200 })
  } catch (error) {
    console.error('[google-ads] conversion run failed:', error)
    return NextResponse.json({ error: 'Conversion run failed' }, { status: 500 })
  }
}
