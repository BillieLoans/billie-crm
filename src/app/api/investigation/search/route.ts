/**
 * API Route: GET /api/investigation/search
 *
 * Search for accounts by ID, number, or customer.
 *
 * Query params:
 * - q: Search query (required)
 * - limit: Max results (default: 20, max: 100)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error

    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('q')
    const rawLimit = searchParams.get('limit')
    const limit = rawLimit ? parseInt(rawLimit, 10) : 20

    if (!Number.isFinite(limit)) {
      return NextResponse.json({ error: 'Invalid limit parameter' }, { status: 400 })
    }

    if (!query) {
      return NextResponse.json({ error: 'q (query) is required' }, { status: 400 })
    }

    const client = getLedgerClient()

    try {
      const response = await client.searchAccounts({
        query,
        limit: Math.min(limit, 100),
      })

      return NextResponse.json(response)
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      if (error.code === 14 || error.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable for search')
        return NextResponse.json({ results: [], totalCount: 0, _fallback: true }, { status: 200 })
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error searching accounts:', error)
    return NextResponse.json(
      { error: 'Failed to search accounts', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
