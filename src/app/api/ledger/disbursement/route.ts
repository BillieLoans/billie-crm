/**
 * API Route: POST /api/ledger/disbursement
 *
 * Record actual disbursement for a loan account (GAP-07).
 * Called when operator confirms funds have been sent to the customer.
 * Triggers DISBURSEMENT + FEE transactions, accrual, and ECL initialization.
 *
 * Request body:
 * - loanAccountId (required): Loan account ID
 * - disbursementAmount (required): Amount disbursed (string for precision)
 * - bankReference (required): Bank payment reference (e.g., OSKO ref)
 * - paymentMethod (optional): e.g., "bank_transfer", "osko" (defaults to "bank_transfer")
 * - actualDisbursementAt (optional): ISO timestamp of actual disbursement (defaults to now)
 * - plannedDisbursementDate (optional): Commencement date from binding schedule
 * - notes (optional): Operator notes
 * - evidenceUrl (optional): S3 URL of uploaded evidence document
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient, generateIdempotencyKey } from '@/server/grpc-client'
import { createValidationError, handleApiError } from '@/lib/utils/api-error'

interface RecordDisbursementBody {
  loanAccountId: string
  disbursementAmount: string
  bankReference: string
  paymentMethod?: string
  actualDisbursementAt?: string
  plannedDisbursementDate?: string
  notes?: string
  evidenceUrl?: string
}

export async function POST(request: NextRequest) {
  let body: RecordDisbursementBody | undefined
  try {
    body = await request.json()

    if (!body) {
      return NextResponse.json({ error: 'Request body is required' }, { status: 400 })
    }

    // Validation
    if (!body.loanAccountId) {
      return createValidationError('loanAccountId')
    }
    if (!body.disbursementAmount) {
      return createValidationError('disbursementAmount')
    }
    if (!body.bankReference) {
      return createValidationError('bankReference')
    }

    const client = getLedgerClient()
    const idempotencyKey = generateIdempotencyKey('disburse')

    const response = await client.recordDisbursement({
      loanAccountId: body.loanAccountId,
      disbursementAmount: body.disbursementAmount,
      actualDisbursementAt: body.actualDisbursementAt || new Date().toISOString(),
      plannedDisbursementDate: body.plannedDisbursementDate || '',
      bankReference: body.bankReference,
      paymentMethod: body.paymentMethod || 'bank_transfer',
      notes: body.notes || '',
      evidenceUrl: body.evidenceUrl || '',
      idempotencyKey,
    })

    return NextResponse.json({
      success: true,
      message: `Disbursement recorded for account ${body.loanAccountId}`,
      accountId: body.loanAccountId,
      bankReference: body.bankReference,
      actualDisbursementAt: body.actualDisbursementAt || new Date().toISOString(),
      transactionResponse: response,
    })
  } catch (error) {
    return handleApiError(error, {
      action: 'record-disbursement',
      accountId: body?.loanAccountId,
    })
  }
}
