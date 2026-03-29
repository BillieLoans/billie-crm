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
import { getLedgerClient } from '@/server/grpc-client'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error

    const searchParams = request.nextUrl.searchParams
    const bucket = searchParams.get('bucket') || undefined
    const minDpd = searchParams.get('minDpd') ? parseInt(searchParams.get('minDpd')!, 10) : undefined
    const maxDpd = searchParams.get('maxDpd') ? parseInt(searchParams.get('maxDpd')!, 10) : undefined
    const pageSize = parseInt(searchParams.get('pageSize') || '100', 10)
    const pageToken = searchParams.get('pageToken') || undefined

    const client = getLedgerClient()

    try {
      const response = await client.getOverdueAccounts({
        bucketFilter: bucket,
        minDpd,
        maxDpd,
        pageSize: Math.min(pageSize, 1000),
        pageToken,
      })

      // Transform gRPC response to ensure field mapping is correct
      // Handle both camelCase (from proto loader with keepCase: false) and snake_case
      const transformedAccounts = response.accounts.map((account: any) => {
        // Extract fields handling both naming conventions
        const accountId = account.accountId ?? account.account_id ?? ''
        const dpd = account.dpd ?? 0
        const bucketValue = account.bucket ?? 'current'
        const daysUntilOverdue = account.daysUntilOverdue ?? account.days_until_overdue ?? 0
        const totalOverdueAmount = account.totalOverdueAmount ?? account.total_overdue_amount ?? '0'
        const lastUpdated = account.lastUpdated ?? account.last_updated ?? new Date().toISOString()

        // Debug logging for first account to diagnose field mapping issues
        if (accountId && (totalOverdueAmount === '0' || totalOverdueAmount === '')) {
          console.log(`[Overdue Accounts] Account ${accountId} has zero/empty totalOverdueAmount. Raw fields:`, {
            accountId,
            totalOverdueAmount,
            'account.totalOverdueAmount': account.totalOverdueAmount,
            'account.total_overdue_amount': account.total_overdue_amount,
            'account keys': Object.keys(account),
            dpd,
            bucket: bucketValue,
          })
        }

        return {
          accountId,
          dpd,
          bucket: bucketValue,
          daysUntilOverdue,
          totalOverdueAmount,
          lastUpdated,
        }
      })

      // Enrich accounts with loan account details from Payload
      const payload = await getPayload({ config: configPromise })
      const enrichedAccounts = await Promise.all(
        transformedAccounts.map(async (account) => {
          try {
            // Look up loan account by loanAccountId (which matches accountId from gRPC)
            const loanAccountResult = await payload.find({
              collection: 'loan-accounts',
              where: {
                loanAccountId: { equals: account.accountId },
              },
              limit: 1,
            })

            if (loanAccountResult.docs.length > 0) {
              const loanAccount = loanAccountResult.docs[0]
              return {
                ...account,
                accountNumber: loanAccount.accountNumber,
                customerIdString: loanAccount.customerIdString ?? null,
                customerName: loanAccount.customerName ?? null,
              }
            }

            // If not found, return account with nulls
            return {
              ...account,
              accountNumber: null,
              customerIdString: null,
              customerName: null,
            }
          } catch (error) {
            console.warn(`Failed to enrich account ${account.accountId}:`, error)
            return {
              ...account,
              accountNumber: null,
              customerIdString: null,
              customerName: null,
            }
          }
        })
      )

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
      { error: 'Failed to fetch overdue accounts', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
