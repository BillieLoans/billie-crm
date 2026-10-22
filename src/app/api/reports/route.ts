/**
 * GET /api/reports — the published reports the signed-in user may run
 * (BTB-506). Returns titles, parameters and charts; never the SQL.
 */
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { headers } from 'next/headers'
import configPromise from '@payload-config'
import { hasAnyRole } from '@/lib/access'
import { isReportAuthor, listReports } from '@/server/reporting/run-report'

export async function GET() {
  const payload = await getPayload({ config: configPromise })
  const { user } = await payload.auth({
    headers: new Headers(Array.from((await headers()).entries())),
  })
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } },
      { status: 401 },
    )
  }
  if (!hasAnyRole(user)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } },
      { status: 403 },
    )
  }
  try {
    const reports = await listReports(payload, user)
    return NextResponse.json({ reports, canAuthor: isReportAuthor(user) })
  } catch (error) {
    console.error('[reports] could not list reports:', error)
    return NextResponse.json(
      { error: { code: 'LIST_FAILED', message: 'Reports could not be loaded. Try again.' } },
      { status: 500 },
    )
  }
}
