/**
 * API Route: POST /api/commands/reapp-block-set
 *
 * Put a MANUAL_ADMIN re-application block on a canonical customer (BTB-517).
 * Supervisor or admin only. Publishes reapplication_block.manual_set.v1 to
 * chatLedger for billieChat's reapplicationBlock service and answers 202.
 *
 * The outcome never comes back on this response. billieChat answers with
 * reapplication_block.manual_set_applied.v1 or ..._rejected.v1, and the block
 * reaches the customer row through reapplication_block.state.changed.v1 (the
 * only writer of the block itself). The UI shows "requested" until then. While
 * billieChat's ENABLE_MANUAL_BLOCK_SET flag is off nothing comes back at all,
 * which is why nothing here waits.
 *
 * Request body:
 * - canonicalCustomerId (required)
 * - reasonCode (required): credit_review_hold | cancelled_pre_disbursement | fraud_hold
 * - note (required)
 * - blockUntil: the block's last day, a Sydney date 'YYYY-MM-DD'; null or
 *   absent for a block that does not expire
 *
 * Every request gets a new request_id (billieChat's idempotency key), so a
 * second submit is a second set, never a replay of the first.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority } from '@/lib/access'
import { ManualBlockSetCommandSchema } from '@/lib/events/schemas'
import { createValidationError } from '@/lib/utils/api-error'
import { manualBlockExpiresAt } from '@/lib/reapplicationBlock'
import { sydneyDateString } from '@/lib/disbursement-cutoff'
import { UNKNOWN_USER_FALLBACK } from '@/lib/constants'
import { EventPublishError } from '@/server/event-publisher'
import { publishManualBlockSet } from '@/server/chatledger-publisher'
import type { User } from '@/payload-types'

/** "First Last", else the email: the name billieChat records as the operator. */
function displayName(user: User): string {
  if (user.firstName) {
    return `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
  }
  return user.email || UNKNOWN_USER_FALLBACK
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user } = auth

    const parsed = ManualBlockSetCommandSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return createValidationError(parsed.error.flatten().fieldErrors)
    }
    const cmd = parsed.data

    // A block that ended before today would be accepted by billieChat and
    // block nobody; say so instead of sending it.
    if (cmd.blockUntil && cmd.blockUntil < sydneyDateString(new Date())) {
      return createValidationError({ blockUntil: ['Block until cannot be in the past'] })
    }

    const requestId = nanoid()
    const { eventId } = await publishManualBlockSet({
      request_id: requestId,
      canonical_customer_id: cmd.canonicalCustomerId,
      operator_id: String(user.id),
      operator_name: displayName(user),
      reason_code: cmd.reasonCode,
      note: cmd.note,
      expires_at: cmd.blockUntil ? manualBlockExpiresAt(cmd.blockUntil) : null,
    })

    return NextResponse.json(
      { requestId, eventId, status: 'accepted', message: 'Manual block requested' },
      { status: 202 },
    )
  } catch (error) {
    console.error('[ManualBlockSet] Error:', error)
    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'The block request was not sent. Try again.',
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
