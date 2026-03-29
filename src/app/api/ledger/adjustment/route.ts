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
 * - approvedBy (required): Approver ID
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

interface MakeAdjustmentBody {
  loanAccountId: string
  principalDelta: string
  feeDelta: string
  reason: string
  approvedBy: string
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error

    const body: MakeAdjustmentBody = await request.json()

    // Validation
    if (!body.loanAccountId) {
      return NextResponse.json({ error: 'loanAccountId is required' }, { status: 400 })
    }
    if (body.principalDelta === undefined) {
      return NextResponse.json({ error: 'principalDelta is required' }, { status: 400 })
    }
    if (body.feeDelta === undefined) {
      return NextResponse.json({ error: 'feeDelta is required' }, { status: 400 })
    }
    if (!body.reason) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 })
    }
    if (!body.approvedBy) {
      return NextResponse.json({ error: 'approvedBy is required' }, { status: 400 })
    }

    const client = getLedgerClient()
    const idempotencyKey = generateIdempotencyKey('adjust')
    const response = await client.makeAdjustment({
      loanAccountId: body.loanAccountId,
      principalDelta: body.principalDelta,
      feeDelta: body.feeDelta,
      reason: body.reason,
      approvedBy: body.approvedBy,
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
  } catch (error) {
    console.error('Error making adjustment:', error)
    return NextResponse.json(
      { error: 'Failed to make adjustment', details: (error as Error).message },
      { status: 500 },
    )
  }
}

