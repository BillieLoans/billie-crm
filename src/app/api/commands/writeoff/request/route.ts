/**
 * API Route: POST /api/commands/writeoff/request
 *
 * Submit a new write-off request.
 * Publishes a writeoff.requested.v1 event to the Redis stream.
 *
 * Returns 202 Accepted with eventId and requestId for polling.
 */

import { NextRequest, NextResponse } from 'next/server'
import { WriteOffRequestCommandSchema } from '@/lib/events/schemas'
import { EVENT_TYPE_WRITEOFF_REQUESTED } from '@/lib/events/config'
import type { WriteOffRequestedPayload } from '@/lib/events/types'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user and verify servicing role
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user } = auth

    // 2. Parse and validate request body
    const body = await request.json()
    const parseResult = WriteOffRequestCommandSchema.safeParse(body)

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

    // 3. Build event payload with user info
    const eventPayload: WriteOffRequestedPayload = {
      loanAccountId: command.loanAccountId,
      customerId: command.customerId,
      customerName: command.customerName,
      accountNumber: command.accountNumber,
      amount: command.amount,
      originalBalance: command.originalBalance,
      reason: command.reason,
      notes: command.notes,
      priority: command.priority,
      requestedBy: String(user.id),
      requestedByName: user.firstName
        ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
        : user.email || 'Unknown User',
    }

    // 4. Publish event to Redis
    const result = await createAndPublishEvent({
      typ: EVENT_TYPE_WRITEOFF_REQUESTED,
      userId: String(user.id),
      payload: eventPayload,
    })

    // 5. Return 202 Accepted
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    console.error('[WriteOff Request] Error:', error)

    // Handle publish errors specifically
    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'Failed to submit write-off request. Please try again.',
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
