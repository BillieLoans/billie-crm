/**
 * API Route: GET /api/ledger/record
 * 
 * Fetches the full ledger record for a loan account.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(canService)
  if ('error' in auth) return auth.error

  const searchParams = request.nextUrl.searchParams
  const loanAccountId = searchParams.get('loanAccountId')

  if (!loanAccountId) {
    return NextResponse.json(
      { error: 'Missing required parameter: loanAccountId' },
      { status: 400 }
    )
  }

  try {
    const client = getLedgerClient()
    const response = await client.getLedgerRecord({ loanAccountId })
    
    return NextResponse.json(response)
  } catch (error: any) {
    console.error('Error fetching ledger record:', error)
    
    if (error.code === 5) { // NOT_FOUND
      return NextResponse.json(
        { error: 'Loan account not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(
      { error: 'Failed to fetch ledger record', details: 'An internal error occurred. Please try again.' },
      { status: 500 }
    )
  }
}


