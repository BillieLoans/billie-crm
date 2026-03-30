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
import { BulkRecalcSchema } from '@/lib/schemas/api'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    const rawBody = await request.json()
    const parseResult = BulkRecalcSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const body = parseResult.data

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
