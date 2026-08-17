/**
 * API Route: POST /api/ledger/disburse
 *
 * Disburse funds for a loan account, transitioning it from
 * PENDING_DISBURSEMENT to ACTIVE.
 *
 * Records DISBURSEMENT + ESTABLISHMENT_FEE transactions and publishes
 * account.disbursed.v1 event.
 *
 * Request body:
 * - loanAccountId (required): Loan account ID
 * - disbursementAmount (optional): Override amount (decimal string)
 * - bankReference (required): Bank payment reference
 * - paymentMethod (optional): Defaults to "bank_transfer"
 * - attachmentLocation (required): S3 URI for proof of payment
 * - notes (optional): Free-text notes
 * - idempotencyKey (optional): Client key (8-128 chars) deduped by the ledger for 24h;
 *   a server-generated key is used when absent
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient, generateIdempotencyKey } from '@/server/grpc-client'
import { handleApiError, createValidationError } from '@/lib/utils/api-error'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { DisburseLoanSchema } from '@/lib/schemas/ledger'

export async function POST(request: NextRequest) {
  let loanAccountId: string | undefined
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error

    const body = await request.json()
    const parseResult = DisburseLoanSchema.safeParse(body)
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
    const idempotencyKey = data.idempotencyKey ?? generateIdempotencyKey('disburse')

    const response = await client.disburseLoan({
      loanAccountId: data.loanAccountId,
      disbursementAmount: data.disbursementAmount || '',
      bankReference: data.bankReference,
      paymentMethod: data.paymentMethod || 'bank_transfer',
      attachmentLocation: data.attachmentLocation || '',
      notes: data.notes || '',
      idempotencyKey,
    })

    return NextResponse.json({
      success: response.success,
      message: response.message,
      disbursementTransactionId: response.disbursementTransactionId,
      feeTransactionId: response.feeTransactionId,
      eventId: response.eventId,
      idempotentReplay: response.idempotentReplay,
    })
  } catch (error) {
    // Bespoke branch: a duplicate disbursement keeps its own ALREADY_DISBURSED body and
    // operator-facing wording, so it stays ahead of the generic mapping. Everything else
    // (gRPC 9 -> 422, 5 -> 404, 14 -> 503) is handled centrally by handleApiError.
    const grpcCode = (error as { code?: number } | undefined)?.code
    const grpcDetails = (error as { details?: string } | undefined)?.details
    const grpcMessage = error instanceof Error ? error.message : String(error)
    const detailsText = (grpcDetails || grpcMessage || '').toLowerCase()

    if (grpcCode === 6 || detailsText.includes('already been disbursed')) {
      return NextResponse.json(
        {
          error: 'ALREADY_DISBURSED',
          message: 'This account has already been disbursed. Please check the account status.',
        },
        { status: 409 },
      )
    }

    return handleApiError(error, {
      action: 'disburse-loan',
      accountId: loanAccountId,
    })
  }
}
