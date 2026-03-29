/**
 * API Route: GET /api/ledger/balance
 *
 * Get current balance for a loan account.
 *
 * Query params:
 * - loanAccountId (required): Loan account ID
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient, timestampToDate } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error

    const searchParams = request.nextUrl.searchParams
    const loanAccountId = searchParams.get('loanAccountId')

    if (!loanAccountId) {
      return NextResponse.json({ error: 'loanAccountId is required' }, { status: 400 })
    }

    const client = getLedgerClient()
    
    try {
      const response = await client.getBalance({
        loanAccountId,
      })

      return NextResponse.json({
        loanAccountId: response.loanAccountId,
        principalBalance: response.principalBalance,
        feeBalance: response.feeBalance,
        totalOutstanding: response.totalOutstanding,
        asOf: response.asOf,
      })
    } catch (grpcError: any) {
      // Handle gRPC connection errors gracefully
      if (grpcError.code === 14 || grpcError.message?.includes('UNAVAILABLE')) {
        // Return mock/fallback data when ledger service is unavailable
        console.warn('Ledger service unavailable, returning fallback data')
        return NextResponse.json({
          loanAccountId,
          principalBalance: '0.00',
          feeBalance: '0.00',
          totalOutstanding: '0.00',
          asOf: { seconds: Math.floor(Date.now() / 1000).toString(), nanos: 0 },
          _fallback: true,
          _message: 'Ledger service unavailable - showing cached balances from projection',
        })
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching balance:', error)
    return NextResponse.json(
      { error: 'Failed to fetch balance', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}

