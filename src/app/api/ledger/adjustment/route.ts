/**
 * API Route: POST /api/ledger/adjustment
 *
 * Make a manual adjustment to a loan account.
 *
 * Request body:
 * - loanAccountId (required): Loan account ID
 * - principalDelta (required): Change to principal (can be negative)
 * - feeDelta (required): Change to fees (can be negative)
 * - reason (required): Reason for adjustment
 * - approvedBy (optional): Ignored — derived from authenticated session
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getLedgerClient,
  timestampToDate,
  getTransactionTypeLabel,
  generateIdempotencyKey,
} from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority } from '@/lib/access'
import { MakeAdjustmentSchema } from '@/lib/schemas/ledger'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body = await request.json()
    const parseResult = MakeAdjustmentSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const data = parseResult.data

    const client = getLedgerClient()
    const idempotencyKey = generateIdempotencyKey('adjust')
    const response = await client.makeAdjustment({
      loanAccountId: data.loanAccountId,
      principalDelta: data.principalDelta,
      feeDelta: data.feeDelta,
      reason: data.reason,
      approvedBy: String(user.id),
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
        principalDelta: parseFloat(tx.principalDelta),
        feeDelta: parseFloat(tx.feeDelta),
        totalDelta: parseFloat(tx.totalDelta),
        principalAfter: parseFloat(tx.principalAfter),
        feeAfter: parseFloat(tx.feeAfter),
        totalAfter: parseFloat(tx.totalAfter),
        description: tx.description,
      },
      eventId: response.eventId,
    })
  } catch (error: any) {
    console.error('Error making adjustment:', error)

    if (error.code === 9) {
      return NextResponse.json(
        { error: error.details || 'The ledger rejected this operation due to a business rule.' },
        { status: 422 },
      )
    }

    return NextResponse.json(
      { error: 'Failed to make adjustment', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}

