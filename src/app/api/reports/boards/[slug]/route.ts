/**
 * GET/PATCH/DELETE /api/reports/boards/:slug — open a board (its tiles the
 * user can run), and for report authors change or delete it. PATCH body:
 * `{ title?, description?, tiles? }` (tiles in order; the whole list).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { boardUpdateSchema } from '@/lib/reports/boards'
import { errorResponse } from '@/server/reporting/route-auth'
import { boardFailure, deleteBoard, getBoard, updateBoard } from '@/server/reporting/boards'

interface RouteParams {
  params: Promise<{ slug: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { slug } = await params
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  try {
    return NextResponse.json({ board: await getBoard(auth.payload, auth.user, slug) })
  } catch (error) {
    return boardFailure(error)
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { slug } = await params
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  const parsed = boardUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse(400, 'BAD_REQUEST', 'Check the title and the tiles, then try again.')
  }
  try {
    return NextResponse.json({
      board: await updateBoard(auth.payload, auth.user, slug, parsed.data),
    })
  } catch (error) {
    return boardFailure(error)
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { slug } = await params
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  try {
    await deleteBoard(auth.payload, auth.user, slug)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return boardFailure(error)
  }
}
