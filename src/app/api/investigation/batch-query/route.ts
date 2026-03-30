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
import { BatchQuerySchema } from '@/lib/schemas/api'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error

    const rawBody = await request.json()
    const parseResult = BatchQuerySchema.safeParse(rawBody)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const body = parseResult.data

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
