/**
 * API Route: POST /api/commands/writeoff/approve
 *
 * Approve a pending write-off request.
 * 1. Looks up the write-off request to get account details
 * 2. Calls the gRPC ledger service to post the write-off
 * 3. Publishes a writeoff.approved.v1 event to the Redis stream
 *
 * Returns 202 Accepted with eventId and requestId for polling.
 *
 * Double-posting protection (two independent layers):
 *   1. The ledger idempotency key is deterministic (`writeoff-approve-${requestId}`), so the
 *      ledger's own 24h idempotency cache absorbs any sequential retry of this route.
 *   2. A Redis "ledger posted" marker is written immediately after the ledger call succeeds and
 *      BEFORE the Redis event publish. The projection row only flips out of `pending` via that
 *      event, so a retry after a failed publish would otherwise pass the pending check and post
 *      to the ledger a second time. On retry the marker short-circuits the ledger call and the
 *      route goes straight to re-publishing the event with the original ledger identifiers.
 *      The marker is best-effort: any Redis failure falls through to the ledger call, which
 *      layer 1 already makes safe.
 */

import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { WriteOffApproveCommandSchema } from '@/lib/events/schemas'
import { EVENT_TYPE_WRITEOFF_APPROVED } from '@/lib/events/config'
import type { WriteOffApprovedPayload } from '@/lib/events/types'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'
import { hasApprovalAuthority } from '@/lib/access'
import { getLedgerClient } from '@/server/grpc-client'
import { getRedisClient } from '@/server/redis-client'

/** gRPC status code 9 — FAILED_PRECONDITION. Deterministic business-rule rejection. */
const GRPC_FAILED_PRECONDITION = 9

/** Marker TTL in seconds — matches the ledger's 24h idempotency window. */
const LEDGER_POSTED_TTL_SECONDS = 24 * 60 * 60

/** Ledger identifiers captured when the write-off was posted. */
type LedgerPostResult = {
  ledgerEventId?: string
  transactionId?: string
}

const ledgerPostedKey = (requestId: string) => `writeoff-ledger-posted:${requestId}`

/**
 * Read the "already posted to the ledger" marker for this request.
 * Best-effort: any Redis failure returns null so the caller posts to the ledger, which is safe
 * because the idempotency key is deterministic.
 */
async function readLedgerPostedMarker(requestId: string): Promise<LedgerPostResult | null> {
  try {
    const raw = await getRedisClient().get(ledgerPostedKey(requestId))
    if (!raw) return null
    return JSON.parse(raw) as LedgerPostResult
  } catch (error) {
    console.error('[WriteOff Approve] Failed to read ledger-posted marker:', error)
    return null
  }
}

/**
 * Record that the ledger post succeeded, before the event is published.
 * Best-effort: a failure here only costs us the defence-in-depth layer.
 */
async function writeLedgerPostedMarker(requestId: string, result: LedgerPostResult): Promise<void> {
  try {
    await getRedisClient().set(
      ledgerPostedKey(requestId),
      JSON.stringify(result),
      'EX',
      LEDGER_POSTED_TTL_SECONDS,
      'NX',
    )
  } catch (error) {
    console.error('[WriteOff Approve] Failed to write ledger-posted marker:', error)
  }
}

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

    // 2. Check authorization - only supervisors/admins can approve
    if (!hasApprovalAuthority(user)) {
      return NextResponse.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to approve write-offs.',
          },
        },
        { status: 403 },
      )
    }

    // 3. Parse and validate request body
    const body = await request.json()
    const parseResult = WriteOffApproveCommandSchema.safeParse(body)

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

    // 4. Look up the write-off request to get account details
    // depth: 0 is REQUIRED — without it Payload populates relationships (default depth 2),
    // so writeOffDoc.requestedBy would be an object and String() would yield '[object Object]',
    // silently bypassing the maker≠checker guard below.
    const writeOffRequest = await payload.find({
      collection: 'write-off-requests',
      where: {
        or: [{ requestId: { equals: command.requestId } }, { id: { equals: command.requestId } }],
      },
      limit: 1,
      depth: 0,
    })

    if (writeOffRequest.docs.length === 0) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Write-off request not found.' } },
        { status: 404 },
      )
    }

    const writeOffDoc = writeOffRequest.docs[0]

    // Verify request is still pending
    if (writeOffDoc.status !== 'pending') {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: `Request is already ${writeOffDoc.status}.` } },
        { status: 400 },
      )
    }

    // Segregation of duties: the approver must differ from the requester.
    if (String(writeOffDoc.requestedBy) === String(user.id)) {
      return NextResponse.json(
        { error: { code: 'SELF_APPROVAL', message: 'You cannot approve your own request.' } },
        { status: 403 },
      )
    }

    const approverName = user.firstName
      ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
      : user.email || 'Unknown User'

    // 5. Call the gRPC ledger service to post the write-off — unless a previous attempt already
    //    did and only the event publish failed (see the header note).
    let ledgerResult = await readLedgerPostedMarker(command.requestId)

    if (!ledgerResult) {
      const ledgerClient = getLedgerClient()
      // Deterministic key: the ledger's 24h idempotency cache must dedupe sequential retries,
      // so it must NOT carry a timestamp or any other per-attempt entropy.
      const idempotencyKey = `writeoff-approve-${command.requestId}`
      try {
        const ledgerResponse = await ledgerClient.writeOff({
          loanAccountId: writeOffDoc.loanAccountId,
          reason: `Write-off approved: ${writeOffDoc.reason}. ${command.comment}`,
          approvedBy: String(user.id),
          idempotencyKey,
        })
        ledgerResult = {
          ledgerEventId: ledgerResponse.eventId,
          transactionId: ledgerResponse.transaction?.transactionId,
        }
      } catch (ledgerError) {
        console.error('[WriteOff Approve] Ledger error:', ledgerError)

        // gRPC FAILED_PRECONDITION (9) is a deterministic business-rule rejection — retrying
        // will fail identically, so surface it as a non-retryable 422 (matches the ledger routes).
        if ((ledgerError as { code?: number }).code === GRPC_FAILED_PRECONDITION) {
          return NextResponse.json(
            {
              error: {
                code: 'LEDGER_REJECTED',
                message:
                  (ledgerError as { details?: string }).details ||
                  'The ledger rejected this write-off due to a business rule.',
              },
            },
            { status: 422 },
          )
        }

        return NextResponse.json(
          {
            error: {
              code: 'LEDGER_ERROR',
              message: 'Failed to post write-off to ledger. Please try again.',
            },
          },
          { status: 503 },
        )
      }

      // Record the successful post BEFORE publishing, so a publish failure cannot lead to a
      // second write-off on retry.
      await writeLedgerPostedMarker(command.requestId, ledgerResult)
    }

    // 6. Build event payload with user info and ledger details
    const eventPayload: WriteOffApprovedPayload = {
      requestId: command.requestId,
      requestNumber: command.requestNumber,
      comment: command.comment,
      approvedBy: String(user.id),
      approvedByName: approverName,
      // Include ledger transaction details
      ledgerEventId: ledgerResult.ledgerEventId,
      transactionId: ledgerResult.transactionId,
    }

    // 7. Publish event to Redis (use requestId as conv for correlation)
    const result = await createAndPublishEvent({
      typ: EVENT_TYPE_WRITEOFF_APPROVED,
      userId: String(user.id),
      payload: eventPayload,
      requestId: command.requestId, // Reuse the original request ID for conv
    })

    // 8. Return 202 Accepted
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    console.error('[WriteOff Approve] Error:', error)

    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'Failed to approve write-off. Please try again.',
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
