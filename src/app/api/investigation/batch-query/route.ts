/**
 * API Route: POST /api/investigation/batch-query
 *
 * Query multiple accounts at once.
 *
 * Body:
 * - accountIds: string[] (required) - Up to 100 account IDs
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'

interface BatchQueryBody {
  accountIds: string[]
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error

    const body: BatchQueryBody = await request.json()

    if (!body.accountIds || body.accountIds.length === 0) {
      return NextResponse.json({ error: 'accountIds is required' }, { status: 400 })
    }

    if (body.accountIds.length > 100) {
      return NextResponse.json({ error: 'Maximum 100 accounts per request' }, { status: 400 })
    }

    const client = getLedgerClient()

    const response = await client.batchAccountQuery({
      accountIds: body.accountIds,
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error batch querying accounts:', error)
    return NextResponse.json(
      { error: 'Failed to batch query accounts', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
