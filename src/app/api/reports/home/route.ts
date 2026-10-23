/**
 * GET /api/reports/home — the headline numbers on the Reports home, from
 * the featured reports the signed-in user can run.
 */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { errorResponse } from '@/server/reporting/route-auth'
import { homeTiles } from '@/server/reporting/home'

export async function GET() {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  try {
    return NextResponse.json({ tiles: await homeTiles(auth.payload, auth.user) })
  } catch (error) {
    console.error('[reports] home failed:', error)
    return errorResponse(500, 'HOME_FAILED', 'The headline numbers could not be loaded.')
  }
}
