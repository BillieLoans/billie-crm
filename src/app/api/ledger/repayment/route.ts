/**
 * API Route: POST /api/ledger/repayment
 *
 * Record a repayment on a loan account.
 *
 * Request body:
 * - loanAccountId (required): Loan account ID
 * - amount (required): Payment amount as string (for precision)
 * - paymentId (required): External payment reference
 * - paymentMethod (optional): e.g., "direct_debit", "card"
 * - paymentReference (optional): Additional reference
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
import { canService } from '@/lib/access'
import { RecordRepaymentSchema } from '@/lib/schemas/ledger'
import type { z } from 'zod'

export async function POST(request: NextRequest) {
  let data: z.infer<typeof RecordRepaymentSchema> | undefined
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error

    const body = await request.json()
    const parseResult = RecordRepaymentSchema.safeParse(body)
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
    const idempotencyKey = generateIdempotencyKey('repay')
    const response = await client.recordRepayment({
      loanAccountId: data.loanAccountId,
      amount: data.amount,
      paymentId: data.paymentId,
      paymentMethod: data.paymentMethod,
      paymentReference: data.paymentReference,
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
      allocation: {
        allocatedToFees: response.allocatedToFees ? parseFloat(response.allocatedToFees) : 0,
        allocatedToPrincipal: response.allocatedToPrincipal
          ? parseFloat(response.allocatedToPrincipal)
          : 0,
        overpayment: response.overpayment ? parseFloat(response.overpayment) : 0,
      },
    })
  } catch (error) {
    return handleApiError(error, {
      action: 'record-repayment',
      accountId: data?.loanAccountId,
    })
  }
}

