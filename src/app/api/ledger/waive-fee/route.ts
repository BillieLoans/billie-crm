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
import { handleApiError } from '@/lib/utils/api-error'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority } from '@/lib/access'
import { WaiveFeeSchema } from '@/lib/schemas/ledger'
import type { z } from 'zod'

export async function POST(request: NextRequest) {
  let data: z.infer<typeof WaiveFeeSchema> | undefined
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body = await request.json()
    const parseResult = WaiveFeeSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    data = parseResult.data

    // Version conflict check (if expectedVersion provided)
    const versionResult = await checkVersion(data.loanAccountId, data.expectedVersion)
    if (!versionResult.isValid) {
      return NextResponse.json(createVersionConflictResponse(versionResult), { status: 409 })
    }

    const client = getLedgerClient()
    const idempotencyKey = generateIdempotencyKey('waive')
    const response = await client.waiveFee({
      loanAccountId: data.loanAccountId,
      waiverAmount: data.waiverAmount,
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
      accountId: data?.loanAccountId,
    })
  }
}

