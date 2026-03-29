/**
 * API Route: GET /api/investigation/events/[accountId]
 *
 * Get full event history for an account.
 *
 * Query params:
 * - limit: Max events per page (default: 100, max: 1000)
 * - cursor: Pagination cursor for next page
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
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
    const searchParams = request.nextUrl.searchParams
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 100
    const cursor = searchParams.get('cursor') || undefined

    if (!accountId) {
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
    }

    const client = getLedgerClient()

    try {
      const response = await client.getEventHistory({
        accountId,
        limit: Math.min(limit, 1000),
        cursor,
      })

      // Enrich events with user names for triggered_by fields
      const grpcResponse = response as any
      const events = grpcResponse.events ?? []
      
      // Collect unique user IDs from triggered_by fields in event data
      const userIds = new Set<string>()
      events.forEach((event: any) => {
        const eventData = event.data ?? {}
        const triggeredBy = eventData.triggered_by ?? eventData.triggeredBy ?? event.triggered_by ?? event.triggeredBy
        if (triggeredBy && typeof triggeredBy === 'string' && triggeredBy.length === 24) {
          // MongoDB ObjectId format (24 hex characters)
          userIds.add(triggeredBy)
        }
      })

      // Fetch users in batch
      const userMap = new Map<string, string>()
      if (userIds.size > 0) {
        try {
          const usersResult = await auth.payload.find({
            collection: 'users',
            where: {
              id: { in: Array.from(userIds) },
            },
            limit: userIds.size,
          })

          // Map user ID to display name
          usersResult.docs.forEach((user) => {
            const displayName = user.firstName && user.lastName
              ? `${user.firstName} ${user.lastName}`
              : user.email || user.id
            userMap.set(user.id, displayName)
          })
        } catch (userError) {
          console.warn('[Event History] Error fetching users:', userError)
          // Continue without user names if lookup fails
        }
      }

      // Enrich events with user names
      const enrichedEvents = events.map((event: any) => {
        const eventData = event.data ?? {}
        const triggeredBy = eventData.triggered_by ?? eventData.triggeredBy ?? event.triggered_by ?? event.triggeredBy
        
        let triggeredByName: string | undefined
        if (triggeredBy && typeof triggeredBy === 'string' && triggeredBy.length === 24) {
          triggeredByName = userMap.get(triggeredBy)
        }

        return {
          ...event,
          data: {
            ...eventData,
            triggered_by: triggeredBy,
            triggeredByName: triggeredByName || triggeredBy,
          },
          triggered_by: triggeredBy,
          triggeredByName: triggeredByName || triggeredBy,
        }
      })

      return NextResponse.json({
        ...grpcResponse,
        events: enrichedEvents,
      })
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      if (error.code === 14 || error.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable for event history')
        return NextResponse.json(
          { success: false, events: [], nextCursor: '', _fallback: true },
          { status: 200 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching event history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch event history', details: (error as Error).message },
      { status: 500 },
    )
  }
}
