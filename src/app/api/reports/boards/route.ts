/**
 * GET/POST /api/reports/boards — the boards the signed-in user can open, and
 * (report authors) a new board. POST body: `{ title, description? }`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { errorResponse } from '@/server/reporting/route-auth'
import { boardFailure, createBoard, listBoards } from '@/server/reporting/boards'

export async function GET() {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  try {
    return NextResponse.json({ boards: await listBoards(auth.payload, auth.user) })
  } catch (error) {
    return boardFailure(error)
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  const body = (await request.json().catch(() => null)) as {
    title?: unknown
    description?: unknown
  } | null
  if (typeof body?.title !== 'string' || body.title.length > 120) {
    return errorResponse(400, 'NO_TITLE', 'Give the board a title (up to 120 characters).')
  }
  try {
    const board = await createBoard(auth.payload, auth.user, {
      title: body.title,
      description: typeof body.description === 'string' ? body.description.slice(0, 500) : '',
    })
    return NextResponse.json({ board }, { status: 201 })
  } catch (error) {
    return boardFailure(error)
  }
}
