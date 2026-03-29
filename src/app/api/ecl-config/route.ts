/**
 * API Route: GET /api/ecl-config
 *
 * Get current ECL configuration (overlay multiplier, PD rates).
 */

import { NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

/**
 * Map old bucket names to new bucket structure
 */
function mapBucketName(bucket: string): string {
  const bucketMap: Record<string, string> = {
    // Old bucket names -> new bucket names
    'CURRENT': 'current',
    'DAYS_1_30': 'early_arrears',
    'DAYS_31_60': 'late_arrears',
    'DAYS_61_90': 'late_arrears',
    'DAYS_90_PLUS': 'default',
    'bucket_1': 'early_arrears',
    'bucket_2': 'late_arrears',
    'bucket_3': 'late_arrears',
    'bucket_4': 'default',
  }
  return bucketMap[bucket] || bucket.toLowerCase()
}

export async function GET() {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error
    const { payload } = auth

    const client = getLedgerClient()

    try {
      const response = await client.getECLConfig({})

      // Transform the gRPC response to match the expected frontend interface
      // Handle both camelCase (from proto loader) and snake_case field names
      const grpcResponse = response as any
      
      const overlayMultiplier = parseFloat(grpcResponse.overlayMultiplier ?? grpcResponse.overlay_multiplier ?? '1.0')
      const pdRatesMap = grpcResponse.pdRates ?? grpcResponse.pd_rates ?? {}
      const lastUpdated = grpcResponse.lastUpdated ?? grpcResponse.last_updated ?? new Date().toISOString()
      const updatedBy = grpcResponse.updatedBy ?? grpcResponse.updated_by ?? 'system'
      const lgd = parseFloat(grpcResponse.lgd ?? '0.50')

      // Transform PD rates map to array format, mapping old bucket names to new ones
      // Group by new bucket name to handle cases where multiple old buckets map to the same new bucket
      const bucketGroups = new Map<string, { rate: number; updatedAt: string; updatedBy: string; updatedByName?: string }>()
      
      Object.entries(pdRatesMap).forEach(([oldBucket, rate]) => {
        const newBucket = mapBucketName(oldBucket)
        const rateValue = parseFloat(rate as string)
        
        // If bucket already exists, keep the first one (or you could take the max/min/average)
        if (!bucketGroups.has(newBucket)) {
          bucketGroups.set(newBucket, {
            rate: rateValue,
            updatedAt: lastUpdated,
            updatedBy: updatedBy,
            updatedByName: updatedBy === 'system' ? 'System Default' : undefined,
          })
        }
      })

      // Ensure all new buckets are present (merge with defaults if missing)
      const defaultRates: Record<string, number> = {
        current: 0.03,        // 3% rate (Stage 1)
        early_arrears: 0.25,  // 25% rate (Stage 1)
        late_arrears: 0.55,   // 55% rate (Stage 2 / SICR)
        default: 1.0,         // 100% rate (Stage 3 / Credit-Impaired)
      }

      // Add missing buckets with default rates
      Object.entries(defaultRates).forEach(([bucket, defaultRate]) => {
        if (!bucketGroups.has(bucket)) {
          bucketGroups.set(bucket, {
            rate: defaultRate,
            updatedAt: lastUpdated,
            updatedBy: 'system',
            updatedByName: 'System Default',
          })
        }
      })

      // Convert to array and sort
      const allPdRates = Array.from(bucketGroups.entries())
        .map(([bucket, config]) => ({
          bucket,
          ...config,
        }))
        .sort((a, b) => {
          const order = ['current', 'early_arrears', 'late_arrears', 'default']
          return order.indexOf(a.bucket) - order.indexOf(b.bucket)
        })

      // Enrich updatedBy GUIDs with user names from Payload
      
      // Collect unique user IDs (overlay + all PD rates)
      const userIds = new Set<string>()
      if (updatedBy && updatedBy !== 'system') {
        userIds.add(updatedBy)
      }
      allPdRates.forEach((rate) => {
        if (rate.updatedBy && rate.updatedBy !== 'system') {
          userIds.add(rate.updatedBy)
        }
      })
      
      // Fetch users in batch
      const userMap = new Map<string, string>()
      if (userIds.size > 0) {
        try {
          const usersResult = await payload.find({
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
          console.warn('[ECL Config] Error fetching users:', userError)
          // Continue without user names if lookup fails
        }
      }

      // Enrich PD rates with user names
      const enrichedPdRates = allPdRates.map((rate) => ({
        ...rate,
        updatedByName: rate.updatedBy === 'system'
          ? 'System Default'
          : userMap.get(rate.updatedBy) || rate.updatedBy,
      }))

      return NextResponse.json({
        overlayMultiplier,
        overlayUpdatedAt: lastUpdated,
        overlayUpdatedBy: updatedBy,
        overlayUpdatedByName: updatedBy === 'system'
          ? 'System Default'
          : userMap.get(updatedBy) || updatedBy,
        pdRates: enrichedPdRates,
        lgd,
        lgdUpdatedAt: lastUpdated,
        lgdUpdatedBy: updatedBy,
        lgdUpdatedByName: updatedBy === 'system'
          ? 'System Default'
          : userMap.get(updatedBy) || updatedBy,
      })
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      // Handle UNAVAILABLE (14), UNIMPLEMENTED (12), or missing client method
      if (
        error.code === 14 ||
        error.code === 12 ||
        error.message?.includes('UNAVAILABLE') ||
        error.message?.includes('not implemented') ||
        error.message?.includes('call')
      ) {
        console.warn('Ledger service unavailable or method not implemented for ECL config')
        const now = new Date().toISOString()
        return NextResponse.json(
          {
            overlayMultiplier: 1.0,
            overlayUpdatedAt: now,
            overlayUpdatedBy: 'system',
            overlayUpdatedByName: 'System Default',
            pdRates: [
              { bucket: 'current', rate: 0.03, updatedAt: now, updatedBy: 'system', updatedByName: 'System Default' },
              { bucket: 'early_arrears', rate: 0.25, updatedAt: now, updatedBy: 'system', updatedByName: 'System Default' },
              { bucket: 'late_arrears', rate: 0.55, updatedAt: now, updatedBy: 'system', updatedByName: 'System Default' },
              { bucket: 'default', rate: 1.0, updatedAt: now, updatedBy: 'system', updatedByName: 'System Default' },
            ],
            lgd: 0.50,
            lgdUpdatedAt: now,
            lgdUpdatedBy: 'system',
            _fallback: true,
            _message: 'Using default ECL configuration',
          },
          { status: 200 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching ECL config:', error)
    return NextResponse.json(
      { error: 'Failed to fetch ECL config', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
