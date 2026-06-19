import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { classifyBucket, getCommencementDate } from '@/lib/disbursement-cutoff'

interface PendingDisbursementItem {
  loanAccountId: string
  accountNumber: string
  customerId: string
  customerName: string
  loanAmount: number
  loanAmountFormatted: string
  totalOutstanding: number
  totalOutstandingFormatted: string
  createdAt: string
  signedLoanAgreementUrl?: string | null
  commencementDate: string | null
  bucket: 'overdue' | 'today' | 'scheduled'
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(amount)
}

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayload({ config: configPromise })
    const headersList = await headers()

    const { user } = await payload.auth({
      headers: new Headers(Array.from(headersList.entries())),
    })

    if (!user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } },
        { status: 401 },
      )
    }

    const limitParam = request.nextUrl.searchParams.get('limit')
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : 200

    const pendingResult = await payload.find({
      collection: 'loan-accounts',
      where: {
        accountStatus: { equals: 'pending_disbursement' },
      },
      sort: '-createdAt',
      limit,
    })

    const items: PendingDisbursementItem[] = pendingResult.docs.map((acc) => {
      const loanAmount = acc.loanTerms?.loanAmount ?? 0
      const totalOutstanding = acc.balances?.totalOutstanding ?? 0
      const commencementDate = getCommencementDate(acc)
      // No commencement date yet → surface in today's queue for ops attention rather than hiding it.
      const bucket = commencementDate ? classifyBucket(commencementDate) : 'today'

      return {
        loanAccountId: acc.loanAccountId ?? '',
        accountNumber: acc.accountNumber ?? '',
        customerId: acc.customerIdString ?? '',
        customerName: acc.customerName ?? 'Unknown',
        loanAmount,
        loanAmountFormatted: formatCurrency(loanAmount),
        totalOutstanding,
        totalOutstandingFormatted: formatCurrency(totalOutstanding),
        createdAt: acc.createdAt,
        signedLoanAgreementUrl: acc.signedLoanAgreementUrl ?? undefined,
        commencementDate,
        bucket,
      }
    })

    const bucketParam = request.nextUrl.searchParams.get('bucket')
    const validBuckets = ['overdue', 'today', 'scheduled']
    const filtered =
      bucketParam && validBuckets.includes(bucketParam)
        ? items.filter((i) => i.bucket === bucketParam)
        : items

    return NextResponse.json({ totalCount: filtered.length, items: filtered })
  } catch (error) {
    console.error('[Pending Disbursements API] Error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load pending disbursements.' } },
      { status: 500 },
    )
  }
}
