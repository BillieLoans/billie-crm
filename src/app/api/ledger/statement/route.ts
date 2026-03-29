/**
 * API Route: GET /api/ledger/statement
 *
 * Generate statement for a loan account.
 *
 * Query params:
 * - accountId (required): Loan account ID
 * - periodStart (required): Start date (YYYY-MM-DD)
 * - periodEnd (required): End date (YYYY-MM-DD)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient, timestampToDate } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error

    const searchParams = request.nextUrl.searchParams
    const accountId = searchParams.get('accountId')
    const periodStart = searchParams.get('periodStart')
    const periodEnd = searchParams.get('periodEnd')

    if (!accountId) {
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
    }
    if (!periodStart || !periodEnd) {
      return NextResponse.json(
        { error: 'periodStart and periodEnd are required' },
        { status: 400 },
      )
    }

    const client = getLedgerClient()
    const response = await client.getStatement({
      loanAccountId: accountId,
      periodStart,
      periodEnd,
    })

    return NextResponse.json({
      accountId: response.loanAccountId,
      accountNumber: response.accountNumber,
      customerId: response.customerId,
      periodStart: response.periodStart,
      periodEnd: response.periodEnd,
      disbursedPrincipal: parseFloat(response.disbursedPrincipal),
      establishmentFee: parseFloat(response.establishmentFee),
      totalRepayable: parseFloat(response.totalRepayable),
      openingBalance: parseFloat(response.openingBalance),
      feesCharged: parseFloat(response.feesCharged),
      paymentsReceived: parseFloat(response.paymentsReceived),
      closingBalance: parseFloat(response.closingBalance),
      lines: response.lines.map((line) => ({
        date: line.date,
        transactionId: line.transactionId,
        description: line.description,
        charge: line.charge ? parseFloat(line.charge) : null,
        payment: line.payment ? parseFloat(line.payment) : null,
        balance: parseFloat(line.balance),
      })),
      generatedAt: timestampToDate(response.generatedAt).toISOString(),
    })
  } catch (error) {
    console.error('Error generating statement:', error)
    return NextResponse.json(
      { error: 'Failed to generate statement', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}

