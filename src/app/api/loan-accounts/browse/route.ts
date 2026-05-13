/**
 * API Route: GET /api/loan-accounts/browse
 *
 * Faceted list endpoint for the Browse Accounts page. Accepts the filter
 * params defined in src/lib/account-filters.ts, applies Smart View defaults,
 * resolves customer-status joins, and returns Payload's standard paginated
 * list shape so the React Query hook can reuse the existing pattern from
 * usePendingApprovals.
 *
 * Authentication: any signed-in role (hasAnyRole). LoanAccounts.access.read
 * is the source of truth; this route just enforces the same gate at the edge
 * so the response 401s cleanly without throwing a Payload internal error.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import {
  buildPayloadWhere,
  DEFAULT_SORT,
  filtersSchema,
  queryStringToFilters,
} from '@/lib/account-filters'
import { applySmartViewDefaults } from '@/lib/smart-views'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  const { payload } = auth

  // 1. Parse and validate URL params.
  let filters
  try {
    filters = queryStringToFilters(request.nextUrl.searchParams)
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_FILTERS',
          message: 'One or more filter values are invalid.',
          details: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 400 },
    )
  }

  // 2. Apply the Smart View's defaults (explicit URL params win).
  const merged = applySmartViewDefaults(filters)
  // Re-validate after merge — Smart Views are trusted code, but this catches
  // drift if someone adds a malformed default.
  const validated = filtersSchema.parse(merged)

  // 3. Customer-status join: pre-fetch customer IDs the LoanAccount query can
  //    then filter on via `customerIdString in [...]`. Capped at a generous
  //    limit; deceased/missing populations are small in practice.
  let customerIdIn: string[] | null = null
  if (validated.customerStatus) {
    const customers = await payload.find({
      collection: 'customers',
      where: { individualStatus: { equals: validated.customerStatus } },
      limit: 5000,
      pagination: false,
    })
    customerIdIn = customers.docs
      .map((c) => c.customerId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    // No matching customers → no accounts. Short-circuit with the canonical
    // Payload-list shape so the hook stays generic.
    if (customerIdIn.length === 0) {
      return NextResponse.json({
        docs: [],
        totalDocs: 0,
        limit: validated.limit,
        page: 1,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      })
    }
  }

  // 4. Compose the where clause and execute.
  const where = buildPayloadWhere(validated, customerIdIn)

  const results = await payload.find({
    collection: 'loan-accounts',
    where,
    page: validated.page,
    limit: validated.limit,
    sort: validated.sort ?? DEFAULT_SORT,
  })

  return NextResponse.json(results)
}
