/**
 * API Route: POST /api/commands/reapp-block-clear/different-person
 *
 * "Clear: different person" for an application stopped by a verified-contact
 * match (BTB-569): the new applicant code-verified an email or mobile that an
 * earlier, currently blocked customer also verified, but is not that customer
 * (a recycled number, a shared family email).
 *
 * Same role as the ordinary clear (servicing: admin, supervisor, operations).
 * No maker-checker: this clears one contact match and never a block, so the
 * earlier customer stays blocked and the applicant is still judged on proven
 * identity after IDV.
 *
 * The client names only the stopped conversation. The matched customer is read
 * from that conversation's own block record, so a request can only ever clear
 * the match that stopped it, and only if it was a contact-match stop.
 *
 * Publishes reapplication_block.clear_authorized.v1 to chatLedger with
 * `reasons: ["DIFFERENT_PERSON"]` and `stopped_conversation_id`, then the
 * CRM's own block_clear.different_person_requested.v1, which marks the
 * conversation pending with who asked and why. billieChat answers with
 * reapplication_block.cleared.v1 or clear_rejected.v1 (`MISSING_FIELDS`,
 * `UNKNOWN_STOPPED_CONVERSATION`); the outcome reaches the conversation record,
 * never this response.
 *
 * Returns 202 Accepted.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { DifferentPersonClearCommandSchema } from '@/lib/events/schemas'
import { createValidationError } from '@/lib/utils/api-error'
import { isVerifiedContactStop } from '@/lib/reapplicationBlock'
import { staffDisplayName } from '@/lib/staffDisplayName'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'
import { publishClearAuthorized } from '@/server/chatledger-publisher'
import {
  DIFFERENT_PERSON_CLEAR_REASON,
  EVENT_TYPE_BLOCK_CLEAR_DIFFERENT_PERSON_REQUESTED,
} from '@/lib/events/config'
import type { DifferentPersonClearRequestedPayload } from '@/lib/events/types'

interface StoppedBlock {
  canonicalCustomerId?: string | null
  clearStatus?: string | null
  recognition?: { band?: string | null } | null
}

function refuse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate: the same role as the ordinary block clear.
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    // 2. Parse and validate body
    const parsed = DifferentPersonClearCommandSchema.safeParse(
      await request.json().catch(() => null),
    )
    if (!parsed.success) {
      return createValidationError(parsed.error.flatten().fieldErrors)
    }
    const cmd = parsed.data

    // 3. The stop itself decides what may be cleared, not the client.
    const found = await payload.find({
      collection: 'conversations',
      where: { conversationId: { equals: cmd.conversationId } },
      limit: 1,
      depth: 0,
    })
    const doc = found.docs[0] as { reapplicationBlock?: StoppedBlock | null } | undefined
    if (!doc) {
      return refuse(404, 'NOT_FOUND', 'Conversation not found.')
    }
    const block = doc.reapplicationBlock
    if (!isVerifiedContactStop(block)) {
      return refuse(
        409,
        'NOT_A_CONTACT_MATCH_STOP',
        'This application was not stopped by a contact match.',
      )
    }
    if (!block?.canonicalCustomerId) {
      return refuse(
        409,
        'NO_MATCHED_CUSTOMER',
        'This stop does not name the customer it matched, so it cannot be cleared here.',
      )
    }
    if (block.clearStatus === 'cleared') {
      return refuse(409, 'ALREADY_CLEARED', 'This contact match has already been cleared.')
    }

    // 4. The authoritative command, to billieChat.
    const requestId = nanoid()
    const { eventId } = await publishClearAuthorized({
      canonical_customer_id: block.canonicalCustomerId,
      reasons: [DIFFERENT_PERSON_CLEAR_REASON],
      operator_id: String(user.id),
      justification: cmd.justification,
      request_id: requestId,
      requested_at: new Date().toISOString(),
      stopped_conversation_id: cmd.conversationId,
    })

    // 5. The CRM's own record of the request (who, why, "pending"). The
    // command is already with billieChat, so a failure here must not read as
    // "not sent": the clear still lands on the record from billieChat's answer.
    try {
      const eventPayload: DifferentPersonClearRequestedPayload = {
        conversationId: cmd.conversationId,
        canonicalCustomerId: block.canonicalCustomerId,
        justification: cmd.justification,
        requestedBy: String(user.id),
        requestedByName: staffDisplayName(user),
      }
      await createAndPublishEvent({
        typ: EVENT_TYPE_BLOCK_CLEAR_DIFFERENT_PERSON_REQUESTED,
        userId: String(user.id),
        payload: eventPayload,
        requestId,
      })
    } catch (error) {
      console.error('[BlockClear DifferentPerson] Request record not published:', error)
    }

    return NextResponse.json(
      { eventId, requestId, status: 'accepted', message: 'Different-person clear submitted' },
      { status: 202 },
    )
  } catch (error) {
    console.error('[BlockClear DifferentPerson] Error:', error)
    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'The clear was not sent. Please try again.',
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
