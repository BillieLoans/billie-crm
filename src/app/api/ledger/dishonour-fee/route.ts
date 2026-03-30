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
import { ApplyDishonourFeeSchema } from '@/lib/schemas/ledger'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error

    const body = await request.json()
    const parseResult = ApplyDishonourFeeSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const data = parseResult.data

    const client = getLedgerClient()
    const idempotencyKey = generateIdempotencyKey('dishonourfee')
    const response = await client.applyDishonourFee({
      loanAccountId: data.loanAccountId,
      feeAmount: data.feeAmount,
      reason: data.reason,
      referenceId: data.referenceId,
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
  } catch (error: any) {
    console.error('Error applying dishonour fee:', error)

    if (error.code === 9) {
      return NextResponse.json(
        { error: error.details || 'The ledger rejected this operation due to a business rule.' },
        { status: 422 },
      )
    }

    return NextResponse.json(
      { error: 'Failed to apply dishonour fee', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
