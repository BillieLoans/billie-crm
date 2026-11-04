/**
 * API Route: GET /api/ledger/disbursable
 *
 * Ask the platform, the system of record, whether DisburseLoan would accept a
 * loan right now (BTB-517). The Pending Disbursements payment panel calls this
 * before it shows any payout details, because the CRM is a projection and can
 * show a stale status (a replayed account.updated can put a cancelled loan back
 * in the queue). The CRM holds no rule of its own: this route relays the
 * platform's verdict and nothing else.
 *
 * Query params:
 * - loanAccountId (required)
 *
 * 200 `{ disbursable, reason, status, message }`, never cached.
 *
 * Any gRPC failure (UNAVAILABLE, UNIMPLEMENTED from an older platform, a
 * blown deadline, anything else) is 503 DISBURSABLE_CHECK_FAILED with fixed
 * text. The panel fails closed on it, so the message carries no gRPC detail:
 * there is nothing an operator could do with it, and internal text should not
 * reach the browser.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  const auth = await requireAuth(canService)
  if ('error' in auth) return auth.error

  const loanAccountId = request.nextUrl.searchParams.get('loanAccountId')
  if (!loanAccountId) {
    return NextResponse.json(
      { error: 'loanAccountId is required' },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    const response = await getLedgerClient().checkDisbursable({ loanAccountId })
    return NextResponse.json(
      {
        disbursable: response.disbursable === true,
        reason: response.reason,
        status: response.status,
        message: response.message,
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    // Logged server-side for diagnosis; only the code reaches the client.
    console.error('[disbursable] platform check failed', {
      loanAccountId,
      grpcCode: (error as { code?: unknown } | undefined)?.code,
      error,
    })
    return NextResponse.json(
      {
        error: 'DISBURSABLE_CHECK_FAILED',
        message: "Couldn't confirm with the platform that this loan can be paid.",
      },
      { status: 503, headers: NO_STORE },
    )
  }
}
