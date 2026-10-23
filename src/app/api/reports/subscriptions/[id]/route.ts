/**
 * PATCH/DELETE /api/reports/subscriptions/:id — pause, resume or remove one
 * of the signed-in user's report emails or alerts. PATCH body: `{ paused }`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { errorResponse } from '@/server/reporting/route-auth'
import { SubscriptionError, deleteSubscription, setPaused } from '@/server/reporting/subscriptions'

interface RouteParams {
  params: Promise<{ id: string }>
}

function failure(error: unknown) {
  if (error instanceof SubscriptionError) {
    return errorResponse(error.status, error.code, error.message)
  }
  console.error('[reports] subscription change failed:', error)
  return errorResponse(500, 'SAVE_FAILED', 'That could not be saved. Try again.')
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  const body = (await request.json().catch(() => null)) as { paused?: unknown } | null
  if (typeof body?.paused !== 'boolean') {
    return errorResponse(400, 'BAD_REQUEST', 'Send paused as true or false.')
  }
  try {
    await setPaused(auth.payload, auth.user, id, body.paused)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return failure(error)
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  try {
    await deleteSubscription(auth.payload, auth.user, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return failure(error)
  }
}
