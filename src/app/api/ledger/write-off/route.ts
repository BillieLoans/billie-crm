/**
 * API Route: POST /api/ledger/write-off
 *
 * Write off a loan account balance.
 *
 * Request body:
 * - loanAccountId (required): Loan account ID
 * - reason (required): Reason for write-off
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

interface WriteOffBody {
  loanAccountId: string
  reason: string
  approvedBy?: string
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body: WriteOffBody = await request.json()

    // Validation
    if (!body.loanAccountId) {
      return NextResponse.json({ error: 'loanAccountId is required' }, { status: 400 })
    }
    if (!body.reason) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 })
    }
    const client = getLedgerClient()
    const idempotencyKey = generateIdempotencyKey('writeoff')
    const response = await client.writeOff({
      loanAccountId: body.loanAccountId,
      reason: body.reason,
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
  } catch (error) {
    console.error('Error writing off account:', error)
    return NextResponse.json(
      { error: 'Failed to write off account', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}

