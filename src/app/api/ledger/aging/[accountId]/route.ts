/**
 * API Route: GET /api/ledger/aging/[accountId]
 *
 * Get current aging state for a loan account (DPD, bucket, etc.).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient, type AccountAgingResponse } from '@/server/grpc-client'
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
      const response = await client.getAccountAging({
        accountId,
      })

      // Normalise the aging-v1.1.0 isInArrears field. proto-loader emits
      // camelCase by default; be defensive about snake_case too.
      const raw = response as AccountAgingResponse & { is_in_arrears?: boolean }
      const isInArrears: boolean =
        typeof raw.isInArrears === 'boolean'
          ? raw.isInArrears
          : typeof raw.is_in_arrears === 'boolean'
            ? raw.is_in_arrears
            : false

      return NextResponse.json({ ...response, isInArrears })
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      // Handle NOT_FOUND - account has no aging state yet
      if (error.code === 5 || error.message?.includes('NOT_FOUND')) {
        return NextResponse.json(
          {
            accountId,
            dpd: 0,
            bucket: 'CURRENT',
            bucketEntryDate: null,
            history: [],
            isInArrears: false,
            _notFound: true,
          },
          { status: 200 },
        )
      }
      if (error.code === 14 || error.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable for aging')
        return NextResponse.json(
          {
            error: 'Ledger service unavailable',
            _fallback: true,
          },
          { status: 503 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching aging:', error)
    return NextResponse.json(
      { error: 'Failed to fetch aging', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
