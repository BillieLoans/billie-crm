/**
 * API Route: GET /api/loan-accounts/search
 *
 * Search loan accounts by account number, loan account ID, or customer name.
 * Returns a subset of fields for display in command palette.
 *
 * Authentication: This route is accessed from within the Payload admin UI,
 * which already requires authentication via admin.components.providers.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { LoanAccountSearchResult } from '@/types/search'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get('q')?.trim() || ''

  // Require minimum 3 characters for search
  if (query.length < 3) {
    return NextResponse.json({ results: [], total: 0 })
  }

  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error
    const { payload } = auth

    const results = await payload.find({
      collection: 'loan-accounts',
      where: {
        or: [
          { accountNumber: { contains: query } },
          { loanAccountId: { contains: query } },
          { customerName: { contains: query } },
        ],
      },
      limit: 10,
    })

    return NextResponse.json({
      results: results.docs.map((account) => ({
        id: account.id,
        loanAccountId: account.loanAccountId,
        accountNumber: account.accountNumber,
        customerName: account.customerName ?? null,
        customerIdString: account.customerIdString ?? null,
        accountStatus: account.accountStatus as LoanAccountSearchResult['accountStatus'],
        totalOutstanding: account.balances?.totalOutstanding ?? 0,
      })),
      total: results.totalDocs,
    })
  } catch (error) {
    console.error('Loan account search error:', error)
    return NextResponse.json({ results: [], total: 0 })
  }
}
