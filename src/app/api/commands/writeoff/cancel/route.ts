/**
 * API Route: POST /api/commands/writeoff/cancel
 *
 * Cancel a pending write-off request.
 * Publishes a writeoff.cancelled.v1 event to the Redis stream.
 *
 * Only the original requester or a supervisor/admin can cancel.
 *
 * Returns 202 Accepted with eventId and requestId for polling.
 */

import { NextRequest, NextResponse } from 'next/server'
import { WriteOffCancelCommandSchema } from '@/lib/events/schemas'
import { EVENT_TYPE_WRITEOFF_CANCELLED } from '@/lib/events/config'
import type { WriteOffCancelledPayload } from '@/lib/events/types'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'
import { requireAuth } from '@/lib/auth'
import { canService, hasApprovalAuthority } from '@/lib/access'

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user and verify servicing role
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    // 2. Parse and validate request body
    const body = await request.json()
    const parseResult = WriteOffCancelCommandSchema.safeParse(body)

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

    // Authorization: only the original requester or a supervisor/admin can cancel
    const existingRequest = await payload.find({
      collection: 'write-off-requests',
      where: { requestId: { equals: command.requestId } },
      limit: 1,
    })

    if (existingRequest.docs.length > 0) {
      const originalRequest = existingRequest.docs[0]
      const isOriginalRequester = String(originalRequest.requestedBy) === String(user.id)
      if (!isOriginalRequester && !hasApprovalAuthority(user)) {
        return NextResponse.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Only the original requester or a supervisor can cancel this request.',
            },
          },
          { status: 403 },
        )
      }
    }

    // 3. Build event payload with user info
    const eventPayload: WriteOffCancelledPayload = {
      requestId: command.requestId,
      requestNumber: command.requestNumber,
      cancelledBy: String(user.id),
      cancelledByName: user.firstName
        ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
        : user.email || 'Unknown User',
    }

    // 4. Publish event to Redis (use requestId as conv for correlation)
    const result = await createAndPublishEvent({
      typ: EVENT_TYPE_WRITEOFF_CANCELLED,
      userId: String(user.id),
      payload: eventPayload,
      requestId: command.requestId, // Reuse the original request ID for conv
    })

    // 5. Return 202 Accepted
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    console.error('[WriteOff Cancel] Error:', error)

    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'Failed to cancel write-off. Please try again.',
          },
        },
        { status: 503 },
      )
    }

    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
        },
      },
      { status: 500 },
    )
  }
}
