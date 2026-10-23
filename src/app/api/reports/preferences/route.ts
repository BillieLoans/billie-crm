/**
 * GET/PUT /api/reports/preferences — the signed-in user's pinned reports.
 *
 * PUT body: `{ "pinned": ["slug", ...] }`, the whole list in order. Pins to
 * reports the person cannot open are dropped, and more than 20 are refused.
 * Pins are only links: running a pinned report still checks access.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { errorResponse } from '@/server/reporting/route-auth'
import { MAX_PINS, parsePins, readPins, writePins } from '@/server/reporting/preferences'
import { listReports } from '@/server/reporting/run-report'

export async function GET() {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  return NextResponse.json({ pinned: await readPins(auth.payload, String(auth.user.id)) })
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  const body = (await request.json().catch(() => null)) as { pinned?: unknown } | null
  const parsed = parsePins(body?.pinned)
  if (!parsed) return errorResponse(400, 'BAD_PINS', 'Send pinned as a list of report links.')
  try {
    // Only reports this person can open: a pin to a report that was
    // unpublished or unshared would otherwise hide in the count forever.
    const visible = new Set(
      (await listReports(auth.payload, auth.user)).filter((r) => r.published).map((r) => r.slug),
    )
    const pins = parsed.filter((slug) => visible.has(slug))
    if (pins.length > MAX_PINS) {
      return errorResponse(
        400,
        'TOO_MANY_PINS',
        `You can pin up to ${MAX_PINS} reports. Unpin one first.`,
      )
    }
    await writePins(auth.payload, String(auth.user.id), pins)
    return NextResponse.json({ pinned: pins })
  } catch (error) {
    console.error('[reports] could not save pins:', error)
    return errorResponse(500, 'SAVE_FAILED', 'Your pins could not be saved. Try again.')
  }
}
