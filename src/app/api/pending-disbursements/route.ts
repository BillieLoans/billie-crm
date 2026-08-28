import { NextRequest, NextResponse } from 'next/server'
import { classifyBucket, getCommencementDate } from '@/lib/disbursement-cutoff'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { fetchDisbursedToday, getDashboardPool } from '@/lib/dashboard-aggregates'
import {
  buildOskoMessage,
  calculateDailyLimitUsage,
  DAILY_DISBURSEMENT_LIMIT_AUD,
  type DailyLimitUsage,
} from '@/lib/disbursement-payments'

interface DisbursementAccountView {
  holder: string | null
  bsb: string | null
  /** Formatted for display/copy: '013-257' style grouping is applied to the BSB only. */
  bsbFormatted: string | null
  number: string | null
  /** True when every field needed to pay is present. */
  isComplete: boolean
  /** Names the missing pieces, for the row's warning. */
  missing: string[]
}

interface PendingDisbursementItem {
  loanAccountId: string
  accountNumber: string
  applicationNumber: string | null
  customerId: string
  customerName: string
  /** Name to check the bank's Confirmation-of-Payee response against. */
  ekycVerifiedName: string | null
  /**
   * eKYC outcome for this customer. Three states, not a boolean: a failed check
   * is a fraud signal and must not read the same as one that never ran.
   */
  ekycStatus: 'successful' | 'failed' | 'pending' | 'unknown'
  loanAmount: number
  loanAmountFormatted: string
  totalOutstanding: number
  totalOutstandingFormatted: string
  createdAt: string
  signedLoanAgreementUrl?: string | null
  commencementDate: string | null
  firstDueDate: string | null
  bucket: 'overdue' | 'today' | 'scheduled'
  disbursementAccount: DisbursementAccountView | null
  /** Ready-to-paste ANZ payment-message text. */
  oskoMessage: string
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(amount)
}

/** '013257' → '013-257'. Left alone if it isn't 6 digits — never invent structure. */
function formatBsb(bsb: string | null): string | null {
  if (!bsb) return null
  const digits = bsb.replace(/\D/g, '')
  return digits.length === 6 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : bsb
}

function buildDisbursementAccount(acc: {
  holder?: string | null
  bsb?: string | null
  number?: string | null
}): DisbursementAccountView | null {
  const holder = acc.holder?.trim() || null
  const bsb = acc.bsb?.trim() || null
  const number = acc.number?.trim() || null
  // Nothing at all → null, so the UI shows "not available" rather than an empty card.
  if (!holder && !bsb && !number) return null

  const missing: string[] = []
  if (!holder) missing.push('account name')
  if (!bsb) missing.push('BSB')
  if (!number) missing.push('account number')

  return {
    holder,
    bsb,
    bsbFormatted: formatBsb(bsb),
    number,
    isComplete: missing.length === 0,
    missing,
  }
}

/** Narrow a stored eKYC status onto the four states the queue renders. */
function ekycStatusOf(value: unknown): 'successful' | 'failed' | 'pending' | 'unknown' {
  return value === 'successful' || value === 'failed' || value === 'pending'
    ? value
    : 'unknown'
}

/** Earliest scheduled payment date — what the customer is told to repay by. */
function firstDueDate(payments: unknown): string | null {
  if (!Array.isArray(payments)) return null
  const dates = payments
    .map((p) => (p as { dueDate?: string | null } | null)?.dueDate)
    .filter((d): d is string => typeof d === 'string' && d.length > 0)
    .sort()
  return dates[0] ?? null
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    const limitParam = request.nextUrl.searchParams.get('limit')
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : 200

    const pendingResult = await payload.find({
      collection: 'loan-accounts',
      where: {
        accountStatus: { equals: 'pending_disbursement' },
      },
      sort: '-createdAt',
      limit,
      overrideAccess: false,
      user,
    })

    // The Confirmation-of-Payee check compares the bank's registered account name
    // against the identity Billie actually verified, so the eKYC state has to travel
    // with the row. One batched read keyed by customer id — never a query per row.
    const customerIds = Array.from(
      new Set(
        pendingResult.docs
          .map((acc) => acc.customerIdString)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    )
    const customersResult =
      customerIds.length > 0
        ? await payload.find({
            collection: 'customers',
            where: { customerId: { in: customerIds } },
            limit: customerIds.length,
            depth: 0,
          })
        : null
    const customersById = new Map(
      (customersResult?.docs ?? []).map((c) => [c.customerId, c] as const),
    )

    const items: PendingDisbursementItem[] = pendingResult.docs.map((acc) => {
      const loanAmount = acc.loanTerms?.loanAmount ?? 0
      const totalOutstanding = acc.balances?.totalOutstanding ?? 0
      const commencementDate = getCommencementDate(acc)
      // No commencement date yet → surface in today's queue for ops attention rather than hiding it.
      const bucket = commencementDate ? classifyBucket(commencementDate) : 'today'

      const customer = acc.customerIdString ? customersById.get(acc.customerIdString) : undefined
      // `customers.identityVerified` is NOT the signal here: it is only ever written
      // by customer.verified.v1, which nothing emits (platform-services calls it
      // "supported if/when emitted"), so it is null for every customer in every
      // environment. Gating on it made the queue label every payee "unverified",
      // which is worse than silent — an always-on warning on a fraud control is one
      // operators learn to click past. ekycStatus is the field actually populated.
      const ekycStatus = ekycStatusOf(customer?.ekycStatus)

      const applicationNumber = acc.applicationNumber ?? null
      const due = firstDueDate(acc.repaymentSchedule?.payments)

      return {
        loanAccountId: acc.loanAccountId ?? '',
        accountNumber: acc.accountNumber ?? '',
        applicationNumber,
        customerId: acc.customerIdString ?? '',
        customerName: acc.customerName ?? 'Unknown',
        // The name is shown whatever the eKYC outcome — the operator still has to
        // compare something against the bank. The status qualifies how much it is worth.
        ekycVerifiedName: customer?.fullName ?? null,
        ekycStatus,
        loanAmount,
        loanAmountFormatted: formatCurrency(loanAmount),
        totalOutstanding,
        totalOutstandingFormatted: formatCurrency(totalOutstanding),
        createdAt: acc.createdAt,
        signedLoanAgreementUrl: acc.signedLoanAgreementUrl ?? undefined,
        commencementDate,
        firstDueDate: due,
        bucket,
        disbursementAccount: buildDisbursementAccount(acc.disbursementAccount ?? {}),
        oskoMessage: buildOskoMessage({ reference: applicationNumber, firstDueDate: due }),
      }
    })

    const bucketParam = request.nextUrl.searchParams.get('bucket')
    const validBuckets = ['overdue', 'today', 'scheduled']
    const filtered =
      bucketParam && validBuckets.includes(bucketParam)
        ? items.filter((i) => i.bucket === bucketParam)
        : items

    // Bank-limit headroom is a property of the whole day, not of the current filter,
    // so it is always computed from the unfiltered queue. "Actionable today" means
    // overdue + today: a scheduled loan is not going out on this run.
    const pendingTodayTotal = items
      .filter((i) => i.bucket === 'overdue' || i.bucket === 'today')
      .reduce((sum, i) => sum + (i.loanAmount || 0), 0)

    let dailyLimit: DailyLimitUsage
    try {
      const pool = getDashboardPool(payload)
      const disbursed = await fetchDisbursedToday(pool)
      dailyLimit = calculateDailyLimitUsage(disbursed.totalAmount, pendingTodayTotal)
    } catch (limitError) {
      // The queue is the operator's critical path; a failed aggregate must not take
      // the whole screen down. Report the pending side and let the UI mark it partial.
      console.error('[Pending Disbursements API] Daily limit aggregate failed:', limitError)
      dailyLimit = calculateDailyLimitUsage(0, pendingTodayTotal, DAILY_DISBURSEMENT_LIMIT_AUD)
    }

    return NextResponse.json({ totalCount: filtered.length, items: filtered, dailyLimit })
  } catch (error) {
    console.error('[Pending Disbursements API] Error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load pending disbursements.' } },
      { status: 500 },
    )
  }
}
