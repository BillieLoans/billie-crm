import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

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
    const cookieHeader = headersList.get('cookie') || ''

    const { user } = await payload.auth({
      headers: new Headers({ cookie: cookieHeader }),
    })

    if (!user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } },
        { status: 401 },
      )
    }

    const limitParam = request.nextUrl.searchParams.get('limit')
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : 50

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
      }
    })

    return NextResponse.json({
      totalCount: pendingResult.totalDocs,
      items,
    })
  } catch (error) {
    console.error('[Pending Disbursements API] Error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load pending disbursements.' } },
      { status: 500 },
    )
  }
}
