/**
 * API Route: POST /api/ledger/ecl/recalc/bulk
 *
 * Trigger ECL recalculation for specific accounts.
 *
 * Body:
 * - accountIds: string[] (required) - Account IDs to recalculate (max 100)
 * - triggeredBy: string (required) - Reason for recalculation
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'

interface BulkRecalcBody {
  accountIds: string[]
  triggeredBy: string
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    const body: BulkRecalcBody = await request.json()

    if (!body.accountIds || body.accountIds.length === 0) {
      return NextResponse.json({ error: 'accountIds is required' }, { status: 400 })
    }

    if (body.accountIds.length > 100) {
      return NextResponse.json({ error: 'Maximum 100 accounts per request' }, { status: 400 })
    }

    // Look up username from authenticated user
    let triggeredByName = String(user.id)
    try {
      const userResult = await payload.findByID({
        collection: 'users',
        id: String(user.id),
      })
      if (userResult) {
        triggeredByName = userResult.firstName && userResult.lastName
          ? `${userResult.firstName} ${userResult.lastName}`
          : userResult.email || String(user.id)
      }
    } catch (userError) {
      console.warn('[Bulk Recalc] Could not look up user, using ID:', userError)
    }

    const client = getLedgerClient()

    const response = await client.triggerBulkECLRecalculation({
      accountIds: body.accountIds,
      triggeredBy: triggeredByName,
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error triggering bulk ECL recalculation:', error)
    return NextResponse.json(
      { error: 'Failed to trigger recalculation', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
