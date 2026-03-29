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
import { getPayload } from 'payload'
import configPromise from '@payload-config'
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

    const body: BulkRecalcBody = await request.json()

    if (!body.accountIds || body.accountIds.length === 0) {
      return NextResponse.json({ error: 'accountIds is required' }, { status: 400 })
    }

    if (!body.triggeredBy) {
      return NextResponse.json({ error: 'triggeredBy is required' }, { status: 400 })
    }

    if (body.accountIds.length > 100) {
      return NextResponse.json({ error: 'Maximum 100 accounts per request' }, { status: 400 })
    }

    // Look up username from user GUID
    let triggeredByName = body.triggeredBy
    if (body.triggeredBy && body.triggeredBy.length === 24) {
      // Looks like a MongoDB ObjectId (user GUID), try to look up the username
      try {
        const payload = await getPayload({ config: configPromise })
        const userResult = await payload.findByID({
          collection: 'users',
          id: body.triggeredBy,
        })
        
        if (userResult) {
          triggeredByName = userResult.firstName && userResult.lastName
            ? `${userResult.firstName} ${userResult.lastName}`
            : userResult.email || body.triggeredBy
        }
      } catch (userError) {
        console.warn('[Bulk Recalc] Could not look up user, using GUID:', userError)
        // Continue with GUID if lookup fails
      }
    }

    const client = getLedgerClient()

    const response = await client.triggerBulkECLRecalculation({
      accountIds: body.accountIds,
      triggeredBy: triggeredByName, // Send username instead of GUID
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
