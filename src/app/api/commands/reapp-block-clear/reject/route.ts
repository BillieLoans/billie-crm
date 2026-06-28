/**
 * API Route: POST /api/commands/reapp-block-clear/reject
 *
 * Reject a pending reapplication block-clear request.
 * Publishes a block_clear_approval.rejected.v1 event to the internal CRM stream.
 * The Python event processor updates the projection row to status=rejected.
 *
 * Authorization: supervisor or admin only (hasApprovalAuthority).
 * No self-check on reject — any authorized user can reject any pending request.
 *
 * Returns 202 Accepted.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { hasApprovalAuthority } from '@/lib/access'
import { BlockClearRejectCommandSchema } from '@/lib/events/schemas'
import { EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REJECTED } from '@/lib/events/config'
import type { BlockClearApprovalRejectedPayload } from '@/lib/events/types'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'

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

    // 2. Check authorization — only supervisors/admins can reject
    if (!hasApprovalAuthority(user)) {
      return NextResponse.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to reject block clears.',
          },
        },
        { status: 403 },
      )
    }

    // 3. Parse and validate request body
    const parsed = BlockClearRejectCommandSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      )
    }
    const cmd = parsed.data

    // 4. Build event payload with user info
    const eventPayload: BlockClearApprovalRejectedPayload = {
      requestId: cmd.requestId,
      requestNumber: cmd.requestNumber,
      reason: cmd.reason,
      rejectedBy: String(user.id),
      rejectedByName: user.firstName
        ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
        : user.email || 'Unknown User',
    }

    // 5. Publish event to Redis (use requestId as conv for correlation)
    const result = await createAndPublishEvent({
      typ: EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REJECTED,
      userId: String(user.id),
      payload: eventPayload,
      requestId: cmd.requestId,
    })

    // 6. Return 202 Accepted
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    console.error('[BlockClear Reject] Error:', error)

    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'Failed to reject block clear. Please try again.',
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
