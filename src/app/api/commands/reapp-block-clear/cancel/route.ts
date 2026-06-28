/**
 * API Route: POST /api/commands/reapp-block-clear/cancel
 *
 * Cancel a pending reapplication block-clear approval request.
 * Publishes a block_clear_approval.cancelled.v1 event to the internal CRM stream.
 *
 * Only the original requester or a supervisor/admin can cancel.
 *
 * Returns 202 Accepted.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canService, hasApprovalAuthority } from '@/lib/access'
import { BlockClearCancelCommandSchema } from '@/lib/events/schemas'
import { EVENT_TYPE_BLOCK_CLEAR_APPROVAL_CANCELLED } from '@/lib/events/config'
import type { BlockClearApprovalCancelledPayload } from '@/lib/events/types'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate — servicing role required
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    // 2. Parse and validate body
    const body = await request.json()
    const parseResult = BlockClearCancelCommandSchema.safeParse(body)
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

    // 3. Authorization: only the original requester or a supervisor/admin can cancel
    const existingRequest = await payload.find({
      collection: 'reapplication-block-clear-requests',
      where: { requestId: { equals: command.requestId } },
      limit: 1,
    })

    if (existingRequest.docs.length === 0) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Block clear request not found.' } },
        { status: 404 },
      )
    }
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

    // 4. Build event payload
    const eventPayload: BlockClearApprovalCancelledPayload = {
      requestId: command.requestId,
      requestNumber: command.requestNumber,
      cancelledBy: String(user.id),
      cancelledByName: user.firstName
        ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
        : user.email || 'Unknown User',
    }

    // 5. Publish event (use requestId as conv for correlation)
    const result = await createAndPublishEvent({
      typ: EVENT_TYPE_BLOCK_CLEAR_APPROVAL_CANCELLED,
      userId: String(user.id),
      payload: eventPayload,
      requestId: command.requestId,
    })

    // 6. Return 202 Accepted
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    console.error('[BlockClear Cancel] Error:', error)

    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'Failed to cancel block clear. Please try again.',
          },
        },
        { status: 503 },
      )
    }

    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
      { status: 500 },
    )
  }
}
