/**
 * API Route: GET /api/dashboard
 *
 * Dashboard data aggregation endpoint.
 * Returns user context, action items, recent customers summary, and system status.
 *
 * Story 6.2: Dashboard Home Page
 */

import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { hasApprovalAuthority } from '@/lib/access'
import {
  DashboardResponseSchema,
  DashboardQuerySchema,
  type DashboardResponse,
  type MoneyFlowMetric,
  type MoneyFlowsToday,
  type RecentAccount,
  type UpcomingPayment,
  type PendingDisbursement,
} from '@/lib/schemas/dashboard'
import {
  sydneyOffsetMinutes,
  classifyBucket,
  getCommencementDate,
  summariseDisbursementBuckets,
} from '@/lib/disbursement-cutoff'

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
 * Compute the UTC instants that bracket "today" in Australia/Sydney.
 *
 * The server runs in UTC on Fly.io; this helper keeps the "today" widgets
 * aligned with the local working day for ops staff in Australia.
 */
function australianDayBoundaries(now: Date = new Date()): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now)
  const pick = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  const y = pick('year')
  const m = pick('month')
  const d = pick('day')

  const utcMidnight = Date.UTC(y, m - 1, d)
  const offsetMinutes = sydneyOffsetMinutes(new Date(utcMidnight))
  const start = new Date(utcMidnight - offsetMinutes * 60_000)
  const end = new Date(start.getTime() + 24 * 60 * 60_000)
  return { start, end }
}

const EMPTY_METRIC: MoneyFlowMetric = {
  count: 0,
  totalAmount: 0,
  totalAmountFormatted: '$0.00',
}

function buildMetric(count: number, totalAmount: number): MoneyFlowMetric {
  return {
    count,
    totalAmount,
    totalAmountFormatted: formatCurrency(totalAmount),
  }
}

/**
 * Aggregate today's money flows (expected, received, disbursed) for the
 * Australian working day. Reads directly from the `loan_accounts` parent table
 * and the `loan_accounts_repayment_schedule_payments` child table via the
 * Postgres adapter's pool — bypasses the Local API because we only need scalar
 * aggregates over the whole table.
 */
async function fetchMoneyFlowsToday(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
): Promise<MoneyFlowsToday> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pool = (payload.db as any).pool as
    | {
        query: (
          text: string,
          params?: unknown[],
        ) => Promise<{ rows: Array<Record<string, unknown>> }>
      }
    | undefined
  if (!pool) {
    return {
      paymentsExpected: EMPTY_METRIC,
      paymentsReceived: EMPTY_METRIC,
      disbursed: EMPTY_METRIC,
    }
  }

  const { start, end } = australianDayBoundaries()

  const toMetric = (row: Record<string, unknown> | undefined) => {
    // node-pg returns COUNT as bigint string and numeric SUM as string.
    const count = row?.count != null ? Number(row.count) : 0
    const total = row?.total != null ? Number(row.total) : 0
    return buildMetric(Number.isFinite(count) ? count : 0, Number.isFinite(total) ? total : 0)
  }

  const [expectedResult, receivedResult, disbursedResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::bigint AS count, COALESCE(SUM(amount), 0) AS total
         FROM loan_accounts_repayment_schedule_payments
        WHERE due_date >= $1 AND due_date < $2`,
      [start, end],
    ),
    pool.query(
      `SELECT COUNT(*)::bigint AS count, COALESCE(SUM(amount_paid), 0) AS total
         FROM loan_accounts_repayment_schedule_payments
        WHERE paid_date >= $1 AND paid_date < $2`,
      [start, end],
    ),
    pool.query(
      `SELECT COUNT(*)::bigint AS count, COALESCE(SUM(loan_terms_loan_amount), 0) AS total
         FROM loan_accounts
        WHERE loan_terms_disbursed_date >= $1 AND loan_terms_disbursed_date < $2`,
      [start, end],
    ),
  ])

  return {
    paymentsExpected: toMetric(expectedResult.rows[0]),
    paymentsReceived: toMetric(receivedResult.rows[0]),
    disbursed: toMetric(disbursedResult.rows[0]),
  }
}

/**
 * Fetch ledger health status from internal API.
 */
async function fetchLedgerHealth(
  baseUrl: string,
): Promise<{ status: 'online' | 'degraded' | 'offline'; latencyMs: number }> {
  try {
    const response = await fetch(`${baseUrl}/api/ledger/health`, {
      cache: 'no-store',
    })

    if (!response.ok) {
      return { status: 'offline', latencyMs: 0 }
    }

    const data = await response.json()
    return {
      status:
        data.status === 'connected'
          ? 'online'
          : data.status === 'degraded'
            ? 'degraded'
            : 'offline',
      latencyMs: data.latencyMs ?? 0,
    }
  } catch {
    return { status: 'offline', latencyMs: 0 }
  }
}

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayload({ config: configPromise })
    const headersList = await headers()
    const cookieHeader = headersList.get('cookie') || ''

    // 1. Authenticate user
    const { user } = await payload.auth({
      headers: new Headers({ cookie: cookieHeader }),
    })

    if (!user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } },
        { status: 401 },
      )
    }

    // 2. Parse and validate query params
    const searchParams = Object.fromEntries(request.nextUrl.searchParams)
    const { recentCustomerIds } = DashboardQuerySchema.parse(searchParams)

    // 3. Determine if user can see approvals count
    const canSeeApprovals = hasApprovalAuthority(user)

    // 4. Get base URL for internal API calls (from trusted env, not request headers)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    // 5. Parallel fetch all data
    const [
      approvalsResult,
      ledgerHealth,
      customersResult,
      recentAccountsResult,
      allAccountsWithSchedule,
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

      // Check ledger health
      fetchLedgerHealth(baseUrl),

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

      // All active accounts with schedules (for upcoming payments)
      payload.find({
        collection: 'loan-accounts',
        where: {
          accountStatus: { equals: 'active' },
        },
        limit: 100, // Reasonable limit for payment processing
      }),

      // Loans pending disbursement
      payload.find({
        collection: 'loan-accounts',
        where: {
          accountStatus: { equals: 'pending_disbursement' },
        },
        sort: '-createdAt',
        limit: 200,
      }),

      // Today's money flows (expected / received / disbursed)
      fetchMoneyFlowsToday(payload),
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

    // Process upcoming payments from repayment schedules
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayMs = today.getTime()

    const upcomingPayments: UpcomingPayment[] = []

    for (const account of allAccountsWithSchedule.docs) {
      const payments = account.repaymentSchedule?.payments ?? []

      for (const payment of payments) {
        // Only include scheduled (not yet paid) payments
        if (payment.status !== 'scheduled') continue
        if (!payment.dueDate) continue

        const dueDate = new Date(payment.dueDate)
        dueDate.setHours(0, 0, 0, 0)
        const dueDateMs = dueDate.getTime()
        const daysUntilDue = Math.floor((dueDateMs - todayMs) / (1000 * 60 * 60 * 24))

        // Include payments due within 14 days or overdue
        if (daysUntilDue > 14) continue

        let status: 'overdue' | 'due_today' | 'upcoming'
        if (daysUntilDue < 0) {
          status = 'overdue'
        } else if (daysUntilDue === 0) {
          status = 'due_today'
        } else {
          status = 'upcoming'
        }

        upcomingPayments.push({
          loanAccountId: account.loanAccountId ?? '',
          accountNumber: account.accountNumber ?? '',
          customerName: account.customerName ?? 'Unknown',
          customerId: account.customerIdString ?? '',
          dueDate: payment.dueDate,
          amount: payment.amount ?? 0,
          amountFormatted: formatCurrency(payment.amount ?? 0),
          daysUntilDue,
          status,
        })
      }
    }

    // Sort by due date (oldest first - most urgent)
    upcomingPayments.sort((a, b) => {
      const dateA = new Date(a.dueDate).getTime()
      const dateB = new Date(b.dueDate).getTime()
      return dateA - dateB
    })

    // Limit to 10 most urgent
    const topUpcomingPayments = upcomingPayments.slice(0, 10)

    // Process pending disbursement accounts with bucket classification
    const now = new Date()

    const pendingDisbursements: PendingDisbursement[] = pendingDisbursementResult.docs.map(
      (acc) => {
        const commencementDate = getCommencementDate(acc)
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

    const rawBuckets = summariseDisbursementBuckets(
      pendingDisbursements,
      moneyFlowsToday.disbursed.count,
      now,
    )
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
