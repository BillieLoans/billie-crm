/**
 * GET /api/notifications/suppressions
 *
 * Lists every customer with an active notification suppression. Admin-only.
 * Used for ad-hoc inspection today; will back an admin overview page later.
 */

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { isAdmin } from '@/lib/access'
import { getNotificationDispatcherClient } from '@/server/notification-dispatcher-client'

export async function GET() {
  const auth = await requireAuth(isAdmin)
  if ('error' in auth) return auth.error

  try {
    const client = getNotificationDispatcherClient()
    const suppressions = await client.listSuppressions()
    return NextResponse.json({ suppressions })
  } catch (error) {
    console.error('[notifications/suppressions GET] gRPC error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to list suppressions.' } },
      { status: 502 },
    )
  }
}
