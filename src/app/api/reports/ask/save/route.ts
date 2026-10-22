/**
 * POST /api/reports/ask/save — save a checked Ask Claude draft (BTB-508).
 *
 * Body: `{ definition }`. Creates an unpublished report with the user as
 * author and origin "ask". Report authors only; a supervisor publishes it
 * from the admin after review.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { headers } from 'next/headers'
import configPromise from '@payload-config'
import { isReportAuthor } from '@/server/reporting/run-report'
import { saveDraft } from '@/server/reporting/ask/draft'

export async function POST(request: NextRequest) {
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
  if (!isReportAuthor(user)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Only report authors can save reports.' } },
      { status: 403 },
    )
  }
  const body = (await request.json().catch(() => null)) as {
    definition?: Record<string, unknown>
  } | null
  const d = body?.definition
  if (!d || typeof d.sql !== 'string' || typeof d.title !== 'string') {
    return NextResponse.json(
      { error: { code: 'NO_DEFINITION', message: 'Send the draft definition.' } },
      { status: 400 },
    )
  }
  try {
    const saved = await saveDraft(payload, user, {
      title: d.title,
      description: typeof d.description === 'string' ? d.description : '',
      sql: d.sql,
      parameters: d.parameters ?? [],
      chart: d.chart ?? null,
    })
    if (!saved.ok) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID',
            message: 'Fix the problems before saving.',
            issues: saved.issues,
          },
        },
        { status: 400 },
      )
    }
    return NextResponse.json(saved)
  } catch (error) {
    console.error('[reports] could not save an Ask draft:', error)
    return NextResponse.json(
      { error: { code: 'SAVE_FAILED', message: 'The draft could not be saved. Try again.' } },
      { status: 500 },
    )
  }
}
