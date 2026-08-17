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
 * - idempotencyKey (optional): Client key (8-128 chars) deduped by the ledger for 24h;
 *   a server-generated key is used when absent
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient, generateIdempotencyKey } from '@/server/grpc-client'
import { serializeTransaction } from '@/lib/ledger/serialize-transaction'
import { handleApiError, createValidationError } from '@/lib/utils/api-error'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority } from '@/lib/access'
import { MakeAdjustmentSchema } from '@/lib/schemas/ledger'

export async function POST(request: NextRequest) {
  let loanAccountId: string | undefined
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body = await request.json()
    const parseResult = MakeAdjustmentSchema.safeParse(body)
    if (!parseResult.success) {
      return createValidationError(parseResult.error.flatten().fieldErrors)
    }
    const data = parseResult.data
    loanAccountId = data.loanAccountId

    const client = getLedgerClient()
    // Prefer the client-supplied key so an operator retry (toast Retry, failed
    // actions replay, timeout-then-retry) hits the ledger's 24h idempotency
    // cache instead of posting the money twice. Absent a key we fall back to a
    // per-request server key — same behaviour as before, for callers that have
    // not been updated yet.
    const idempotencyKey = data.idempotencyKey ?? generateIdempotencyKey('adjust')
    const response = await client.makeAdjustment({
      loanAccountId: data.loanAccountId,
      principalDelta: data.principalDelta,
      feeDelta: data.feeDelta,
      reason: data.reason,
      approvedBy: String(user.id),
      idempotencyKey,
    })

    return NextResponse.json({
      success: true,
      transaction: serializeTransaction(response.transaction, {
        includePrincipal: true,
        includeTotalDelta: true,
      }),
      eventId: response.eventId,
    })
  } catch (error) {
    // handleApiError maps the gRPC status codes centrally: 9 (FAILED_PRECONDITION,
    // e.g. NCC fee cap) -> 422, 6 -> 409, 5 -> 404, 14 -> 503, anything else -> 500.
    return handleApiError(error, { action: 'make-adjustment', accountId: loanAccountId })
  }
}
