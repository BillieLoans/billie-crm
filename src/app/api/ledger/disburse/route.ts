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
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient, generateIdempotencyKey } from '@/server/grpc-client'
import { handleApiError } from '@/lib/utils/api-error'
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
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const data = parseResult.data
    loanAccountId = data.loanAccountId

    const client = getLedgerClient()
    const idempotencyKey = generateIdempotencyKey('disburse')

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
    // Handle duplicate disbursement attempts as a business conflict, not a server error.
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
