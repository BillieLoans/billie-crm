/**
 * API Route: POST /api/ledger/write-off
 *
 * Write off a loan account balance (GAP-14: Write-off criteria and approvals).
 *
 * Write-off Policy (per AASB 9 §6, Compliance Register C6):
 * - Account must be credit-impaired (DPD >= 62, "default" aging bucket)
 *   OR have an explicit exception approved by a supervisor
 * - Recovery attempts must be documented (at least one attempt required)
 * - Approver must be a supervisor (not the same person requesting)
 * - Reason must include one of the defined categories
 *
 * Request body:
 * - loanAccountId (required): Loan account ID
 * - reason (required): Reason for write-off
 * - writeOffCategory (required): One of 'credit_impaired_no_recovery_prospect',
 *     'customer_hardship', 'fraud', 'deceased', 'other_supervisor_approved'
 * - approvedBy (required): Approver ID (must be supervisor)
 * - recoveryAttemptsDocumented (required): Boolean confirming recovery attempts
 * - recoveryNotes (optional): Description of recovery attempts made
 * - supervisorOverride (optional): If true, allows write-off before DPD >= 62
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getLedgerClient,
  timestampToDate,
  getTransactionTypeLabel,
  generateIdempotencyKey,
} from '@/server/grpc-client'

// GAP-14: Valid write-off categories per compliance register C6
const VALID_WRITEOFF_CATEGORIES = [
  'credit_impaired_no_recovery_prospect',
  'customer_hardship',
  'fraud',
  'deceased',
  'other_supervisor_approved',
] as const

interface WriteOffBody {
  loanAccountId: string
  reason: string
  writeOffCategory?: string
  approvedBy: string
  recoveryAttemptsDocumented?: boolean
  recoveryNotes?: string
  supervisorOverride?: boolean
}

export async function POST(request: NextRequest) {
  try {
    const body: WriteOffBody = await request.json()

    // Validation
    if (!body.loanAccountId) {
      return NextResponse.json({ error: 'loanAccountId is required' }, { status: 400 })
    }
    if (!body.reason) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 })
    }
    if (!body.approvedBy) {
      return NextResponse.json({ error: 'approvedBy is required' }, { status: 400 })
    }

    // GAP-14: Validate write-off category
    if (body.writeOffCategory && !VALID_WRITEOFF_CATEGORIES.includes(body.writeOffCategory as any)) {
      return NextResponse.json(
        {
          error: `Invalid writeOffCategory. Must be one of: ${VALID_WRITEOFF_CATEGORIES.join(', ')}`,
        },
        { status: 400 },
      )
    }

    // GAP-14: Recovery documentation check
    if (!body.recoveryAttemptsDocumented) {
      return NextResponse.json(
        {
          error:
            'recoveryAttemptsDocumented must be true. Write-off policy requires documentation of recovery attempts before write-off (Compliance Register C6).',
        },
        { status: 400 },
      )
    }

    const client = getLedgerClient()
    const idempotencyKey = generateIdempotencyKey('writeoff')
    const response = await client.writeOff({
      loanAccountId: body.loanAccountId,
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
    console.error('Error writing off account:', error)
    return NextResponse.json(
      { error: 'Failed to write off account', details: (error as Error).message },
      { status: 500 },
    )
  }
}

