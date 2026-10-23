/**
 * POST /api/reports/:slug — run a report (BTB-506).
 *
 * Body: `{ "parameters": { name: value }, "draft": false }`. `draft: true`
 * runs the latest draft and is for authors only. Every run, refused ones
 * included, is logged to `report-runs`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { headers } from 'next/headers'
import configPromise from '@payload-config'
import { hasAnyRole } from '@/lib/access'
import { runReport } from '@/server/reporting/run-report'

interface RouteParams {
  params: Promise<{ slug: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { slug } = await params
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
      { error: { code: 'FORBIDDEN', message: 'You do not have access to this report.' } },
      { status: 403 },
    )
  }

  let body: { parameters?: unknown; draft?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    body = {}
  }
  const parameters =
    body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
      ? (body.parameters as Record<string, unknown>)
      : {}

  try {
    const outcome = await runReport(payload, user, slug, { parameters, draft: body.draft === true })
    return NextResponse.json(outcome.body, { status: outcome.status })
  } catch (error) {
    console.error('[reports] report run failed:', error)
    return NextResponse.json(
      { error: { code: 'QUERY_FAILED', message: 'The report could not be run. Try again.' } },
      { status: 500 },
    )
  }
}
