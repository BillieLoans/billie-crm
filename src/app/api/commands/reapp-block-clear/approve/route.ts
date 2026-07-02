/**
 * API Route: POST /api/commands/reapp-block-clear/approve
 *
 * Approve a pending reapplication block-clear request.
 *
 * Two actions in sequence:
 *   1. publishClearAuthorized → chatLedger — the authoritative command that
 *      billieChat's reapplicationBlock service will act on. Carries the
 *      maker's operator_id and the checker's approval attestation.
 *   2. createAndPublishEvent → internal CRM stream — updates the CRM
 *      projection row (projection processor sets status → approved).
 *
 * Server-side maker≠checker (BTB-202 security requirement):
 *   The route looks up the pending request, checks requestedBy ≠ user.id,
 *   and returns 403 SELF_APPROVAL before any publish if they match.
 *   This closes the gap that the write-off flow only guards in the UI.
 *
 * Returns 202 Accepted.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { hasApprovalAuthority } from '@/lib/access'
import { BlockClearApproveCommandSchema } from '@/lib/events/schemas'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'
import { publishClearAuthorized } from '@/server/chatledger-publisher'
import { EVENT_TYPE_BLOCK_CLEAR_APPROVAL_APPROVED, type ClearableReason } from '@/lib/events/config'
import type { BlockClearApprovalApprovedPayload } from '@/lib/events/types'

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

    // 2. Check authorization — only supervisors/admins can approve
    if (!hasApprovalAuthority(user)) {
      return NextResponse.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to approve block clears.',
          },
        },
        { status: 403 },
      )
    }

    // 3. Parse and validate request body
    const parsed = BlockClearApproveCommandSchema.safeParse(await request.json())
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

    // 4. Look up the pending request (404 if absent, 400 if not pending)
    const found = await payload.find({
      collection: 'reapplication-block-clear-requests',
      depth: 0, // enforce scalar relationship IDs — the maker≠checker comparison depends on it
      where: {
        or: [{ requestId: { equals: cmd.requestId } }, { id: { equals: cmd.requestId } }],
      },
      limit: 1,
    })

    if (found.docs.length === 0) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Block-clear request not found.' } },
        { status: 404 },
      )
    }

    const doc = found.docs[0]

    if (doc.status !== 'pending') {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: `Request is already ${doc.status}.` } },
        { status: 400 },
      )
    }

    // 5. Server-side maker≠checker (closes the UI-only gap in the write-off flow).
    //    operator_id  = doc.requestedBy  (MAKER — the person who raised the request)
    //    approved_by  = user.id          (CHECKER — the current approver)
    //    The guard guarantees they differ before any publish call is made.
    if (String(doc.requestedBy) === String(user.id)) {
      return NextResponse.json(
        { error: { code: 'SELF_APPROVAL', message: 'You cannot approve your own request.' } },
        { status: 403 },
      )
    }

    // 5b. Data-integrity guard — these fields are always set by the request route;
    //     guard both narrows the types and protects against a corrupt row.
    if (
      !doc.canonicalCustomerId ||
      !doc.justification ||
      !doc.requestNumber ||
      !doc.requestedBy ||
      !Array.isArray(doc.reasons)
    ) {
      return NextResponse.json(
        { error: { code: 'DATA_INTEGRITY', message: 'Stored block-clear request is incomplete.' } },
        { status: 500 },
      )
    }

    const approverName = user.firstName
      ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
      : user.email || 'Unknown User'

    // 6. Emit the authoritative clear onto chatLedger with the approval attestation.
    //    operator_id  = MAKER (doc.requestedBy)
    //    approved_by  = CHECKER (user.id) — guaranteed ≠ operator_id by guard above
    //
    // NOTE: the two publishes below (publishClearAuthorized + createAndPublishEvent) are NOT
    // atomic. request_id is billieChat's idempotency key, so a retry will not double-apply
    // the clear on billieChat's side. A partial failure (chatLedger ok, CRM stream fails)
    // leaves the CRM request row in `pending` (ops-visible) — future outbox/saga work.
    await publishClearAuthorized({
      canonical_customer_id: doc.canonicalCustomerId,
      reasons: doc.reasons as ClearableReason[],
      operator_id: String(doc.requestedBy),
      justification: doc.justification,
      request_id: cmd.requestId,
      requested_at: doc.requestedAt ?? doc.createdAt ?? new Date().toISOString(),
      approval: {
        approval_request_id: doc.requestNumber,
        approved_by: String(user.id),
        approved_by_name: approverName,
        approved_at: new Date().toISOString(),
        comment: cmd.comment,
      },
    })

    // 7. Publish the CRM-internal approval event (updates the projection row).
    const eventPayload: BlockClearApprovalApprovedPayload = {
      requestId: cmd.requestId,
      requestNumber: doc.requestNumber, // use server-derived value, not client-supplied
      comment: cmd.comment,
      approvedBy: String(user.id),
      approvedByName: approverName,
    }

    const result = await createAndPublishEvent({
      typ: EVENT_TYPE_BLOCK_CLEAR_APPROVAL_APPROVED,
      userId: String(user.id),
      payload: eventPayload,
      requestId: cmd.requestId,
    })

    // 8. Return 202 Accepted
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    console.error('[BlockClear Approve] Error:', error)

    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'Failed to approve block clear. Please try again.',
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
