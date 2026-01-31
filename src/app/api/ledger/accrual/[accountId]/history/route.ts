/**
 * API Route: GET /api/ledger/accrual/[accountId]/history
 *
 * Get accrual event history for a loan account.
 *
 * Query params:
 * - limit: Max events to return (optional)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params
    const searchParams = request.nextUrl.searchParams
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined

    if (!accountId) {
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
    }

    const client = getLedgerClient()

    try {
      const response = await client.getAccrualEventHistory({
        accountId,
        limit,
      })

      // Transform the response to match the expected frontend interface
      // The proto loader converts snake_case to camelCase (keepCase: false)
      // So cumulative_amount becomes cumulativeAmount, daily_amount becomes dailyAmount
      // 
      // NOTE: The gRPC service has a bug where daily_amount = daily_rate * days_accrued
      // instead of just daily_rate. We fix this by using daily_rate for the daily amount.
      const transformedResponse = {
        accountId: response.accountId,
        events: response.events.map((event: any, index: number) => {
          // The gRPC response should have camelCase fields due to keepCase: false
          // But we'll handle both cases for safety
          const dailyRate = event.dailyRate ?? event.daily_rate ?? '0'
          // Use daily_rate for the daily amount (not daily_amount which is incorrectly calculated)
          const dailyAmount = dailyRate
          const cumulativeAmount = event.cumulativeAmount ?? event.cumulative_amount ?? '0'
          const timestamp = event.timestamp ?? ''
          const accrualDate = event.accrualDate ?? event.accrual_date ?? ''
          const correlationId = event.correlationId ?? event.correlation_id
          const daysAccrued = event.daysAccrued ?? event.days_accrued ?? 0

          return {
            eventId: correlationId || `accrual-${accrualDate || timestamp}-${index}`,
            eventType: 'ACCRUAL',
            timestamp, // Keep timestamp for other uses (e.g., sorting)
            accrualDate, // Use accrual_date for date display
            amount: dailyAmount, // Use daily_rate instead of the incorrect daily_amount
            cumulativeAmount: cumulativeAmount,
            dayNumber: daysAccrued,
          }
        }),
        totalEvents: response.totalCount || response.events.length,
        // Gap detection fields (new in API update)
        missingDates: (response as any).missingDates ?? (response as any).missing_dates ?? [],
        hasGaps: (response as any).hasGaps ?? (response as any).has_gaps ?? false,
        filteredCount: (response as any).filteredCount ?? (response as any).filtered_count ?? 0,
      }

      return NextResponse.json(transformedResponse)
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      if (error.code === 14 || error.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable for accrual history')
        return NextResponse.json(
          { error: 'Ledger service unavailable', _fallback: true },
          { status: 503 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching accrual history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch accrual history', details: (error as Error).message },
      { status: 500 },
    )
  }
}
