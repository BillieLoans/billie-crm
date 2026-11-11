/**
 * API Route: POST /api/commands/reapp-block-clear/different-person/undo
 *
 * "Undo: same person after all" for a verified-contact stop whose
 * "different person" clear is in effect (BTB-569). The applicant turned out
 * to be the earlier customer, so the contact must stop applications again.
 *
 * Same role as the clear it undoes (servicing: admin, supervisor,
 * operations), and the same justification minimum. No maker-checker: the undo
 * removes an exclusion and never a block, so it can only make the stop apply
 * again.
 *
 * The client names only the stopped conversation. The matched customer is read
 * from that conversation's own block record, and anything that is not a
 * currently cleared contact-match stop is refused with 409.
 *
 * Publishes reapplication_block.clear_revoke_authorized.v1 to chatLedger with
 * `reasons: ["DIFFERENT_PERSON"]` and `stopped_conversation_id`, then the
 * CRM's own block_clear.different_person_revoke_requested.v1, which marks the
 * undo pending on the conversation. billieChat answers with
 * reapplication_block.clear_revoked.v1 or clear_revoke_rejected.v1
 * (`MISSING_FIELDS`, `UNKNOWN_STOPPED_CONVERSATION`, `NOT_CLEARED`); the
 * outcome reaches the conversation record, never this response.
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
import { publishClearRevokeAuthorized } from '@/server/chatledger-publisher'
import {
  DIFFERENT_PERSON_CLEAR_REASON,
  EVENT_TYPE_BLOCK_CLEAR_DIFFERENT_PERSON_REVOKE_REQUESTED,
} from '@/lib/events/config'
import type { DifferentPersonClearRevokeRequestedPayload } from '@/lib/events/types'

interface StoppedBlock {
  canonicalCustomerId?: string | null
  clearStatus?: string | null
  clearRequestId?: string | null
  recognition?: { band?: string | null } | null
}

function refuse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate: the same role as the clear being undone.
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    // 2. Parse and validate body: the same shape and minimum as the clear.
    const parsed = DifferentPersonClearCommandSchema.safeParse(
      await request.json().catch(() => null),
    )
    if (!parsed.success) {
      return createValidationError(parsed.error.flatten().fieldErrors)
    }
    const cmd = parsed.data

    // 3. The stop itself decides what may be undone, not the client.
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
    if (block?.clearStatus !== 'cleared') {
      return refuse(
        409,
        'NOT_CLEARED',
        'This contact match is not cleared, so there is no clear to undo.',
      )
    }
    if (!block.canonicalCustomerId) {
      return refuse(
        409,
        'NO_MATCHED_CUSTOMER',
        'This stop does not name the customer it matched, so its clear cannot be undone here.',
      )
    }

    // 4. The authoritative command, to billieChat.
    const requestId = nanoid()
    const { eventId } = await publishClearRevokeAuthorized({
      request_id: requestId,
      operator_id: String(user.id),
      justification: cmd.justification,
      canonical_customer_id: block.canonicalCustomerId,
      reasons: [DIFFERENT_PERSON_CLEAR_REASON],
      stopped_conversation_id: cmd.conversationId,
    })

    // 5. The CRM's own record of the request ("pending"). The command is
    // already with billieChat, so a failure here must not read as "not sent":
    // the undo still lands on the record from billieChat's answer.
    try {
      const eventPayload: DifferentPersonClearRevokeRequestedPayload = {
        conversationId: cmd.conversationId,
        canonicalCustomerId: block.canonicalCustomerId,
        justification: cmd.justification,
        requestedBy: String(user.id),
        requestedByName: staffDisplayName(user),
        clearRequestId: block.clearRequestId ?? null,
      }
      await createAndPublishEvent({
        typ: EVENT_TYPE_BLOCK_CLEAR_DIFFERENT_PERSON_REVOKE_REQUESTED,
        userId: String(user.id),
        payload: eventPayload,
        requestId,
      })
    } catch (error) {
      console.error('[BlockClear DifferentPerson Undo] Request record not published:', error)
    }

    return NextResponse.json(
      { eventId, requestId, status: 'accepted', message: 'Undo of the clear submitted' },
      { status: 202 },
    )
  } catch (error) {
    console.error('[BlockClear DifferentPerson Undo] Error:', error)
    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'The undo was not sent. Please try again.',
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
