/**
 * API Route: POST /api/commands/reapp-block-clear/request
 *
 * Submit a reapplication block-clear request.
 *
 * Tiering:
 *   - Single-operator (windowed declines only, e.g. SERVICEABILITY):
 *     Emits reapplication_block.clear_authorized.v1 directly onto chatLedger.
 *     billieChat's Broker routes it to the reapplicationBlock service, which
 *     processes the clear immediately — no approval workflow.
 *
 *   - Maker-checker (high-risk reasons, e.g. PRIOR_DEFAULT, PRIOR_SERIOUS_ARREARS):
 *     Emits block_clear_approval.requested.v1 onto the internal CRM stream.
 *     The Python event processor creates a pending row; a supervisor approves
 *     via the separate /approve route, which then posts the clear_authorized event.
 *
 * Returns 202 Accepted.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { BlockClearRequestCommandSchema } from '@/lib/events/schemas'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'
import { publishClearAuthorized } from '@/server/chatledger-publisher'
import {
  EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REQUESTED,
  REASONS_REQUIRING_APPROVAL,
} from '@/lib/events/config'
import type { BlockClearApprovalRequestedPayload } from '@/lib/events/types'

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate — servicing role required
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user } = auth

    // 2. Parse and validate body
    const parsed = BlockClearRequestCommandSchema.safeParse(await request.json())
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

    const operatorName = user.firstName
      ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
      : user.email || 'Unknown User'

    // 3. Tiering decision: does any reason require approval?
    const needsApproval = cmd.reasons.some((r) =>
      (REASONS_REQUIRING_APPROVAL as readonly string[]).includes(r),
    )

    if (needsApproval) {
      // Maker-checker path: raise approval request; Python processor creates pending row.
      const eventPayload: BlockClearApprovalRequestedPayload = {
        canonicalCustomerId: cmd.canonicalCustomerId,
        conversationId: cmd.conversationId,
        customerName: cmd.customerName ?? '',
        reasons: cmd.reasons,
        justification: cmd.justification,
        requestedBy: String(user.id),
        requestedByName: operatorName,
      }
      const result = await createAndPublishEvent({
        typ: EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REQUESTED,
        userId: String(user.id),
        payload: eventPayload,
      })
      return NextResponse.json(result, { status: 202 })
    }

    // Single-operator path: emit the authoritative clear directly to chatLedger.
    const requestId = nanoid()
    const { eventId } = await publishClearAuthorized({
      canonical_customer_id: cmd.canonicalCustomerId,
      reasons: cmd.reasons,
      operator_id: String(user.id),
      justification: cmd.justification,
      request_id: requestId,
      requested_at: new Date().toISOString(),
    })
    return NextResponse.json(
      { eventId, requestId, status: 'accepted', message: 'Block clear submitted' },
      { status: 202 },
    )
  } catch (error) {
    console.error('[BlockClear Request] Error:', error)
    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'Failed to submit block clear. Please try again.',
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
