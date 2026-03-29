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
import { WriteOffLedgerSchema } from '@/lib/schemas/ledger'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body = await request.json()
    const parseResult = WriteOffLedgerSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const data = parseResult.data

    const client = getLedgerClient()
    const idempotencyKey = generateIdempotencyKey('writeoff')
    const response = await client.writeOff({
      loanAccountId: data.loanAccountId,
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
  } catch (error) {
    console.error('Error writing off account:', error)
    return NextResponse.json(
      { error: 'Failed to write off account', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}

