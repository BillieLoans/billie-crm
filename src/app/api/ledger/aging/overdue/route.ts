/**
 * API Route: GET /api/ledger/aging/overdue
 *
 * Get paginated list of overdue accounts with filtering.
 *
 * Query params:
 * - bucket: Filter by aging bucket (e.g., "current", "early_arrears", "late_arrears", "default")
 * - minDpd: Minimum days past due (default: 1)
 * - maxDpd: Maximum days past due
 * - pageSize: Results per page (default: 100, max: 1000)
 * - pageToken: Pagination token for next page
 */

import { NextRequest, NextResponse } from 'next/server'
import { getOverdueSnapshotPage, OVERDUE_PAGE_SIZE_MAX } from '@/server/overdue-snapshot-cache'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import {
  enrichOverdueAccounts,
  indexLoanAccountsById,
  normaliseOverdueAccount,
} from '@/lib/aging/overdue-enrichment'
import type { LoanAccountLike } from '@/lib/aging/overdue-enrichment'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error

    const searchParams = request.nextUrl.searchParams
    const bucket = searchParams.get('bucket') || undefined
    const rawMinDpd = searchParams.get('minDpd')
    const minDpd = rawMinDpd ? parseInt(rawMinDpd, 10) : undefined
    const rawMaxDpd = searchParams.get('maxDpd')
    const maxDpd = rawMaxDpd ? parseInt(rawMaxDpd, 10) : undefined
    const pageSize = parseInt(searchParams.get('pageSize') || '100', 10)
    const pageToken = searchParams.get('pageToken') || undefined

    if (
      (minDpd !== undefined && !Number.isFinite(minDpd)) ||
      (maxDpd !== undefined && !Number.isFinite(maxDpd)) ||
      !Number.isFinite(pageSize)
    ) {
      return NextResponse.json(
        { error: 'Invalid numeric parameter (minDpd, maxDpd, or pageSize)' },
        { status: 400 },
      )
    }

    try {
      // Shared short-TTL cache: every 30s dashboard poller collapses onto one
      // upstream gRPC fetch per filter/page combination.
      const response = await getOverdueSnapshotPage({
        bucketFilter: bucket,
        minDpd,
        maxDpd,
        pageSize: Math.min(pageSize, OVERDUE_PAGE_SIZE_MAX),
        pageToken,
      })

      // Transform gRPC response to ensure field mapping is correct
      // Handle both camelCase (from proto loader with keepCase: false) and snake_case
      const transformedAccounts = response.accounts.map(normaliseOverdueAccount)

      // Enrich accounts with loan account details from Payload.
      // One batched query for the whole page (previously one query per account).
      const payload = await getPayload({ config: configPromise })
      const accountIds = transformedAccounts.map((a) => a.accountId).filter(Boolean)

      let loanAccountsById = new Map<string, LoanAccountLike>()
      if (accountIds.length > 0) {
        try {
          const loanAccountResult = await payload.find({
            collection: 'loan-accounts',
            where: { loanAccountId: { in: accountIds } },
            limit: accountIds.length,
            depth: 0,
          })
          loanAccountsById = indexLoanAccountsById(loanAccountResult.docs as any[])
        } catch (error) {
          // Enrichment is best-effort — fall back to null-filled rows.
          console.warn('Failed to enrich overdue accounts with loan-account details:', error)
        }
      }

      const enrichedAccounts = enrichOverdueAccounts(transformedAccounts, loanAccountsById)

      return NextResponse.json({
        accounts: enrichedAccounts,
        totalCount: response.totalCount ?? enrichedAccounts.length,
        nextPageToken: response.nextPageToken,
      })
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      if (error.code === 14 || error.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable for overdue accounts')
        return NextResponse.json(
          {
            accounts: [],
            totalCount: 0,
            _fallback: true,
            _message: 'Ledger service unavailable',
          },
          { status: 200 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching overdue accounts:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch overdue accounts',
        details: 'An internal error occurred. Please try again.',
      },
      { status: 500 },
    )
  }
}
