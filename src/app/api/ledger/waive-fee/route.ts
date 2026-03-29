/**
 * API Route: POST /api/ledger/waive-fee
 *
 * Waive fees on a loan account.
 *
 * Request body:
 * - loanAccountId (required): Loan account ID
 * - waiverAmount (required): Amount to waive as string
 * - reason (required): Reason for waiver
 * - approvedBy (optional): Ignored — derived from authenticated session
 * - expectedVersion (optional): Expected updatedAt for version conflict detection
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getLedgerClient,
  timestampToDate,
  getTransactionTypeLabel,
  generateIdempotencyKey,
} from '@/server/grpc-client'
import { checkVersion, createVersionConflictResponse } from '@/lib/utils/version-check'
import { createValidationError, handleApiError } from '@/lib/utils/api-error'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority } from '@/lib/access'

interface WaiveFeeBody {
  loanAccountId: string
  waiverAmount: string
  reason: string
  approvedBy?: string
  expectedVersion?: string
}

export async function POST(request: NextRequest) {
  let body: WaiveFeeBody | undefined
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user } = auth

    body = await request.json()

    // Ensure body is defined
    if (!body) {
      return NextResponse.json({ error: 'Request body is required' }, { status: 400 })
    }

    // Validation
    if (!body.loanAccountId) {
      return createValidationError('loanAccountId')
    }
    if (!body.waiverAmount) {
      return createValidationError('waiverAmount')
    }
    if (!body.reason) {
      return createValidationError('reason')
    }
    // Version conflict check (if expectedVersion provided)
    const versionResult = await checkVersion(body.loanAccountId, body.expectedVersion)
    if (!versionResult.isValid) {
      return NextResponse.json(createVersionConflictResponse(versionResult), { status: 409 })
    }

    const client = getLedgerClient()
    const idempotencyKey = generateIdempotencyKey('waive')
    const response = await client.waiveFee({
      loanAccountId: body.loanAccountId,
      waiverAmount: body.waiverAmount,
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
        feeDelta: parseFloat(tx.feeDelta),
        feeAfter: parseFloat(tx.feeAfter),
        totalAfter: parseFloat(tx.totalAfter),
        description: tx.description,
      },
      eventId: response.eventId,
    })
  } catch (error) {
    return handleApiError(error, {
      action: 'waive-fee',
      accountId: body?.loanAccountId,
    })
  }
}

