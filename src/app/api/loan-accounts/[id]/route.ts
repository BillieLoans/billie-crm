/**
 * API Route: GET /api/loan-accounts/[id]
 * 
 * Fetches a loan account by Payload document ID.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error
    const { payload } = auth
    const { id } = await params
    
    const loanAccount = await payload.findByID({
      collection: 'loan-accounts',
      id,
    })

    if (!loanAccount) {
      return NextResponse.json(
        { error: 'Loan account not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(loanAccount)
  } catch (error: any) {
    console.error('Error fetching loan account:', error)
    return NextResponse.json(
      { error: 'Failed to fetch loan account', details: error.message },
      { status: 500 }
    )
  }
}


