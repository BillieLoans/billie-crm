/**
 * API Route: POST /api/commands/writeoff/reject
 *
 * Reject a pending write-off request.
 * Publishes a writeoff.rejected.v1 event to the Redis stream.
 *
 * Returns 202 Accepted with eventId and requestId for polling.
 */

import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { WriteOffRejectCommandSchema } from '@/lib/events/schemas'
import { EVENT_TYPE_WRITEOFF_REJECTED } from '@/lib/events/config'
import type { WriteOffRejectedPayload } from '@/lib/events/types'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'
import { hasApprovalAuthority } from '@/lib/access'

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user
    const payload = await getPayload({ config: configPromise })
    const headersList = await headers()

    const { user } = await payload.auth({
      headers: new Headers(Array.from(headersList.entries())),
    })

    if (!user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } },
        { status: 401 },
      )
    }

    // 2. Check authorization - only supervisors/admins can reject
    if (!hasApprovalAuthority(user)) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'You do not have permission to reject write-offs.' } },
        { status: 403 },
      )
    }

    // 3. Parse and validate request body
    const body = await request.json()
    const parseResult = WriteOffRejectCommandSchema.safeParse(body)

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

    // 4. Build event payload with user info
    const eventPayload: WriteOffRejectedPayload = {
      requestId: command.requestId,
      requestNumber: command.requestNumber,
      reason: command.reason,
      rejectedBy: String(user.id),
      rejectedByName: user.firstName
        ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
        : user.email || 'Unknown User',
    }

    // 5. Publish event to Redis (use requestId as conv for correlation)
    const result = await createAndPublishEvent({
      typ: EVENT_TYPE_WRITEOFF_REJECTED,
      userId: String(user.id),
      payload: eventPayload,
      requestId: command.requestId, // Reuse the original request ID for conv
    })

    // 6. Return 202 Accepted
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    console.error('[WriteOff Reject] Error:', error)

    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'Failed to reject write-off. Please try again.',
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
