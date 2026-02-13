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
import { createValidationError, handleApiError } from '@/lib/utils/api-error'

interface DisburseLoanBody {
  loanAccountId: string
  disbursementAmount?: string
  bankReference: string
  paymentMethod?: string
  attachmentLocation: string
  notes?: string
}

export async function POST(request: NextRequest) {
  let body: DisburseLoanBody | undefined
  try {
    body = await request.json()

    if (!body) {
      return NextResponse.json({ error: 'Request body is required' }, { status: 400 })
    }

    // Validation
    if (!body.loanAccountId) {
      return createValidationError('loanAccountId')
    }
    if (!body.bankReference) {
      return createValidationError('bankReference')
    }

    const client = getLedgerClient()
    const idempotencyKey = generateIdempotencyKey('disburse')

    const response = await client.disburseLoan({
      loanAccountId: body.loanAccountId,
      disbursementAmount: body.disbursementAmount || '',
      bankReference: body.bankReference,
      paymentMethod: body.paymentMethod || 'bank_transfer',
      attachmentLocation: body.attachmentLocation || '',
      notes: body.notes || '',
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
          message:
            grpcDetails ||
            'This account has already been disbursed. Please refresh to see the latest status.',
        },
        { status: 409 },
      )
    }

    return handleApiError(error, {
      action: 'disburse-loan',
      accountId: body?.loanAccountId,
    })
  }
}
