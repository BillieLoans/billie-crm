/**
 * /api/notifications/suppression
 *
 * Per-customer notification kill switch. Proxies to NotificationDispatcherService
 * via gRPC.
 *
 *   GET    ?customerId=cust_abc   → current suppression (or null)
 *   POST   body { customerId, mode, reason, expiresAt? } → set / replace
 *   DELETE ?customerId=cust_abc   → clear
 *
 * The dispatcher is the source of truth — these routes are thin transport
 * adapters. `setBy` and `setAt` are stamped server-side from the
 * authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { NotificationSuppressionCommandSchema } from '@/lib/events/schemas'
import {
  getNotificationDispatcherClient,
  type Suppression,
} from '@/server/notification-dispatcher-client'

function agentIdentifier(user: { email?: string | null; id: string | number }): string {
  return user.email ? `agent:${user.email}` : `agent:${String(user.id)}`
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if ('error' in auth) return auth.error

  const customerId = request.nextUrl.searchParams.get('customerId')
  if (!customerId) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'customerId query param is required' } },
      { status: 400 },
    )
  }

  try {
    const client = getNotificationDispatcherClient()
    const suppression: Suppression | null = await client.getSuppression(customerId)
    return NextResponse.json({ suppression })
  } catch (error) {
    console.error('[notifications/suppression GET] gRPC error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to read suppression state.' } },
      { status: 502 },
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(canService)
  if ('error' in auth) return auth.error
  const { user } = auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } },
      { status: 400 },
    )
  }

  const parseResult = NotificationSuppressionCommandSchema.safeParse(body)
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: parseResult.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  const command = parseResult.data

  try {
    const client = getNotificationDispatcherClient()
    const suppression = await client.setSuppression({
      customerId: command.customerId,
      mode: command.mode,
      reason: command.reason,
      setBy: agentIdentifier(user),
      expiresAt: command.expiresAt ?? null,
      correlationId: command.correlationId,
    })
    return NextResponse.json({ suppression })
  } catch (error) {
    console.error('[notifications/suppression POST] gRPC error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to set suppression.' } },
      { status: 502 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(canService)
  if ('error' in auth) return auth.error
  const { user } = auth

  const customerId = request.nextUrl.searchParams.get('customerId')
  if (!customerId) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'customerId query param is required' } },
      { status: 400 },
    )
  }

  try {
    const client = getNotificationDispatcherClient()
    const result = await client.clearSuppression({
      customerId,
      setBy: agentIdentifier(user),
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[notifications/suppression DELETE] gRPC error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to clear suppression.' } },
      { status: 502 },
    )
  }
}
