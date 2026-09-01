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
 * - notes (optional): Operator notes (max 1000 chars)
 * - expectedVersion (optional): Expected updatedAt for version conflict detection
 * - idempotencyKey (optional): Client key (8-128 chars) deduped by the ledger for 24h;
 *   a server-generated key is used when absent
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient, generateIdempotencyKey } from '@/server/grpc-client'
import { serializeTransaction } from '@/lib/ledger/serialize-transaction'
import { checkVersion, createVersionConflictResponse } from '@/lib/utils/version-check'
import { handleApiError, createValidationError } from '@/lib/utils/api-error'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { RecordRepaymentSchema } from '@/lib/schemas/ledger'
import type { z } from 'zod'

export async function POST(request: NextRequest) {
  let data: z.infer<typeof RecordRepaymentSchema> | undefined
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body = await request.json()
    const parseResult = RecordRepaymentSchema.safeParse(body)
    if (!parseResult.success) {
      return createValidationError(parseResult.error.flatten().fieldErrors)
    }
    data = parseResult.data

    // Version conflict check (if expectedVersion provided)
    const versionResult = await checkVersion(data.loanAccountId, data.expectedVersion)
    if (!versionResult.isValid) {
      return NextResponse.json(createVersionConflictResponse(versionResult), { status: 409 })
    }

    const client = getLedgerClient()
    // Prefer the client-supplied key so an operator retry (toast Retry, failed
    // actions replay, timeout-then-retry) hits the ledger's 24h idempotency
    // cache instead of posting the money twice. Absent a key we fall back to a
    // per-request server key — same behaviour as before, for callers that have
    // not been updated yet.
    const idempotencyKey = data.idempotencyKey ?? generateIdempotencyKey('repay')
    const response = await client.recordRepayment({
      loanAccountId: data.loanAccountId,
      amount: data.amount,
      paymentId: data.paymentId,
      paymentMethod: data.paymentMethod,
      paymentReference: data.paymentReference,
      notes: data.notes,
      // Always the session user — never a body-supplied value.
      actionedBy: String(user.id),
      idempotencyKey,
    })

    return NextResponse.json({
      success: true,
      transaction: serializeTransaction(response.transaction, {
        includePrincipal: true,
        includeTotalDelta: true,
      }),
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
