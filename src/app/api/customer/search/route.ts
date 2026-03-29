/**
 * API Route: GET /api/customer/search
 *
 * Search customers by name, email, phone, or customer ID.
 * Returns a subset of customer fields for display in command palette.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { CustomerSearchResult, SearchResponse } from '@/types/search'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

// Re-export types for consumers who import from this route
export type { CustomerSearchResult, SearchResponse } from '@/types/search'

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
      collection: 'customers',
      where: {
        or: [
          { fullName: { contains: query } },
          { emailAddress: { contains: query } },
          { mobilePhoneNumber: { contains: query } },
          { customerId: { contains: query } },
        ],
      },
      limit: 10,
    })

    return NextResponse.json({
      results: results.docs.map((customer) => ({
        id: customer.id,
        customerId: customer.customerId,
        fullName: customer.fullName ?? null,
        emailAddress: customer.emailAddress ?? null,
        identityVerified: customer.identityVerified ?? false,
        accountCount: Array.isArray(customer.loanAccounts)
          ? customer.loanAccounts.length
          : 0,
      })),
      total: results.totalDocs,
    })
  } catch (error) {
    console.error('Customer search error:', error)
    return NextResponse.json({ results: [], total: 0 })
  }
}
