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
 * - idempotencyKey (optional): Client key (8-128 chars) deduped by the ledger for 24h;
 *   a server-generated key is used when absent
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient, generateIdempotencyKey } from '@/server/grpc-client'
import { serializeTransaction } from '@/lib/ledger/serialize-transaction'
import { checkVersion, createVersionConflictResponse } from '@/lib/utils/version-check'
import { handleApiError, createValidationError } from '@/lib/utils/api-error'
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
    const idempotencyKey = data.idempotencyKey ?? generateIdempotencyKey('waive')
    const response = await client.waiveFee({
      loanAccountId: data.loanAccountId,
      waiverAmount: data.waiverAmount,
      reason: data.reason,
      approvedBy: String(user.id),
      idempotencyKey,
    })

    return NextResponse.json({
      success: true,
      // includePrincipal: a retroactive waiver (fee already settled by a
      // repayment) posts with feeDelta = 0 and the waived amount as a
      // principalDelta, so fee fields alone would report a $0.00 waiver.
      transaction: serializeTransaction(response.transaction, {
        includePrincipal: true,
        includeTotalDelta: true,
      }),
      eventId: response.eventId,
    })
  } catch (error) {
    return handleApiError(error, {
      action: 'waive-fee',
      accountId: data?.loanAccountId,
    })
  }
}
