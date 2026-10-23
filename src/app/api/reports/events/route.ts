/**
 * POST /api/reports/events — record a search, a search result opened, a
 * download or a copy, for the Reports usage page. Fire and forget: the
 * view never waits on it, and a failure is only logged.
 *
 * Body: `{ "kind": "csv", "reportSlug": "decline-rate", "query": "..." }`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { REPORT_EVENT_KINDS, type ReportEventKind } from '@/collections/ReportEvents'
import { REPORT_SLUG_RE } from '@/lib/schemas/reports'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { errorResponse } from '@/server/reporting/route-auth'

const MAX_QUERY = 60

export async function POST(request: NextRequest) {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const kind = body?.kind
  if (typeof kind !== 'string' || !REPORT_EVENT_KINDS.includes(kind as ReportEventKind)) {
    return errorResponse(400, 'BAD_KIND', 'Unknown event.')
  }
  const slug =
    typeof body?.reportSlug === 'string' && REPORT_SLUG_RE.test(body.reportSlug)
      ? body.reportSlug
      : undefined
  const query =
    typeof body?.query === 'string' ? body.query.trim().slice(0, MAX_QUERY) || undefined : undefined
  try {
    await auth.payload.create({
      collection: 'report-events',
      data: { kind: kind as ReportEventKind, reportSlug: slug, query, user: String(auth.user.id) },
      overrideAccess: true,
    })
  } catch (error) {
    console.error('[reports] could not record a report event:', error)
  }
  return NextResponse.json({ ok: true })
}
