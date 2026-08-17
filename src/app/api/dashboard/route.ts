/**
 * API Route: GET /api/dashboard
 *
 * Dashboard data aggregation endpoint.
 * Returns user context, action items, recent customers summary, and system status.
 *
 * Story 6.2: Dashboard Home Page
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority, hasAnyRole } from '@/lib/access'
import {
  DashboardResponseSchema,
  DashboardQuerySchema,
  type DashboardResponse,
  type RecentAccount,
  type UpcomingPayment,
  type PendingDisbursement,
} from '@/lib/schemas/dashboard'
import {
  sydneyDateString,
  nextSydneyDateString,
  classifyBucket,
  getCommencementDate,
  summariseDisbursementBuckets,
} from '@/lib/disbursement-cutoff'
import {
  getDashboardPool,
  fetchMoneyFlowsToday,
  fetchUpcomingPayments,
  fetchDisbursementBucketTotals,
  buildMetric,
} from '@/lib/dashboard-aggregates'
import { checkLedgerHealth } from '@/server/ledger-health'

/** Valid user roles */
const VALID_ROLES = ['admin', 'supervisor', 'operations', 'readonly'] as const
type UserRole = (typeof VALID_ROLES)[number]

/** Type guard to validate user role */
function isValidRole(role: unknown): role is UserRole {
  return typeof role === 'string' && VALID_ROLES.includes(role as UserRole)
}

/**
 * Format a number as Australian currency.
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(amount)
}

/**
 * Ledger health for the dashboard tile.
 *
 * Probes the ledger in-process. The previous implementation looped back over
 * HTTP to /api/ledger/health, which is auth-guarded — a server-to-server fetch
 * carries no session cookie, so it always 401'd and the tile read "offline"
 * regardless of the real ledger state.
 */
async function fetchLedgerHealth(): Promise<{
  status: 'online' | 'degraded' | 'offline'
  latencyMs: number
}> {
  try {
    const health = await checkLedgerHealth()
    return {
      status:
        health.status === 'connected'
          ? 'online'
          : health.status === 'degraded'
            ? 'degraded'
            : 'offline',
      latencyMs: Math.max(0, Math.round(health.latencyMs ?? 0)),
    }
  } catch {
    return { status: 'offline', latencyMs: 0 }
  }
}

export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate user and verify lending role (excludes marketing)
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    // 2. Parse and validate query params
    const searchParams = Object.fromEntries(request.nextUrl.searchParams)
    const { recentCustomerIds } = DashboardQuerySchema.parse(searchParams)

    // 3. Determine if user can see approvals count
    const canSeeApprovals = hasApprovalAuthority(user)

    // 4. Fix a single "now" so every Sydney day window in this response agrees,
    //    and grab the pg pool for the whole-table aggregates.
    const now = new Date()
    const todaySydney = sydneyDateString(now)
    const tomorrowSydney = nextSydneyDateString(now)
    const pool = getDashboardPool(payload)

    // 5. Parallel fetch all data
    const [
      approvalsResult,
      ledgerHealth,
      customersResult,
      recentAccountsResult,
      upcomingPaymentsAll,
      pendingDisbursementResult,
      moneyFlowsToday,
    ] = await Promise.all([
      // Only query approvals if user has permission
      canSeeApprovals
        ? payload.find({
            collection: 'write-off-requests',
            where: { status: { equals: 'pending' } },
            limit: 0, // Count only
          })
        : Promise.resolve({ totalDocs: 0 }),

      // Check ledger health (in-process gRPC probe)
      fetchLedgerHealth(),

      // Fetch recent customers if IDs provided
      recentCustomerIds.length > 0
        ? payload.find({
            collection: 'customers',
            where: { customerId: { in: recentCustomerIds } },
            limit: 10,
          })
        : Promise.resolve({ docs: [] }),

      // Recently created accounts (for onboarding visibility)
      payload.find({
        collection: 'loan-accounts',
        sort: '-createdAt',
        limit: 10,
      }),

      // Most urgent scheduled payments across ALL active accounts (SQL aggregate)
      fetchUpcomingPayments(pool, todaySydney),

      // Loans pending disbursement (list preview only — counts/totals come from SQL)
      payload.find({
        collection: 'loan-accounts',
        where: {
          accountStatus: { equals: 'pending_disbursement' },
        },
        sort: '-createdAt',
        limit: 200,
      }),

      // Today's money flows (expected / received / disbursed)
      fetchMoneyFlowsToday(pool, now),
    ])

    // 6. Get loan account data for all customers in a single batch query
    const allCustomerIds = customersResult.docs.map((c) => c.customerId).filter(Boolean)
    const accountsForCustomersResult =
      allCustomerIds.length > 0
        ? await payload.find({
            collection: 'loan-accounts',
            where: { customerIdString: { in: allCustomerIds } },
            limit: 500, // Reasonable upper bound
          })
        : null

    // Group accounts by customer ID for efficient lookup
    type LoanAccountDoc = NonNullable<typeof accountsForCustomersResult>['docs'][number]
    const accountsByCustomer = new Map<string, LoanAccountDoc[]>()
    if (accountsForCustomersResult) {
      for (const account of accountsForCustomersResult.docs) {
        const custId = account.customerIdString ?? ''
        if (!accountsByCustomer.has(custId)) {
          accountsByCustomer.set(custId, [])
        }
        accountsByCustomer.get(custId)!.push(account)
      }
    }

    // Build customer summaries
    const customersWithAccounts = customersResult.docs.map((customer) => {
      const accounts = accountsByCustomer.get(customer.customerId ?? '') ?? []
      const totalOutstanding = accounts.reduce((sum, acc) => {
        return sum + (acc.balances?.totalOutstanding ?? 0)
      }, 0)

      return {
        customerId: customer.customerId ?? '',
        name: customer.fullName ?? 'Unknown',
        accountCount: accounts.length,
        totalOutstanding: formatCurrency(totalOutstanding),
      }
    })

    // Process recently created accounts
    const recentAccounts: RecentAccount[] = recentAccountsResult.docs.map((acc) => ({
      loanAccountId: acc.loanAccountId ?? '',
      accountNumber: acc.accountNumber ?? '',
      customerName: acc.customerName ?? 'Unknown',
      customerId: acc.customerIdString ?? '',
      loanAmount: acc.loanTerms?.loanAmount ?? 0,
      loanAmountFormatted: formatCurrency(acc.loanTerms?.loanAmount ?? 0),
      createdAt: acc.createdAt,
    }))

    // Upcoming payments: already sorted by due date and capped at 10 in SQL,
    // across every active account (not a 100-account page).
    const topUpcomingPayments: UpcomingPayment[] = upcomingPaymentsAll

    // Pending disbursement list preview, with per-row bucket classification
    const pendingDisbursements: PendingDisbursement[] = pendingDisbursementResult.docs.map(
      (acc) => {
        const commencementDate = getCommencementDate(acc)
        // No commencement date yet → surface in today's queue for ops attention rather than hiding it.
        const bucket = commencementDate ? classifyBucket(commencementDate, now) : 'today'
        return {
          loanAccountId: acc.loanAccountId ?? '',
          accountNumber: acc.accountNumber ?? '',
          customerName: acc.customerName ?? 'Unknown',
          customerId: acc.customerIdString ?? '',
          loanAmount: acc.loanTerms?.loanAmount ?? 0,
          loanAmountFormatted: formatCurrency(acc.loanTerms?.loanAmount ?? 0),
          createdAt: acc.createdAt,
          commencementDate,
          bucket,
          signedLoanAgreementUrl: acc.signedLoanAgreementUrl ?? undefined,
        }
      },
    )

    // Bucket counts/totals over EVERY pending loan (SQL), not just the page above.
    // Without a pg pool (non-Postgres adapter) fall back to the in-memory summary.
    const rawBuckets = pool
      ? await fetchDisbursementBucketTotals(
          pool,
          todaySydney,
          tomorrowSydney,
          moneyFlowsToday.disbursed.count,
        )
      : summariseDisbursementBuckets(pendingDisbursements, moneyFlowsToday.disbursed.count, now)
    const disbursementBuckets = {
      overdue: buildMetric(rawBuckets.overdue.count, rawBuckets.overdue.total),
      today: buildMetric(rawBuckets.today.count, rawBuckets.today.total),
      scheduled: buildMetric(rawBuckets.scheduled.count, rawBuckets.scheduled.total),
      todayDoneCount: rawBuckets.todayDoneCount,
      todayTotalCount: rawBuckets.todayTotalCount,
      scheduledTomorrowCount: rawBuckets.scheduledTomorrowCount,
    }

    // 7. Build response
    const userRole = isValidRole(user.role) ? user.role : 'operations'
    const response: DashboardResponse = {
      user: {
        firstName: user.firstName || (user.email?.split('@')[0] ?? 'User'),
        role: userRole,
      },
      actionItems: {
        pendingApprovalsCount: approvalsResult.totalDocs,
        failedActionsCount: 0, // Client tracks this via localStorage
      },
      recentCustomersSummary: customersWithAccounts,
      recentAccounts,
      upcomingPayments: topUpcomingPayments,
      pendingDisbursements,
      pendingDisbursementsCount: pendingDisbursementResult.totalDocs,
      disbursementBuckets,
      moneyFlowsToday,
      systemStatus: {
        ledger: ledgerHealth.status,
        latencyMs: ledgerHealth.latencyMs,
        lastChecked: new Date().toISOString(),
      },
    }

    // 8. Validate and return
    const validated = DashboardResponseSchema.parse(response)
    return NextResponse.json(validated)
  } catch (error) {
    console.error('[Dashboard API] Error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load dashboard data.' } },
      { status: 500 },
    )
  }
}
