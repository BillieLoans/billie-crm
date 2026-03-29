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

interface ApplyLateFeeBody {
  loanAccountId: string
  feeAmount: string
  daysPastDue: number
  reason?: string
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error

    const body: ApplyLateFeeBody = await request.json()

    // Validation
    if (!body.loanAccountId) {
      return NextResponse.json({ error: 'loanAccountId is required' }, { status: 400 })
    }
    if (!body.feeAmount) {
      return NextResponse.json({ error: 'feeAmount is required' }, { status: 400 })
    }
    if (body.daysPastDue === undefined || body.daysPastDue < 0) {
      return NextResponse.json({ error: 'daysPastDue is required and must be >= 0' }, { status: 400 })
    }

    const client = getLedgerClient()
    const idempotencyKey = generateIdempotencyKey('latefee')
    const response = await client.applyLateFee({
      loanAccountId: body.loanAccountId,
      feeAmount: body.feeAmount,
      daysPastDue: body.daysPastDue,
      reason: body.reason,
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
      { error: 'Failed to apply late fee', details: (error as Error).message },
      { status: 500 },
    )
  }
}

