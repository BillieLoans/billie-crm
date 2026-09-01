/**
 * API Route: POST /api/commands/conversation-kill
 *
 * End a live billieChat conversation (admin/supervisor only). Publishes
 * conversation.kill.requested.v1 to chatLedger; billieChat terminates the
 * conversation and emits conversation.killed.v1 back for the projection.
 * Fires immediately (confirm-modal ceremony — no approval round-trip).
 * Returns 202 Accepted.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { requireAuth } from '@/lib/auth'
import { canService, hasApprovalAuthority } from '@/lib/access'
import { ConversationKillCommandSchema } from '@/lib/events/schemas'
import { EventPublishError } from '@/server/event-publisher'
import { publishConversationKill } from '@/server/chatledger-publisher'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user } = auth
    if (!hasApprovalAuthority(user)) {
      return NextResponse.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Ending a conversation requires supervisor or admin authority.',
          },
        },
        { status: 403 },
      )
    }

    const parsed = ConversationKillCommandSchema.safeParse(await request.json())
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

    // A customer asking to cancel must never be blocked from re-applying. The
    // reapplicationBlock service raises a MANUAL_ADMIN block purely on the
    // block_requested boolean (it never inspects reason_category), so reject
    // the combination here rather than trusting the client-side guard.
    if (cmd.reasonCategory === 'customer_request' && cmd.blockRequested) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A customer-requested cancellation cannot also raise a reapplication block.',
          },
        },
        { status: 400 },
      )
    }

    const requestId = nanoid()
    const { eventId } = await publishConversationKill({
      request_id: requestId,
      conversation_id: cmd.conversationId,
      application_number: cmd.applicationNumber ?? '',
      customer_id: cmd.customerId,
      reason_category: cmd.reasonCategory,
      note: cmd.note ?? '',
      actor: `user:${user.id}`,
      block_requested: cmd.blockRequested ?? false,
      requested_at: new Date().toISOString(),
    })
    return NextResponse.json(
      { eventId, requestId, status: 'accepted', message: 'Conversation kill submitted' },
      { status: 202 },
    )
  } catch (error) {
    console.error('[ConversationKill] Error:', error)
    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'Failed to submit. Please try again.',
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
