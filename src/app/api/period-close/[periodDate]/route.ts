/**
 * API Route: GET /api/period-close/[periodDate]
 *
 * Get a finalized period close by date.
 *
 * Query params:
 * - includeCorrections: Include correction details (default: false)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ periodDate: string }> },
) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error

    const { periodDate } = await params
    const searchParams = request.nextUrl.searchParams
    const includeCorrections = searchParams.get('includeCorrections') === 'true'

    if (!periodDate) {
      return NextResponse.json({ error: 'periodDate is required' }, { status: 400 })
    }

    const client = getLedgerClient()

    try {
      const response = await client.getPeriodClose({
        periodDate,
        includeCorrections,
      })

      return NextResponse.json(response)
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      if (error.code === 14 || error.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable for period close')
        return NextResponse.json(
          { error: 'Ledger service unavailable', _fallback: true },
          { status: 503 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching period close:', error)
    return NextResponse.json(
      { error: 'Failed to fetch period close', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
