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
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getLedgerClient,
  timestampToDate,
  getTransactionTypeLabel,
  generateIdempotencyKey,
} from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { ApplyLateFeeSchema } from '@/lib/schemas/ledger'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error

    const body = await request.json()
    const parseResult = ApplyLateFeeSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const data = parseResult.data

    const client = getLedgerClient()
    const idempotencyKey = generateIdempotencyKey('latefee')
    const response = await client.applyLateFee({
      loanAccountId: data.loanAccountId,
      feeAmount: data.feeAmount,
      daysPastDue: data.daysPastDue,
      reason: data.reason,
      idempotencyKey,
    })

    const tx = response.transaction

    return NextResponse.json({
      success: true,
      transaction: {
        id: tx.transactionId,
        accountId: tx.loanAccountId,
        type: tx.type,
        typeLabel: getTransactionTypeLabel(tx.type),
        date: timestampToDate(tx.transactionDate).toISOString(),
        feeDelta: parseFloat(tx.feeDelta),
        feeAfter: parseFloat(tx.feeAfter),
        totalAfter: parseFloat(tx.totalAfter),
        description: tx.description,
      },
      eventId: response.eventId,
    })
  } catch (error) {
    console.error('Error applying late fee:', error)
    return NextResponse.json(
      { error: 'Failed to apply late fee', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}

