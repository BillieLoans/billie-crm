/**
 * API Route: GET /api/ecl-config/history
 *
 * Get ECL configuration change history.
 *
 * Query params:
 * - limit: Max events to return (default: 100)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error
    const { payload } = auth

    const searchParams = request.nextUrl.searchParams
    const rawLimit = searchParams.get('limit')
    const limit = rawLimit ? parseInt(rawLimit, 10) : undefined
    const parameter = searchParams.get('parameter') || undefined

    if (limit !== undefined && !Number.isFinite(limit)) {
      return NextResponse.json({ error: 'Invalid limit parameter' }, { status: 400 })
    }

    const client = getLedgerClient()

    try {
      const response = await client.getECLConfigHistory({
        limit: limit || 100,
      })

      // Transform the gRPC response to match the expected frontend interface
      // Handle both camelCase (from proto loader) and snake_case field names
      const grpcResponse = response as any
      
      // The gRPC response has 'events' array (proto: repeated ECLConfigChangeEvent events)
      const events = grpcResponse.events ?? []
      const _totalCount = grpcResponse.totalCount ?? grpcResponse.total_count ?? events.length

      // Type for transformed history entries
      type HistoryEntry = {
        id: string
        timestamp: string
        parameter: 'overlay_multiplier' | 'pd_rate' | 'lgd'
        bucket: string | undefined
        oldValue: number
        newValue: number
        changedBy: string
        changedByName: string | undefined
        reason: undefined
      }

      // Transform each event to match the frontend interface
      // Proto fields: timestamp, field_name, old_value, new_value, changed_by
      const transformedEntries: HistoryEntry[] = events.map((event: any, index: number) => {
        const timestamp = event.timestamp ?? new Date().toISOString()
        const fieldName = event.fieldName ?? event.field_name ?? 'unknown'
        const oldValueStr = event.oldValue ?? event.old_value ?? '0'
        const newValueStr = event.newValue ?? event.new_value ?? '0'
        const changedBy = event.changedBy ?? event.changed_by ?? 'system'
        
        // Parse values as numbers
        const oldValue = parseFloat(oldValueStr)
        const newValue = parseFloat(newValueStr)
        
        // Extract bucket from field_name if it's a PD rate (e.g., "pd_rate_bucket_1" or "pd_rate_current")
        let bucket: string | undefined
        let parameter: 'overlay_multiplier' | 'pd_rate' | 'lgd' = 'overlay_multiplier'
        
        if (fieldName.startsWith('pd_rate')) {
          parameter = 'pd_rate'
          // Extract bucket from field name (e.g., "pd_rate_bucket_1" -> "bucket_1", "pd_rate_current" -> "current")
          const bucketMatch = fieldName.match(/pd_rate[_-](.+)$/i)
          if (bucketMatch) {
            bucket = bucketMatch[1].toLowerCase()
            // Map old bucket names to new ones
            if (bucket === 'current') bucket = 'current'
            else if (bucket === 'bucket_1' || bucket === 'days_1_30') bucket = 'early_arrears'
            else if (bucket === 'bucket_2' || bucket === 'bucket_3' || bucket === 'days_31_60' || bucket === 'days_61_90') bucket = 'late_arrears'
            else if (bucket === 'bucket_4' || bucket === 'days_90_plus') bucket = 'default'
          }
        } else if (fieldName.includes('overlay')) {
          parameter = 'overlay_multiplier'
        } else if (fieldName.includes('lgd')) {
          parameter = 'lgd'
        }

        return {
          id: `history-${timestamp}-${index}`,
          timestamp,
          parameter,
          bucket,
          oldValue,
          newValue,
          changedBy,
          changedByName: changedBy === 'system' ? 'System Default' : undefined,
          reason: undefined, // Not in proto response
        }
      })

      // Filter by parameter if specified
      let filteredEntries: HistoryEntry[] = transformedEntries
      if (parameter) {
        filteredEntries = transformedEntries.filter((entry: HistoryEntry) => entry.parameter === parameter)
      }

      // Enrich changedBy GUIDs with user names from Payload
      // Collect unique user IDs
      const userIds = [...new Set(filteredEntries.map((e: HistoryEntry) => e.changedBy).filter((id: string) => id && id !== 'system'))]
      
      // Fetch users in batch
      const userMap = new Map<string, string>()
      if (userIds.length > 0) {
        try {
          const usersResult = await payload.find({
            collection: 'users',
            where: {
              id: { in: userIds },
            },
            limit: userIds.length,
          })

          // Map user ID to display name
          usersResult.docs.forEach((user) => {
            const displayName = user.firstName && user.lastName
              ? `${user.firstName} ${user.lastName}`
              : user.email || user.id
            userMap.set(user.id, displayName)
          })
        } catch (userError) {
          console.warn('[ECL Config History] Error fetching users:', userError)
          // Continue without user names if lookup fails
        }
      }

      // Add changedByName to entries
      const enrichedEntries = filteredEntries.map((entry: HistoryEntry) => ({
        ...entry,
        changedByName: entry.changedBy === 'system'
          ? 'System Default'
          : userMap.get(entry.changedBy) || entry.changedBy,
      }))

      const transformedResponse = {
        entries: enrichedEntries,
        totalCount: enrichedEntries.length,
      }

      return NextResponse.json(transformedResponse)
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string; details?: string }
      
      console.error('[ECL Config History] gRPC error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        error: grpcError,
      })
      
      // Handle UNAVAILABLE (14), UNIMPLEMENTED (12), or missing client method
      if (
        error.code === 14 ||
        error.code === 12 ||
        error.message?.includes('UNAVAILABLE') ||
        error.message?.includes('not implemented') ||
        error.message?.includes('call') ||
        error.message?.includes('undefined')
      ) {
        console.warn('Ledger service unavailable or method not implemented for ECL config history')
        return NextResponse.json(
          {
            entries: [],
            totalCount: 0,
            _fallback: true,
            _message: 'ECL config history service not available',
          },
          { status: 200 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching ECL config history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch ECL config history', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
