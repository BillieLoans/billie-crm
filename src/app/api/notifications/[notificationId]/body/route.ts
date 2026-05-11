/**
 * GET /api/notifications/[notificationId]/body
 *
 * Returns the rendered subject + body of a past notification.
 * Proxies to NotificationDispatcherService.GetNotification via gRPC.
 * Bodies are retained for 90 days after send — older requests return 404.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  getNotificationDispatcherClient,
  NotFoundError,
} from '@/server/notification-dispatcher-client'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ notificationId: string }> },
) {
  const auth = await requireAuth()
  if ('error' in auth) return auth.error

  const { notificationId } = await params
  if (!notificationId) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'notificationId is required' } },
      { status: 400 },
    )
  }

  try {
    const client = getNotificationDispatcherClient()
    const body = await client.getNotificationBody({ notificationId })
    return NextResponse.json(body)
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Notification body unavailable (older than 90 days or never existed).',
          },
        },
        { status: 404 },
      )
    }

    console.error('[notifications/body] gRPC error:', error)
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch notification body.',
        },
      },
      { status: 502 },
    )
  }
}
