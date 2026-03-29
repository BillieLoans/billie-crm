/**
 * API Route: GET /api/investigation/trace/accrual/[accountId]
 *
 * Trace accrued yield calculation back to source events.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error

    const { accountId } = await params

    if (!accountId) {
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
    }

    const client = getLedgerClient()

    try {
      const response = await client.traceAccruedYieldToSource({
        accountIds: [accountId],
      })

      // Return just the first result for single account query
      const result = response.results?.[0]
      if (!result) {
        return NextResponse.json({ error: 'No trace result found' }, { status: 404 })
      }

      return NextResponse.json(result)
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      if (error.code === 14 || error.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable for accrual trace')
        return NextResponse.json(
          { error: 'Ledger service unavailable', _fallback: true },
          { status: 503 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error tracing accrual:', error)
    return NextResponse.json(
      { error: 'Failed to trace accrual', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
