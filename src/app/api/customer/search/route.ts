/**
 * API Route: GET /api/customer/search
 *
 * Search customers by name, email, phone, or customer ID.
 * Returns a subset of customer fields for display in command palette.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { CustomerSearchResult } from '@/types/search'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { customerSearchOrClauses } from '@/lib/customer-search'

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
        or: [...customerSearchOrClauses(query, 'contains'), { customerId: { contains: query } }],
      },
      limit: 10,
    })

    // BTB-392: a hit on a former record (an alias an identity link folded
    // into a canonical) points at the canonical, labelled with the record it
    // matched. A canonical hit wins over an alias hit for the same customer.
    const byCustomerId = new Map<string, CustomerSearchResult>()
    for (const customer of results.docs) {
      const isAlias = Boolean(customer.mergedInto) && customer.mergedInto !== customer.customerId
      const targetId = isAlias ? (customer.mergedInto as string) : customer.customerId
      const existing = byCustomerId.get(targetId)
      if (existing && !existing.matchedFormerRecord) continue
      byCustomerId.set(targetId, {
        id: customer.id,
        customerId: targetId,
        fullName: customer.fullName ?? null,
        emailAddress: customer.emailAddress ?? null,
        identityVerified: customer.identityVerified ?? false,
        accountCount: Array.isArray(customer.loanAccounts) ? customer.loanAccounts.length : 0,
        matchedFormerRecord: isAlias ? customer.customerId : null,
      })
    }

    return NextResponse.json({
      results: [...byCustomerId.values()],
      total: results.totalDocs,
    })
  } catch (error) {
    console.error('Customer search error:', error)
    return NextResponse.json({ results: [], total: 0 })
  }
}
