/**
 * API Route: GET /api/period-close/history
 *
 * Get list of closed periods with details.
 *
 * Query params:
 * - limit: Max periods to return (default: 100)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined

    const client = getLedgerClient()

    try {
      const response = await client.getClosedPeriods({
        limit,
      })

      // Fetch details for each closed period
      const periods = await Promise.all(
        response.periodDates.map(async (periodDate) => {
          try {
            const detail = await client.getPeriodClose({ periodDate })
            return {
              periodDate: detail.periodDate,
              closedAt: detail.finalizedAt,
              closedBy: detail.finalizedBy,
              totalAccounts: detail.totalAccounts,
              totalAccruedYield: parseFloat(detail.totalAccruedYield),
              totalECLAllowance: parseFloat(detail.totalEclAllowance),
              totalCarryingAmount: parseFloat(detail.totalCarryingAmount),
              journalEntries: detail.journalEntries.map((j) => ({
                id: j.entryId,
                type: j.entryType,
                amount: parseFloat(j.amount),
              })),
            }
          } catch {
            // If we can't fetch detail, return minimal info
            return {
              periodDate,
              closedAt: '',
              closedBy: '',
              totalAccounts: 0,
              totalAccruedYield: 0,
              totalECLAllowance: 0,
              totalCarryingAmount: 0,
            }
          }
        }),
      )

      const lastClosedPeriod = periods.length > 0 ? periods[0].periodDate : null

      return NextResponse.json({
        periods,
        lastClosedPeriod,
      })
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      // Handle UNAVAILABLE (14), UNIMPLEMENTED (12), or missing client method
      if (
        error.code === 14 ||
        error.code === 12 ||
        error.message?.includes('UNAVAILABLE') ||
        error.message?.includes('not implemented') ||
        error.message?.includes('call')
      ) {
        console.warn('Ledger service unavailable or method not implemented for closed periods')
        return NextResponse.json(
          {
            periods: [],
            lastClosedPeriod: null,
            _fallback: true,
            _message: 'Period close history not available',
          },
          { status: 200 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching closed periods:', error)
    return NextResponse.json(
      { error: 'Failed to fetch closed periods', details: (error as Error).message },
      { status: 500 },
    )
  }
}
