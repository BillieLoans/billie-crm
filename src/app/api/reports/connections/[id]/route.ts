/**
 * DELETE /api/reports/connections/:id — cut one of the signed-in person's
 * own MCP connections. Its tokens stop working on the next request.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { errorResponse } from '@/server/reporting/route-auth'
import { deleteOwnConnection } from '@/server/reporting/mcp-oauth'

interface RouteParams {
  params: Promise<{ id: string }>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  if (!UUID.test(id)) return errorResponse(404, 'NOT_FOUND', 'That connection is not yours.')
  try {
    const removed = await deleteOwnConnection(auth.payload, String(auth.user.id), id)
    if (!removed) return errorResponse(404, 'NOT_FOUND', 'That connection is not yours.')
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[reports] could not remove a connection:', error)
    return errorResponse(500, 'DELETE_FAILED', 'That could not be removed. Try again.')
  }
}
