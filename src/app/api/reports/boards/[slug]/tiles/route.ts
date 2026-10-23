/**
 * POST /api/reports/boards/:slug/tiles — put a report on a board (report
 * authors). Body: `{ report, parameters?, show? }`; the board's period
 * replaces the report's own, so dates are not kept.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { BOARD_TILE_SHOWS } from '@/lib/reports/boards'
import { errorResponse } from '@/server/reporting/route-auth'
import { boardFailure, addTile } from '@/server/reporting/boards'

interface RouteParams {
  params: Promise<{ slug: string }>
}

const tileRequest = z.object({
  report: z.string().min(1).max(50),
  parameters: z.record(z.string(), z.unknown()).default({}),
  show: z.enum(BOARD_TILE_SHOWS).optional(),
})

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { slug } = await params
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  const parsed = tileRequest.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(400, 'BAD_REQUEST', 'Name the report to add.')
  try {
    return NextResponse.json(
      { board: await addTile(auth.payload, auth.user, slug, parsed.data) },
      { status: 201 },
    )
  } catch (error) {
    return boardFailure(error)
  }
}
