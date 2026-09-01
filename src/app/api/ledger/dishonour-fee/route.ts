/**
 * API Route: POST /api/ledger/dishonour-fee
 *
 * Apply a dishonour fee (failed direct debit) to a loan account.
 *
 * Request body:
 * - loanAccountId (required): Loan account ID
 * - feeAmount (required): Fee amount as string
 * - reason (optional): Reason for fee (e.g., "direct debit returned")
 * - referenceId (optional): External payment reference that was dishonoured
 * - idempotencyKey (optional): Client key (8-128 chars) deduped by the ledger for 24h;
 *   a server-generated key is used when absent
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient, generateIdempotencyKey } from '@/server/grpc-client'
import { serializeTransaction } from '@/lib/ledger/serialize-transaction'
import { handleApiError, createValidationError } from '@/lib/utils/api-error'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { ApplyDishonourFeeSchema } from '@/lib/schemas/ledger'

export async function POST(request: NextRequest) {
  let loanAccountId: string | undefined
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body = await request.json()
    const parseResult = ApplyDishonourFeeSchema.safeParse(body)
    if (!parseResult.success) {
      return createValidationError(parseResult.error.flatten().fieldErrors)
    }
    const data = parseResult.data
    loanAccountId = data.loanAccountId

    const client = getLedgerClient()
    // Prefer the client-supplied key so an operator retry (toast Retry, failed
    // actions replay, timeout-then-retry) hits the ledger's 24h idempotency
    // cache instead of posting the money twice. Absent a key we fall back to a
    // per-request server key — same behaviour as before, for callers that have
    // not been updated yet.
    const idempotencyKey = data.idempotencyKey ?? generateIdempotencyKey('dishonourfee')
    const response = await client.applyDishonourFee({
      loanAccountId: data.loanAccountId,
      feeAmount: data.feeAmount,
      reason: data.reason,
      referenceId: data.referenceId,
      actionedBy: String(user.id),
      idempotencyKey,
    })

    return NextResponse.json({
      success: true,
      transaction: serializeTransaction(response.transaction),
      eventId: response.eventId,
    })
  } catch (error) {
    // Business rule rejections arrive as gRPC code 9 and are mapped to a
    // non-retryable 422 by handleApiError.
    return handleApiError(error, { action: 'apply-dishonour-fee', accountId: loanAccountId })
  }
}
