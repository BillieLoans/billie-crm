/**
 * API Route: GET /api/ecl-config/pending
 *
 * Get pending config changes.
 *
 * Query params:
 * - includePast: Include changes with past effective dates (default: false)
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
    const includePast = searchParams.get('includePast') === 'true'

    const client = getLedgerClient()

    try {
      const response = await client.getPendingConfigChanges({
        includePast,
      })

      console.log('[Pending Config Changes] Raw gRPC response:', JSON.stringify(response, null, 2))

      // Transform the gRPC response to match the expected frontend interface
      const grpcResponse = response as any
      const pendingChanges = grpcResponse.changes ?? grpcResponse.pendingChanges ?? []

      // Get current config to populate currentValue for each pending change
      let currentConfig: any = null
      try {
        const configResponse = await client.getECLConfig({})
        currentConfig = configResponse as any
      } catch (configError) {
        console.warn('[Pending Config Changes] Could not fetch current config:', configError)
      }

      // Type for pending change entries
      type PendingChange = {
        id: string
        parameter: 'overlay_multiplier' | 'pd_rate' | 'lgd'
        bucket: string | undefined
        currentValue: number
        newValue: number
        effectiveDate: string
        createdBy: string
        createdAt: string
      }

      // Transform each pending change
      const transformedChanges: PendingChange[] = pendingChanges.map((change: any) => {
        const fieldName = change.fieldName ?? change.field_name ?? ''
        const newValueStr = change.newValue ?? change.new_value ?? '0'
        const effectiveDate = change.effectiveDate ?? change.effective_date ?? ''
        const createdAt = change.createdAt ?? change.created_at ?? new Date().toISOString()
        const createdBy = change.createdBy ?? change.created_by ?? 'system'
        const changeId = change.changeId ?? change.change_id ?? change.id ?? ''

        // Parse new value
        const newValue = parseFloat(newValueStr)

        // Determine parameter and bucket from field_name
        let parameter: 'overlay_multiplier' | 'pd_rate' | 'lgd' = 'overlay_multiplier'
        let bucket: string | undefined

        if (fieldName.startsWith('pd_rate')) {
          parameter = 'pd_rate'
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

        // Get current value from current config
        let currentValue = 0
        if (currentConfig) {
          if (parameter === 'overlay_multiplier') {
            currentValue = parseFloat(currentConfig.overlayMultiplier ?? currentConfig.overlay_multiplier ?? '1.0')
          } else if (parameter === 'pd_rate' && bucket) {
            const pdRatesMap = currentConfig.pdRates ?? currentConfig.pd_rates ?? {}
            // Handle both array and map formats
            let pdRatesArray: any[] = []
            if (Array.isArray(pdRatesMap)) {
              pdRatesArray = pdRatesMap
            } else if (typeof pdRatesMap === 'object') {
              pdRatesArray = Object.entries(pdRatesMap).map(([k, v]) => ({ bucket: k, rate: v }))
            }
            const pdRate = pdRatesArray.find((r: any) => {
              const rBucket = r.bucket ?? r[0]
              return rBucket === bucket
            })
            if (pdRate) {
              const rateValue = pdRate.rate ?? pdRate[1]
              currentValue = typeof rateValue === 'string' ? parseFloat(rateValue) : (rateValue || 0)
            }
          } else if (parameter === 'lgd') {
            const lgdValue = currentConfig.lgd ?? currentConfig.lgdRate
            currentValue = typeof lgdValue === 'number' ? lgdValue : parseFloat(lgdValue ?? '0.50')
          }
        }
        
        // If still NaN, use defaults based on parameter
        if (isNaN(currentValue)) {
          if (parameter === 'overlay_multiplier') {
            currentValue = 1.0
          } else if (parameter === 'lgd') {
            currentValue = 0.50
          } else if (parameter === 'pd_rate') {
            // Default PD rates by bucket
            const defaultRates: Record<string, number> = {
              current: 0.03,
              early_arrears: 0.25,
              late_arrears: 0.55,
              default: 1.0,
            }
            currentValue = bucket ? (defaultRates[bucket] ?? 0) : 0
          }
        }

        return {
          id: changeId,
          parameter,
          bucket,
          currentValue: isNaN(currentValue) ? 0 : currentValue,
          newValue: isNaN(newValue) ? 0 : newValue,
          effectiveDate,
          createdBy,
          createdAt,
        }
      })

      // Enrich with user names
      const userIds = [...new Set(transformedChanges.map((c: PendingChange) => c.createdBy).filter((id: string) => id && id !== 'system' && id.length === 24))]
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

          usersResult.docs.forEach((user) => {
            const displayName = user.firstName && user.lastName
              ? `${user.firstName} ${user.lastName}`
              : user.email || user.id
            userMap.set(user.id, displayName)
          })
        } catch (userError) {
          console.warn('[Pending Config Changes] Error fetching users:', userError)
        }
      }

      const enrichedChanges = transformedChanges.map((change: PendingChange) => ({
        ...change,
        createdByName: change.createdBy === 'system'
          ? 'System Default'
          : userMap.get(change.createdBy) || change.createdBy,
      }))

      return NextResponse.json({
        changes: enrichedChanges,
      })
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      if (error.code === 14 || error.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable for pending config changes')
        return NextResponse.json(
          { error: 'Ledger service unavailable', _fallback: true },
          { status: 503 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching pending config changes:', error)
    return NextResponse.json(
      { error: 'Failed to fetch pending config changes', details: (error as Error).message },
      { status: 500 },
    )
  }
}
