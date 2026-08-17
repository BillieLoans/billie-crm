/**
 * API Route: POST /api/ledger/late-fee
 *
 * Apply a late fee to a loan account.
 *
 * Request body:
 * - loanAccountId (required): Loan account ID
 * - feeAmount (required): Fee amount as string
 * - daysPastDue (required): Number of days past due
 * - reason (optional): Reason for fee
 * - idempotencyKey (optional): Client key (8-128 chars) deduped by the ledger for 24h;
 *   a server-generated key is used when absent
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient, generateIdempotencyKey } from '@/server/grpc-client'
import { serializeTransaction } from '@/lib/ledger/serialize-transaction'
import { handleApiError, createValidationError } from '@/lib/utils/api-error'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { ApplyLateFeeSchema } from '@/lib/schemas/ledger'

export async function POST(request: NextRequest) {
  let loanAccountId: string | undefined
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error

    const body = await request.json()
    const parseResult = ApplyLateFeeSchema.safeParse(body)
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
    const idempotencyKey = data.idempotencyKey ?? generateIdempotencyKey('latefee')
    const response = await client.applyLateFee({
      loanAccountId: data.loanAccountId,
      feeAmount: data.feeAmount,
      daysPastDue: data.daysPastDue,
      reason: data.reason,
      idempotencyKey,
    })

    return NextResponse.json({
      success: true,
      transaction: serializeTransaction(response.transaction),
      eventId: response.eventId,
    })
  } catch (error) {
    // Business rule rejections (e.g. NCC fee cap) arrive as gRPC code 9 and are
    // mapped to a non-retryable 422 by handleApiError.
    return handleApiError(error, { action: 'apply-late-fee', accountId: loanAccountId })
  }
}
