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

interface ApplyDishonourFeeBody {
  loanAccountId: string
  feeAmount: string
  reason?: string
  referenceId?: string
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error

    const body: ApplyDishonourFeeBody = await request.json()

    if (!body.loanAccountId) {
      return NextResponse.json({ error: 'loanAccountId is required' }, { status: 400 })
    }
    if (!body.feeAmount) {
      return NextResponse.json({ error: 'feeAmount is required' }, { status: 400 })
    }

    const client = getLedgerClient()
    const idempotencyKey = generateIdempotencyKey('dishonourfee')
    const response = await client.applyDishonourFee({
      loanAccountId: body.loanAccountId,
      feeAmount: body.feeAmount,
      reason: body.reason,
      referenceId: body.referenceId,
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
    console.error('Error applying dishonour fee:', error)
    return NextResponse.json(
      { error: 'Failed to apply dishonour fee', details: (error as Error).message },
      { status: 500 },
    )
  }
}
