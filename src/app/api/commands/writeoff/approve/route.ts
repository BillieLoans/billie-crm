/**
 * API Route: POST /api/commands/writeoff/approve
 *
 * Approve a pending write-off request.
 * 1. Looks up the write-off request to get account details
 * 2. Calls the gRPC ledger service to post the write-off
 * 3. Publishes a writeoff.approved.v1 event to the Redis stream
 *
 * Returns 202 Accepted with eventId and requestId for polling.
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

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user
    const payload = await getPayload({ config: configPromise })
    const headersList = await headers()
    const cookieHeader = headersList.get('cookie') || ''

    const { user } = await payload.auth({
      headers: new Headers({ cookie: cookieHeader }),
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
        { error: { code: 'FORBIDDEN', message: 'You do not have permission to approve write-offs.' } },
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
    const writeOffRequest = await payload.find({
      collection: 'write-off-requests',
      where: {
        or: [
          { requestId: { equals: command.requestId } },
          { id: { equals: command.requestId } },
        ],
      },
      limit: 1,
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

    const approverName = user.firstName
      ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
      : user.email || 'Unknown User'

    // 5. Call the gRPC ledger service to post the write-off
    const ledgerClient = getLedgerClient()
    // Use requestId as part of idempotency key for correlation with the approval workflow
    const idempotencyKey = `writeoff-approve-${command.requestId}-${Date.now().toString(36)}`
    let ledgerResponse
    try {
      ledgerResponse = await ledgerClient.writeOff({
        loanAccountId: writeOffDoc.loanAccountId,
        reason: `Write-off approved: ${writeOffDoc.reason}. ${command.comment}`,
        approvedBy: String(user.id),
        idempotencyKey,
      })
      console.log('[WriteOff Approve] Ledger write-off posted:', ledgerResponse.eventId)
    } catch (ledgerError) {
      console.error('[WriteOff Approve] Ledger error:', ledgerError)
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

    // 6. Build event payload with user info and ledger details
    const eventPayload: WriteOffApprovedPayload = {
      requestId: command.requestId,
      requestNumber: command.requestNumber,
      comment: command.comment,
      approvedBy: String(user.id),
      approvedByName: approverName,
      // Include ledger transaction details
      ledgerEventId: ledgerResponse.eventId,
      transactionId: ledgerResponse.transaction?.transactionId,
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
