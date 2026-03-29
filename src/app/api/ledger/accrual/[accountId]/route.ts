/**
 * API Route: GET /api/ledger/accrual/[accountId]
 *
 * Get accrued yield for a loan account.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error

    const { accountId } = await params

    if (!accountId) {
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
    }

    const client = getLedgerClient()

    try {
      const response = await client.getAccruedYield({
        accountId,
      })

      // Handle both camelCase and snake_case field names from gRPC
      // The proto loader converts snake_case to camelCase (keepCase: false),
      // but we'll handle both for safety
      const cumulativeAccrued = (response as any).cumulativeAccrued ?? (response as any).cumulative_accrued ?? '0'
      const daysAccrued = (response as any).daysAccrued ?? (response as any).days_accrued ?? 0
      const feeAmount = (response as any).feeAmount ?? (response as any).fee_amount ?? '0'
      const dailyRate = (response as any).dailyRate ?? (response as any).daily_rate ?? '0'
      const termDays = (response as any).termDays ?? (response as any).term_days ?? 0
      const lastAccrualDate = (response as any).lastAccrualDate ?? (response as any).last_accrual_date
      const disbursementDate = (response as any).disbursementDate ?? (response as any).disbursement_date ?? ''
      const lastUpdated = (response as any).lastUpdated ?? (response as any).last_updated ?? new Date().toISOString()
      const responseAccountId = (response as any).accountId ?? (response as any).account_id ?? accountId

      // Debug logging to diagnose field mapping issues
      console.log(`[Accrued Yield] Account: ${accountId}, Raw response fields:`, {
        'response.cumulativeAccrued': (response as any).cumulativeAccrued,
        'response.cumulative_accrued': (response as any).cumulative_accrued,
        'response.daysAccrued': (response as any).daysAccrued,
        'response.days_accrued': (response as any).days_accrued,
        'response.feeAmount': (response as any).feeAmount,
        'response.fee_amount': (response as any).fee_amount,
        'response.termDays': (response as any).termDays,
        'response.term_days': (response as any).term_days,
        'response.dailyRate': (response as any).dailyRate,
        'response.daily_rate': (response as any).daily_rate,
        rawResponse: response,
      })

      // Transform the response to match the expected frontend interface
      const feeAmountNum = parseFloat(feeAmount)
      const cumulativeAccruedNum = parseFloat(cumulativeAccrued)
      const remainingAmount = Math.max(0, feeAmountNum - cumulativeAccruedNum).toFixed(2)

      // Calculate accrual end date (disbursement date + term days)
      let accrualEndDate = ''
      if (disbursementDate && termDays) {
        const startDate = new Date(disbursementDate)
        startDate.setDate(startDate.getDate() + termDays)
        accrualEndDate = startDate.toISOString()
      }

      const transformedResponse = {
        accountId: responseAccountId,
        accruedAmount: cumulativeAccrued,
        remainingAmount,
        totalFeeAmount: feeAmount,
        termDays,
        daysAccrued,
        dailyRate,
        lastAccrualDate: lastAccrualDate || undefined,
        accrualStartDate: disbursementDate,
        accrualEndDate,
        updatedAt: lastUpdated,
        _fallback: false,
      }

      console.log(`[Accrued Yield] Account: ${accountId}, Transformed response:`, {
        accruedAmount: transformedResponse.accruedAmount,
        daysAccrued: transformedResponse.daysAccrued,
        termDays: transformedResponse.termDays,
      })

      return NextResponse.json(transformedResponse)
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      // Handle NOT_FOUND - account has no accrual state yet
      if (error.code === 5 || error.message?.includes('NOT_FOUND')) {
        return NextResponse.json(
          {
            accountId,
            accruedAmount: 0,
            feeAmount: 0,
            termDays: 1,
            daysElapsed: 0,
            progress: 0,
            calculationBreakdown: null,
            _notFound: true,
          },
          { status: 200 },
        )
      }
      if (error.code === 14 || error.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable for accrual')
        return NextResponse.json(
          { error: 'Ledger service unavailable', _fallback: true },
          { status: 503 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching accrued yield:', error)
    return NextResponse.json(
      { error: 'Failed to fetch accrued yield', details: (error as Error).message },
      { status: 500 },
    )
  }
}
