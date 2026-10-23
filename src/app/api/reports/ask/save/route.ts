/**
 * POST /api/reports/ask/save — save a checked Ask Claude draft (BTB-508).
 *
 * Body: `{ definition, publish?, roles?, category?, reportId? }`. Runs every
 * check again (including a run on the defaults) and refuses on any error.
 * Saves an unpublished draft, or with `publish: true` publishes straight
 * away to `roles` (default admins and supervisors). With `reportId` it
 * changes that report (a new draft version, or published) instead of
 * creating one. Report authors only; the author and origin "ask" are
 * recorded.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { errorResponse } from '@/server/reporting/route-auth'
import { isReportAuthor } from '@/server/reporting/run-report'
import { parseCategory, parseDefinition, parseRoles, saveDraft } from '@/server/reporting/ask/draft'

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if ('error' in auth) return auth.error
  const { payload, user } = auth
  if (!isReportAuthor(user)) {
    return errorResponse(403, 'FORBIDDEN', 'Only report authors can save reports.')
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const definition = parseDefinition(body?.definition)
  if (!definition) {
    return errorResponse(
      400,
      'NO_DEFINITION',
      'Send the draft definition (within the size limits).',
    )
  }
  const roles = body?.roles === undefined ? undefined : parseRoles(body.roles)
  if (roles === null) return errorResponse(400, 'BAD_ROLES', 'Choose at least one role.')
  const category = body?.category === undefined ? undefined : parseCategory(body.category)
  if (category === null) return errorResponse(400, 'BAD_CATEGORY', 'Choose an area.')
  const reportId =
    typeof body?.reportId === 'string' && body.reportId.length <= 100 ? body.reportId : undefined
  try {
    const saved = await saveDraft(payload, user, definition, {
      publish: body?.publish === true,
      roles,
      category,
      reportId,
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
    // Recorded here, not by the browser, so the usage page's save rate
    // counts real saves only; a change to an existing report is not a new
    // question answered.
    if (!reportId) {
      try {
        await payload.create({
          collection: 'report-events',
          data: { kind: 'ask_save', reportSlug: saved.slug, user: String(user.id) },
          overrideAccess: true,
        })
      } catch (error) {
        console.error('[reports] could not record an Ask save:', error)
      }
    }
    return NextResponse.json(saved)
  } catch (error) {
    console.error('[reports] could not save an Ask draft:', error)
    return errorResponse(500, 'SAVE_FAILED', 'The report could not be saved. Try again.')
  }
}
