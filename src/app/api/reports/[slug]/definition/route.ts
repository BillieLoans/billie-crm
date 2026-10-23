/**
 * GET /api/reports/:slug/definition — a report's whole definition (SQL
 * included), latest version, for authors changing it with Ask Claude or
 * the report editor.
 */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { errorResponse } from '@/server/reporting/route-auth'
import { findReport, isReportAuthor } from '@/server/reporting/run-report'

interface RouteParams {
  params: Promise<{ slug: string }>
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { slug } = await params
  const auth = await requireAuth()
  if ('error' in auth) return auth.error
  if (!isReportAuthor(auth.user)) {
    return errorResponse(403, 'FORBIDDEN', 'Only report authors can see report definitions.')
  }
  const doc = await findReport(auth.payload, slug, true)
  if (!doc) return errorResponse(404, 'NOT_FOUND', 'There is no report at this link.')
  return NextResponse.json({
    id: String(doc.id),
    slug: doc.slug,
    status: doc._status ?? 'draft',
    title: doc.title,
    description: doc.description ?? '',
    category: doc.category ?? 'other',
    featured: doc.featured === true,
    sql: doc.sql,
    parameters: doc.parameters ?? [],
    chart: doc.chart ?? null,
    headline: doc.headline ?? [],
    columnSettings: doc.columnSettings ?? [],
    roles: doc.roles ?? [],
    schedule: doc.schedule ?? 'none',
  })
}
